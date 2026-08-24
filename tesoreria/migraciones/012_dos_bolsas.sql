-- 012_dos_bolsas.sql
--
-- El dinero de la logia deja de ser un solo montón: cada movimiento dice por
-- dónde entró o salió (banco o efectivo), aparece el traspaso entre bolsas (el
-- depósito del efectivo de las tenidas, o un retiro), y los cortes muestran el
-- saldo de cada bolsa además del total.
--
-- Con esto el tesorero puede hacer arqueo (contar el sobre y compararlo contra
-- el sistema) y conciliar contra el estado de cuenta del banco.

-- ─────────────────────────────────────────────────────────────────────────────
-- La bolsa de cada movimiento
-- ─────────────────────────────────────────────────────────────────────────────

alter table movimiento add column bolsa text;

-- Lo ya capturado se asigna a banco: los tres movimientos existentes traen
-- comprobante adjunto, lo usual de una transferencia. Si alguno fue en
-- efectivo, la corrección es un traspaso, no una edición.
update movimiento set bolsa = 'banco';

alter table movimiento alter column bolsa set not null;
alter table movimiento
  add constraint movimiento_bolsa_valida check (bolsa in ('banco', 'efectivo'));

create index movimiento_bolsa_idx on movimiento (bolsa, periodo);

comment on column movimiento.bolsa is
  'Por dónde entró o salió el dinero. Si se capturó con la bolsa equivocada, se '
  'corrige con un traspaso: el libro no se reescribe.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Apertura del ejercicio por bolsa
-- ─────────────────────────────────────────────────────────────────────────────

alter table ejercicio
  add column apertura_banco_centavos int not null default 0,
  add column apertura_efectivo_centavos int not null default 0;

update ejercicio set apertura_banco_centavos = saldo_apertura_centavos;

-- El total pasa a ser una columna generada: nadie puede volver a escribirlo por
-- separado y quedar descuadrado de las bolsas.
drop view if exists v_corte_calculado;
alter table ejercicio drop column saldo_apertura_centavos;
alter table ejercicio
  add column saldo_apertura_centavos int
  generated always as (apertura_banco_centavos + apertura_efectivo_centavos) stored;

-- ─────────────────────────────────────────────────────────────────────────────
-- Traspasos entre bolsas
-- ─────────────────────────────────────────────────────────────────────────────

-- Un traspaso no es ingreso ni egreso: el total de la caja no se mueve, solo
-- cambia de lugar. Por eso es una tabla propia y no un movimiento, y los
-- totales de los cortes no lo cuentan.
create table traspaso (
  id              bigint generated always as identity primary key,
  fecha           date not null,
  ejercicio_anio  int not null references ejercicio(anio),
  periodo         date not null,
  de_bolsa        text not null check (de_bolsa in ('banco', 'efectivo')),
  a_bolsa         text not null check (a_bolsa in ('banco', 'efectivo')),
  monto_centavos  int not null check (monto_centavos between 1 and 100000000),
  descripcion     text not null,
  archivo_id      bigint references archivo(id),
  corte_id        bigint references corte_mensual(id),
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id),
  constraint traspaso_bolsas_distintas check (de_bolsa <> a_bolsa),
  constraint traspaso_descripcion_no_vacia check (btrim(descripcion) <> ''),
  constraint traspaso_dia_uno check (extract(day from periodo) = 1),
  constraint traspaso_periodo_coincide check (periodo = date_trunc('month', fecha)::date),
  constraint traspaso_anio_coincide check (extract(year from fecha)::int = ejercicio_anio)
);

create index traspaso_periodo_idx on traspaso (periodo);

comment on table traspaso is
  'Movimiento de dinero entre las bolsas de la logia: el depósito del efectivo '
  'al banco, o un retiro. Conserva la ficha como archivo cuando la hay. Un '
  'traspaso equivocado se corrige con el traspaso inverso.';

create trigger tr_traspaso_toca before update on traspaso
  for each row execute function fn_toca_timestamp();

