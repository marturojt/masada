-- 033_control_de_bolsas_desde.sql
--
-- El desglose banco y efectivo empieza a valer desde un mes del ejercicio, no
-- desde enero. En 2026 la captura se hizo en retroceso y muchos movimientos
-- quedaron con la bolsa equivocada: el total es correcto, el reparto entre
-- bolsas no. En lugar de corregir movimiento por movimiento, se elige un mes de
-- arranque y en él se hace un arqueo inicial: el tesorero dice cuánto hay de
-- verdad en el banco y en el sobre, y el sistema registra el traspaso que haga
-- falta para que el desglose cuadre. El total no se mueve.
--
-- Antes de ese mes el sistema solo informa el total. El libro no se reescribe:
-- los movimientos y traspasos anteriores se quedan como están.

-- ─────────────────────────────────────────────────────────────────────────────
-- Mes de arranque del control por bolsa
-- ─────────────────────────────────────────────────────────────────────────────

alter table ejercicio add column bolsas_desde date;

alter table ejercicio add constraint ejercicio_bolsas_desde_valido check (
  bolsas_desde is null
  or (extract(day from bolsas_desde) = 1 and extract(year from bolsas_desde)::int = anio)
);

comment on column ejercicio.bolsas_desde is
  'Mes desde el cual cuenta el desglose banco y efectivo. Vacío: todo el ejercicio. '
  'Si tiene fecha, ese mes no se cierra sin arqueo inicial.';

update ejercicio set bolsas_desde = '2026-11-01' where anio = 2026;

-- ─────────────────────────────────────────────────────────────────────────────
-- Arqueo inicial
-- ─────────────────────────────────────────────────────────────────────────────

create table arqueo_inicial (
  ejercicio_anio           int primary key references ejercicio(anio),
  fecha                    date not null,
  banco_contado_centavos   int not null check (banco_contado_centavos >= 0),
  efectivo_contado_centavos int not null check (efectivo_contado_centavos >= 0),
  banco_sistema_centavos   int not null,
  traspaso_id              bigint references traspaso(id),
  creado_por               bigint not null references usuario(id),
  creado_en                timestamptz not null default now()
);

comment on table arqueo_inicial is
  'Lo que había de verdad en el banco y en el sobre al arrancar el control por '
  'bolsa, y lo que el sistema traía. La diferencia queda como un traspaso. Uno por '
  'ejercicio y no se corrige: un error posterior se arregla con un traspaso normal.';

create trigger tr_arqueo_inicial_no_borrar before delete on arqueo_inicial
  for each row execute function fn_prohibir_borrado();

create or replace function fn_arqueo_inicial_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'El arqueo inicial no se modifica. Si algo quedó mal, registra un traspaso';
end $$;

create trigger tr_arqueo_inicial_inmutable before update on arqueo_inicial
  for each row execute function fn_arqueo_inicial_inmutable();

create or replace function fn_registrar_arqueo_inicial(
  p_anio      int,
  p_fecha     date,
  p_banco     int,
  p_efectivo  int,
  p_usuario   bigint
) returns bigint
language plpgsql as $$
declare
  v_ej        ejercicio;
  v_total     int;
  v_banco     int;
  v_dif       int;
  v_traspaso  bigint;
begin
  select * into v_ej from ejercicio where anio = p_anio for update;
  if v_ej.anio is null then
    raise exception 'No existe el ejercicio %', p_anio;
  end if;
  if v_ej.bolsas_desde is null then
    raise exception 'El ejercicio % lleva banco y efectivo desde enero, no necesita arqueo inicial', p_anio;
  end if;
  if exists (select 1 from arqueo_inicial where ejercicio_anio = p_anio) then
    raise exception 'El ejercicio % ya tiene arqueo inicial', p_anio;
  end if;
  if date_trunc('month', p_fecha)::date <> v_ej.bolsas_desde then
    raise exception 'El arqueo inicial va en el mes de %', fn_mes_es(v_ej.bolsas_desde);
  end if;
  if p_banco < 0 or p_efectivo < 0 then
    raise exception 'Lo contado no puede ser negativo';
  end if;

  -- Lo que el sistema tiene registrado del ejercicio, total y en banco.
  select v_ej.apertura_banco_centavos + v_ej.apertura_efectivo_centavos
           + coalesce(sum(case when tipo = 'ingreso' then monto_centavos else -monto_centavos end), 0),
         v_ej.apertura_banco_centavos
           + coalesce(sum(case when tipo = 'ingreso' then monto_centavos else -monto_centavos end)
                        filter (where bolsa = 'banco'), 0)
    into v_total, v_banco
    from movimiento
   where ejercicio_anio = p_anio;

  v_banco := v_banco
    + coalesce((select sum(monto_centavos) from traspaso
                 where ejercicio_anio = p_anio and a_bolsa = 'banco'), 0)
    - coalesce((select sum(monto_centavos) from traspaso
                 where ejercicio_anio = p_anio and de_bolsa = 'banco'), 0);

  if p_banco + p_efectivo <> v_total then
    raise exception
      'Lo contado suma %, pero el sistema tiene % registrados. Antes del arqueo hay '
      'que capturar lo que falte o registrar el ajuste que explique la diferencia de %',
      fn_pesos(p_banco + p_efectivo), fn_pesos(v_total),
      fn_pesos(abs(p_banco + p_efectivo - v_total));
  end if;

  v_dif := p_banco - v_banco;
  if v_dif <> 0 then
    insert into traspaso
      (fecha, ejercicio_anio, periodo, de_bolsa, a_bolsa, monto_centavos, descripcion,
       creado_por, actualizado_por)
    values (
      p_fecha, p_anio, v_ej.bolsas_desde,
      case when v_dif > 0 then 'efectivo' else 'banco' end,
      case when v_dif > 0 then 'banco' else 'efectivo' end,
      abs(v_dif),
      'Arqueo inicial: acomoda banco y efectivo a lo contado. Banco ' || fn_pesos(p_banco)
        || ', efectivo ' || fn_pesos(p_efectivo) || '.',
      p_usuario, p_usuario
    )
    returning id into v_traspaso;
  end if;

  insert into arqueo_inicial
    (ejercicio_anio, fecha, banco_contado_centavos, efectivo_contado_centavos,
     banco_sistema_centavos, traspaso_id, creado_por)
  values (p_anio, p_fecha, p_banco, p_efectivo, v_banco, v_traspaso, p_usuario);

  return v_traspaso;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El mes de arranque no se cierra sin arqueo
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_corte_exige_arqueo() returns trigger
language plpgsql as $$
begin
  if new.estado = 'cerrado'
     and (tg_op = 'INSERT' or old.estado is distinct from 'cerrado')
     and exists (select 1 from ejercicio
                  where anio = new.ejercicio_anio and bolsas_desde = new.periodo)
     and not exists (select 1 from arqueo_inicial where ejercicio_anio = new.ejercicio_anio)
  then
    raise exception
      'Antes de cerrar % hay que hacer el arqueo inicial: cuánto hay en el banco y '
      'cuánto en efectivo', fn_mes_es(new.periodo);
  end if;
  return new;
end $$;

create trigger tr_corte_exige_arqueo
  before insert or update of estado on corte_mensual
  for each row execute function fn_corte_exige_arqueo();
