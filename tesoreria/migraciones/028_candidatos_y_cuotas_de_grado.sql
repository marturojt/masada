-- 028_candidatos_y_cuotas_de_grado.sql
--
-- Dos cosas que pasan en la vida real y el sistema no sabía decir.
--
-- 1. Candidatos. Antes de iniciarse (o de afiliarse) una persona ya mueve
--    dinero: la logia paga a la Gran Tesorería para apartar la fecha y el
--    candidato cubre su cuota en los días siguientes. Por eso el candidato
--    nace en el padrón, como etapa previa: sin grado, sin fecha de ingreso y
--    sin cápitas. Al iniciarse (o afiliarse) pasa a hermano activo y todo lo
--    que ya tenía (cuota, pagos, trámite GT) se queda con él, porque es la
--    misma fila. Si desiste, queda como "desistió" y no se borra.
--
-- 2. Cuotas de grado por cobrar. La cuota de iniciación, afiliación, aumento
--    de salario o exaltación existía solo como ingreso al pagarse. Ahora se
--    puede registrar lo que la persona debe (un cargo) y los ingresos de esa
--    cuota se le aplican solos, en uno o varios abonos. Caso real: Ricardo
--    Acosta Monarrez, iniciado el 11 de mayo de 2026, debe 4,500 de su cuota;
--    la logia ya pagó su iniciación a la Gran Tesorería.
--
-- Las vistas que alimentan cápitas y el cuadro ya filtran por estatus
-- 'activo', así que un candidato no se cuela en ellas.

-- ─────────────────────────────────────────────────────────────────────────────
-- Candidatos en el padrón
-- ─────────────────────────────────────────────────────────────────────────────

alter table hermano drop constraint hermano_estatus_check;
alter table hermano add constraint hermano_estatus_check check (
  estatus in ('activo', 'baja', 'candidato', 'desistio')
);

alter table hermano alter column grado drop not null;
alter table hermano alter column fecha_ingreso drop not null;

alter table hermano add column candidato_para text
  check (candidato_para in ('iniciacion', 'afiliacion'));
alter table hermano add column fecha_programada date;

-- Un candidato (o quien desistió) no tiene grado ni fecha de ingreso, y sabe
-- para qué es candidato. Un hermano sí tiene las dos cosas. candidato_para se
-- conserva después de iniciarse: es la historia de cómo llegó.
alter table hermano add constraint hermano_candidato_coherente check (
  (estatus in ('candidato', 'desistio')) = (grado is null)
  and (estatus in ('candidato', 'desistio')) = (fecha_ingreso is null)
  and (estatus not in ('candidato', 'desistio') or candidato_para is not null)
);

comment on column hermano.candidato_para is
  'Si la persona entró al padrón como candidato: a iniciación o a afiliación. '
  'Se conserva después de iniciarse o afiliarse.';
comment on column hermano.fecha_programada is
  'Fecha prevista de la ceremonia mientras es candidato. Informativa.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cuotas de grado por cobrar
-- ─────────────────────────────────────────────────────────────────────────────

create table cuota_grado_cargo (
  id                 bigint generated always as identity primary key,
  hermano_id         bigint not null references hermano(id),
  tipo_evento        text not null
                     check (tipo_evento in ('iniciacion', 'afiliacion', 'aumento_salario',
                                            'exaltacion')),
  monto_centavos     int not null check (monto_centavos between 1 and 100000000),
  fecha              date not null,
  notas              text,
  estatus            text not null default 'vigente'
                     check (estatus in ('vigente', 'cancelado')),
  motivo_cancelacion text,
  cancelado_por      bigint references usuario(id),
  cancelado_en       timestamptz,
  creado_en          timestamptz not null default now(),
  creado_por         bigint references usuario(id),
  constraint cuota_cancelada_con_motivo check (
    (estatus = 'cancelado') = (motivo_cancelacion is not null)
  )
);

create index cuota_grado_cargo_hermano_idx on cuota_grado_cargo (hermano_id, tipo_evento);

comment on table cuota_grado_cargo is
  'Lo que una persona debe a la logia por su cuota de grado. Los ingresos del '
  'concepto cuota_<tipo> del mismo hermano se le aplican solos, del más antiguo '
  'al más nuevo. Una cuota con pagos no se cancela ni cambia de monto.';