-- El libro de traspasos tampoco borra.
create trigger tr_traspaso_no_borrar before delete on traspaso
  for each row execute function fn_prohibir_borrado();

-- Y respeta el cierre del mes, con la misma excepción del sellado.
create or replace function fn_traspaso_bloquear_mes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.corte_id is distinct from old.corte_id
     and (new.fecha, new.periodo, new.de_bolsa, new.a_bolsa, new.monto_centavos,
          new.descripcion, new.archivo_id)
         is not distinct from
         (old.fecha, old.periodo, old.de_bolsa, old.a_bolsa, old.monto_centavos,
          old.descripcion, old.archivo_id)
  then
    return new;
  end if;

  if exists (
    select 1 from corte_mensual
     where periodo = coalesce(new.periodo, old.periodo) and estado = 'cerrado'
  ) then
    raise exception
      'El mes de % ya tiene corte cerrado. Registra el traspaso en el mes abierto, '
      'o pide al Venerable Maestro que reabra el corte',
      fn_mes_es(coalesce(new.periodo, old.periodo));
  end if;

  return new;
end $$;

create trigger tr_traspaso_bloquear_mes
  before insert or update on traspaso
  for each row execute function fn_traspaso_bloquear_mes();

-- ─────────────────────────────────────────────────────────────────────────────
-- Cortes con desglose por bolsa
-- ─────────────────────────────────────────────────────────────────────────────

alter table corte_mensual
  add column banco_inicial_centavos int not null default 0,
  add column banco_final_centavos int not null default 0,
  add column efectivo_inicial_centavos int not null default 0,
  add column efectivo_final_centavos int not null default 0;

alter table corte_mensual add constraint corte_bolsas_cuadran check (
  banco_inicial_centavos + efectivo_inicial_centavos = saldo_inicial_centavos
  and banco_final_centavos + efectivo_final_centavos = saldo_final_centavos
);

create or replace function fn_cerrar_corte(
  p_periodo       date,
  p_observaciones text default null
) returns bigint
language plpgsql as $$
declare
  v_anio      int := extract(year from p_periodo)::int;
  v_ej        ejercicio;
  v_previo    corte_mensual;
  v_banco_ini int;
  v_efec_ini  int;
  v_ing       int;
  v_egr       int;
  v_ing_bco   int;
  v_egr_bco   int;
  v_ing_efe   int;
  v_egr_efe   int;
  v_a_bco     int;
  v_de_bco    int;
  v_id        bigint;
  v_pendiente record;