-- Qué ingreso cubre qué cuota. Es dato derivado: se recalcula completo cada vez
-- que llega un ingreso, una cuota o un ajuste del hermano.
create table cuota_grado_aplicacion (
  id             bigint generated always as identity primary key,
  cargo_id       bigint not null references cuota_grado_cargo(id),
  movimiento_id  bigint not null references movimiento(id),
  monto_centavos int not null check (monto_centavos > 0),
  creado_en      timestamptz not null default now(),
  unique (cargo_id, movimiento_id)
);

create index cuota_grado_aplicacion_mov_idx on cuota_grado_aplicacion (movimiento_id);

-- El tipo de evento que salda un concepto de ingreso: cuota_iniciacion salda
-- iniciación, y así. Otro concepto no salda cuotas.
create or replace function fn_cuota_tipo_de_concepto(p_concepto bigint) returns text
language sql stable as $$
  select substr(c.clave, 7)
    from concepto c
   where c.id = p_concepto
     and c.tipo_especial = 'cuota_grado'
     and c.clave in ('cuota_iniciacion', 'cuota_afiliacion', 'cuota_aumento_salario',
                     'cuota_exaltacion')
$$;

-- Recalcula las aplicaciones de un hermano y un tipo de evento: lo neto de
-- cada ingreso (descontando sus ajustes), del más antiguo al más nuevo, contra
-- las cuotas vigentes, de la más antigua a la más nueva.
create or replace function fn_cuota_grado_aplicar(p_hermano bigint, p_tipo text)
returns void language plpgsql as $$
declare
  m         record;
  c         record;
  v_resto   int;
  v_saldo   int;
  v_aplica  int;
begin
  delete from cuota_grado_aplicacion a
   using cuota_grado_cargo cg
   where a.cargo_id = cg.id and cg.hermano_id = p_hermano and cg.tipo_evento = p_tipo;

  for m in
    select mv.id,
           (mv.monto_centavos
             - coalesce((select sum(aj.monto_centavos)
                           from movimiento_ajuste ma
                           join movimiento aj on aj.id = ma.movimiento_ajuste_id
                          where ma.movimiento_origen_id = mv.id), 0))::int as neto
      from movimiento mv
     where mv.tipo = 'ingreso'
       and mv.hermano_id = p_hermano
       and fn_cuota_tipo_de_concepto(mv.concepto_id) = p_tipo
     order by mv.fecha, mv.id
  loop
    v_resto := m.neto;
    continue when v_resto <= 0;

    for c in
      select cg.id, cg.monto_centavos
        from cuota_grado_cargo cg
       where cg.hermano_id = p_hermano and cg.tipo_evento = p_tipo
         and cg.estatus = 'vigente'
       order by cg.fecha, cg.id
    loop
      exit when v_resto <= 0;
      select c.monto_centavos - coalesce(sum(a.monto_centavos), 0)
        into v_saldo
        from cuota_grado_aplicacion a where a.cargo_id = c.id;
      continue when v_saldo <= 0;
      v_aplica := least(v_saldo, v_resto);
      insert into cuota_grado_aplicacion (cargo_id, movimiento_id, monto_centavos)
      values (c.id, m.id, v_aplica);
      v_resto := v_resto - v_aplica;
    end loop;
  end loop;
end $$;

comment on function fn_cuota_grado_aplicar is
  'Aplica los ingresos de cuota de un hermano a sus cuotas por cobrar del mismo '
  'tipo. Idempotente: borra y vuelve a aplicar.';

-- Disparadores: un ingreso de cuota, una cuota nueva o cancelada, y un ajuste
-- sobre un ingreso de cuota recalculan al hermano.
create or replace function fn_cuota_grado_por_movimiento() returns trigger
language plpgsql as $$
declare v_tipo text;
begin
  if new.tipo = 'ingreso' and new.hermano_id is not null then
    v_tipo := fn_cuota_tipo_de_concepto(new.concepto_id);
    if v_tipo is not null then
      perform fn_cuota_grado_aplicar(new.hermano_id, v_tipo);
    end if;
  end if;
  return null;
end $$;

create trigger tr_cuota_grado_por_movimiento
  after insert on movimiento
  for each row execute function fn_cuota_grado_por_movimiento();