begin
  if extract(day from p_periodo) <> 1 then
    raise exception 'El periodo debe ser el día primero del mes';
  end if;

  select * into v_ej from ejercicio where anio = v_anio;
  if v_ej.anio is null then
    raise exception 'No existe el ejercicio %', v_anio;
  end if;
  if v_ej.estado = 'cerrado' then
    raise exception 'El ejercicio % está cerrado', v_anio;
  end if;

  if exists (select 1 from corte_mensual where periodo = p_periodo and estado = 'cerrado') then
    raise exception 'El mes de % ya está cerrado', fn_mes_es(p_periodo);
  end if;

  if p_periodo > v_ej.fecha_inicio then
    select * into v_previo
      from corte_mensual
     where periodo = (p_periodo - interval '1 month')::date;
    if v_previo.id is null or v_previo.estado <> 'cerrado' then
      raise exception 'Antes hay que cerrar el mes de %',
        fn_mes_es((p_periodo - interval '1 month')::date);
    end if;
    v_banco_ini := v_previo.banco_final_centavos;
    v_efec_ini  := v_previo.efectivo_final_centavos;
  else
    v_banco_ini := v_ej.apertura_banco_centavos;
    v_efec_ini  := v_ej.apertura_efectivo_centavos;
  end if;

  select e.folio, e.fecha_entrega into v_pendiente
    from egreso e
   where e.estado = 'por_comprobar'
     and date_trunc('month', e.fecha_entrega)::date < p_periodo
   order by e.fecha_entrega
   limit 1;

  if v_pendiente.folio is not null then
    raise exception
      'El egreso % sigue por comprobar desde el %. Sube los recibos o registra la '
      'devolución antes de cerrar este mes',
      v_pendiente.folio, to_char(v_pendiente.fecha_entrega, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(monto_centavos) filter (where tipo = 'ingreso'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'egreso'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'ingreso' and bolsa = 'banco'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'egreso' and bolsa = 'banco'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'ingreso' and bolsa = 'efectivo'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'egreso' and bolsa = 'efectivo'), 0)::int
    into v_ing, v_egr, v_ing_bco, v_egr_bco, v_ing_efe, v_egr_efe
    from movimiento
   where periodo = p_periodo;

  select coalesce(sum(monto_centavos) filter (where a_bolsa = 'banco'), 0)::int,
         coalesce(sum(monto_centavos) filter (where de_bolsa = 'banco'), 0)::int
    into v_a_bco, v_de_bco
    from traspaso
   where periodo = p_periodo;

  insert into corte_mensual (
    periodo, ejercicio_anio, estado, saldo_inicial_centavos, total_ingresos_centavos,
    total_egresos_centavos, saldo_final_centavos,
    banco_inicial_centavos, banco_final_centavos,
    efectivo_inicial_centavos, efectivo_final_centavos,
    capitas_esperadas_centavos, capitas_cobradas_centavos, pendiente_comprobar_centavos,
    observaciones, cerrado_por, cerrado_en, creado_por
  )
  values (
    p_periodo, v_anio, 'cerrado',
    v_banco_ini + v_efec_ini, v_ing, v_egr,
    v_banco_ini + v_efec_ini + v_ing - v_egr,
    v_banco_ini, v_banco_ini + v_ing_bco - v_egr_bco + v_a_bco - v_de_bco,
    v_efec_ini,  v_efec_ini  + v_ing_efe - v_egr_efe - v_a_bco + v_de_bco,
    coalesce((select sum(monto_esperado_centavos)::int from capita_cargo
               where periodo = p_periodo and estado = 'vigente'), 0),
    coalesce((select sum(ca.monto_aplicado_centavos)::int
                from capita_aplicacion ca
                join capita_cargo cc on cc.id = ca.capita_cargo_id
               where cc.periodo = p_periodo), 0),
    coalesce((select sum(monto_entregado_centavos - monto_comprobado_centavos
                         - monto_devuelto_centavos)::int
                from egreso where estado = 'por_comprobar'), 0),
    p_observaciones, fn_usuario_actual(), now(), fn_usuario_actual()
  )
  on conflict (periodo) do update
     set estado = 'cerrado',
         saldo_inicial_centavos = excluded.saldo_inicial_centavos,
         total_ingresos_centavos = excluded.total_ingresos_centavos,
         total_egresos_centavos = excluded.total_egresos_centavos,
         saldo_final_centavos = excluded.saldo_final_centavos,
         banco_inicial_centavos = excluded.banco_inicial_centavos,
         banco_final_centavos = excluded.banco_final_centavos,
         efectivo_inicial_centavos = excluded.efectivo_inicial_centavos,
         efectivo_final_centavos = excluded.efectivo_final_centavos,
         capitas_esperadas_centavos = excluded.capitas_esperadas_centavos,
         capitas_cobradas_centavos = excluded.capitas_cobradas_centavos,
         pendiente_comprobar_centavos = excluded.pendiente_comprobar_centavos,
         observaciones = excluded.observaciones,
         cerrado_por = excluded.cerrado_por,
         cerrado_en = now()
  returning id into v_id;

  update movimiento set corte_id = v_id where periodo = p_periodo and corte_id is null;
  update traspaso set corte_id = v_id where periodo = p_periodo and corte_id is null;

  return v_id;
end $$;

create or replace function fn_reabrir_corte(
  p_corte_id bigint,
  p_motivo   text,
  p_usuario  bigint
) returns void
language plpgsql as $$
declare
  v_corte  corte_mensual;
  v_ultimo date;
begin
  select * into v_corte from corte_mensual where id = p_corte_id for update;
  if v_corte.id is null then
    raise exception 'Ese corte no existe';
  end if;
  if v_corte.estado <> 'cerrado' then
    raise exception 'Ese corte ya está abierto';
  end if;

  select max(periodo) into v_ultimo from corte_mensual where estado = 'cerrado';
  if v_corte.periodo <> v_ultimo then
    raise exception 'Solo se puede reabrir el último mes cerrado, que es el de %',
      fn_mes_es(v_ultimo);
  end if;

  update corte_mensual
     set estado = 'abierto',
         reaperturas = reaperturas + 1,
         cerrado_por = null,
         cerrado_en = null
   where id = p_corte_id;

  update movimiento set corte_id = null where corte_id = p_corte_id;
  update traspaso set corte_id = null where corte_id = p_corte_id;

  insert into corte_reapertura (corte_id, motivo, reabierto_por)
  values (p_corte_id, p_motivo, p_usuario);
end $$;

-- El arrastre de diciembre lleva las dos bolsas.
create or replace function fn_arrastrar_apertura() returns trigger
language plpgsql as $$
begin
  if new.estado = 'cerrado'
     and extract(month from new.periodo)::int = 12
     and exists (select 1 from ejercicio where anio = new.ejercicio_anio + 1)
     and not exists (
       select 1 from corte_mensual
        where ejercicio_anio = new.ejercicio_anio + 1 and estado = 'cerrado'
     )
  then
    update ejercicio
       set apertura_banco_centavos = new.banco_final_centavos,
           apertura_efectivo_centavos = new.efectivo_final_centavos,
           notas = 'Apertura arrastrada del corte de diciembre de '
                   || new.ejercicio_anio::text || '.'
     where anio = new.ejercicio_anio + 1;
  end if;
  return null;
end $$;

-- La apertura del año nuevo también viaja por bolsa.
create or replace function fn_abrir_ejercicio(
  p_anio                      int,
  p_capita_mensual_centavos   int default null,
  p_capita_promocion_centavos int default null
) returns void
language plpgsql as $$
declare
  v_anterior  ejercicio;
  v_diciembre corte_mensual;
  v_banco     int := 0;
  v_efectivo  int := 0;