create or replace function fn_cuota_grado_por_ajuste() returns trigger
language plpgsql as $$
declare o movimiento;
begin
  select * into o from movimiento where id = new.movimiento_origen_id;
  if o.tipo = 'ingreso' and o.hermano_id is not null
     and fn_cuota_tipo_de_concepto(o.concepto_id) is not null then
    perform fn_cuota_grado_aplicar(o.hermano_id, fn_cuota_tipo_de_concepto(o.concepto_id));
  end if;
  return null;
end $$;

create trigger tr_cuota_grado_por_ajuste
  after insert on movimiento_ajuste
  for each row execute function fn_cuota_grado_por_ajuste();

create or replace function fn_cuota_grado_por_cargo() returns trigger
language plpgsql as $$
begin
  perform fn_cuota_grado_aplicar(new.hermano_id, new.tipo_evento);
  return null;
end $$;

create trigger tr_cuota_grado_por_cargo
  after insert or update of estatus on cuota_grado_cargo
  for each row execute function fn_cuota_grado_por_cargo();

-- Una cuota con pagos aplicados no se cancela, ni cambia de monto, hermano o
-- tipo: el dinero ya está contado contra ella.
create or replace function fn_cuota_grado_protegida() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from cuota_grado_aplicacion where cargo_id = old.id)
     and (new.estatus <> old.estatus
          or (new.monto_centavos, new.hermano_id, new.tipo_evento)
             is distinct from (old.monto_centavos, old.hermano_id, old.tipo_evento))
  then
    raise exception
      'Esta cuota ya tiene pagos aplicados: no se cancela ni cambia de monto';
  end if;
  return new;
end $$;

create trigger tr_cuota_grado_protegida before update on cuota_grado_cargo
  for each row execute function fn_cuota_grado_protegida();

create or replace function fn_cuota_grado_no_borrar() returns trigger
language plpgsql as $$
begin
  raise exception 'Las cuotas por cobrar no se borran: se cancelan con motivo';
end $$;

create trigger tr_cuota_grado_no_borrar before delete on cuota_grado_cargo
  for each row execute function fn_cuota_grado_no_borrar();

-- Lo aplicado nunca pasa de la cuota ni del ingreso. Diferida, porque el
-- recálculo borra y vuelve a insertar dentro de la misma transacción.
create or replace function fn_cuota_grado_validar() returns trigger
language plpgsql as $$
declare
  v_aplicado int;
  v_tope     int;
begin
  select coalesce(sum(monto_centavos), 0) into v_aplicado
    from cuota_grado_aplicacion where cargo_id = new.cargo_id;
  select monto_centavos into v_tope from cuota_grado_cargo where id = new.cargo_id;
  if v_aplicado > v_tope then
    raise exception 'Se está aplicando % a una cuota de %',
      fn_pesos(v_aplicado), fn_pesos(v_tope);
  end if;

  select coalesce(sum(monto_centavos), 0) into v_aplicado
    from cuota_grado_aplicacion where movimiento_id = new.movimiento_id;
  select monto_centavos into v_tope from movimiento where id = new.movimiento_id;
  if v_aplicado > v_tope then
    raise exception 'Se está aplicando % de un ingreso de %',
      fn_pesos(v_aplicado), fn_pesos(v_tope);
  end if;
  return null;
end $$;

create constraint trigger tr_cuota_grado_validar
  after insert on cuota_grado_aplicacion
  deferrable initially deferred
  for each row execute function fn_cuota_grado_validar();

create or replace view v_cuota_grado_saldo as
select cg.id,
       cg.hermano_id,
       h.nombre_completo,
       h.estatus as hermano_estatus,
       cg.tipo_evento,
       cg.fecha,
       cg.monto_centavos,
       coalesce((select sum(a.monto_centavos) from cuota_grado_aplicacion a
                  where a.cargo_id = cg.id), 0)::int as pagado_centavos,
       (cg.monto_centavos
         - coalesce((select sum(a.monto_centavos) from cuota_grado_aplicacion a
                      where a.cargo_id = cg.id), 0))::int as saldo_centavos,
       cg.estatus,
       cg.notas,
       cg.motivo_cancelacion
  from cuota_grado_cargo cg
  join hermano h on h.id = cg.hermano_id;