begin
  if exists (select 1 from ejercicio where anio = p_anio) then
    raise exception 'El ejercicio % ya existe', p_anio;
  end if;

  select * into v_anterior from ejercicio where anio = p_anio - 1;
  if v_anterior.anio is null then
    raise exception
      'Solo se puede abrir el año siguiente al último ejercicio: falta el %', p_anio - 1;
  end if;

  select * into v_diciembre
    from corte_mensual
   where periodo = make_date(p_anio - 1, 12, 1) and estado = 'cerrado';
  if v_diciembre.id is not null then
    v_banco    := v_diciembre.banco_final_centavos;
    v_efectivo := v_diciembre.efectivo_final_centavos;
  end if;

  insert into ejercicio
    (anio, fecha_inicio, fecha_fin, capita_mensual_centavos, capita_promocion_centavos,
     apertura_banco_centavos, apertura_efectivo_centavos, notas,
     creado_por, actualizado_por)
  values (
    p_anio, make_date(p_anio, 1, 1), make_date(p_anio, 12, 31),
    coalesce(p_capita_mensual_centavos, v_anterior.capita_mensual_centavos),
    coalesce(p_capita_promocion_centavos, v_anterior.capita_promocion_centavos),
    v_banco, v_efectivo,
    case when v_diciembre.id is null
         then 'Abierto antes de cerrar diciembre de ' || (p_anio - 1)::text ||
              '. La apertura se completa sola al cerrar ese corte.'
         else 'Apertura arrastrada del corte de diciembre de ' || (p_anio - 1)::text || '.'
    end,
    fn_usuario_actual(), fn_usuario_actual()
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista de saldos encadenados, ahora por bolsa
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view v_corte_calculado as
with meses as (
  select generate_series(e.fecha_inicio, e.fecha_fin, interval '1 month')::date as periodo,
         e.anio,
         e.apertura_banco_centavos,
         e.apertura_efectivo_centavos
    from ejercicio e
),
flujo as (
  select mm.anio,
         mm.periodo,
         mm.apertura_banco_centavos,
         mm.apertura_efectivo_centavos,
         coalesce(sum(m.monto_centavos) filter (where m.tipo = 'ingreso'), 0)::int as ingresos,
         coalesce(sum(m.monto_centavos) filter (where m.tipo = 'egreso'), 0)::int as egresos,
         coalesce(sum(m.monto_centavos)
                  filter (where m.tipo = 'ingreso' and m.bolsa = 'banco'), 0)::int as ing_banco,
         coalesce(sum(m.monto_centavos)
                  filter (where m.tipo = 'egreso' and m.bolsa = 'banco'), 0)::int as egr_banco,
         coalesce(sum(m.monto_centavos)
                  filter (where m.tipo = 'ingreso' and m.bolsa = 'efectivo'), 0)::int as ing_efectivo,
         coalesce(sum(m.monto_centavos)
                  filter (where m.tipo = 'egreso' and m.bolsa = 'efectivo'), 0)::int as egr_efectivo
    from meses mm
    left join movimiento m on m.periodo = mm.periodo
   group by mm.anio, mm.periodo, mm.apertura_banco_centavos, mm.apertura_efectivo_centavos
),
tras as (
  select mm.periodo,
         coalesce(sum(t.monto_centavos) filter (where t.a_bolsa = 'banco'), 0)::int as hacia_banco,
         coalesce(sum(t.monto_centavos) filter (where t.de_bolsa = 'banco'), 0)::int as desde_banco
    from meses mm
    left join traspaso t on t.periodo = mm.periodo
   group by mm.periodo
),
deltas as (
  select f.*,
         t.hacia_banco,
         t.desde_banco,
         (f.ing_banco - f.egr_banco + t.hacia_banco - t.desde_banco) as delta_banco,
         (f.ing_efectivo - f.egr_efectivo - t.hacia_banco + t.desde_banco) as delta_efectivo
    from flujo f
    join tras t on t.periodo = f.periodo
)
select d.anio,
       d.periodo,
       d.ingresos as total_ingresos_centavos,
       d.egresos as total_egresos_centavos,
       (d.apertura_banco_centavos + d.apertura_efectivo_centavos
         + coalesce(sum(d.ingresos - d.egresos) over w, 0)
         - (d.ingresos - d.egresos))::int as saldo_inicial_centavos,
       (d.apertura_banco_centavos + d.apertura_efectivo_centavos
         + coalesce(sum(d.ingresos - d.egresos) over w, 0))::int as saldo_final_centavos,
       (d.apertura_banco_centavos
         + coalesce(sum(d.delta_banco) over w, 0) - d.delta_banco)::int
         as banco_inicial_centavos,
       (d.apertura_banco_centavos + coalesce(sum(d.delta_banco) over w, 0))::int
         as banco_final_centavos,
       (d.apertura_efectivo_centavos
         + coalesce(sum(d.delta_efectivo) over w, 0) - d.delta_efectivo)::int
         as efectivo_inicial_centavos,
       (d.apertura_efectivo_centavos + coalesce(sum(d.delta_efectivo) over w, 0))::int
         as efectivo_final_centavos,
       (d.hacia_banco + d.desde_banco > 0) as hay_traspasos,
       c.id as corte_id,
       c.estado as estado_corte,
       c.cerrado_en::text,
       u.nombre as cerrado_nombre,
       c.reaperturas
  from deltas d
  left join corte_mensual c on c.periodo = d.periodo
  left join usuario u on u.id = c.cerrado_por
window w as (partition by d.anio order by d.periodo rows between unbounded preceding and current row)
order by d.periodo;
