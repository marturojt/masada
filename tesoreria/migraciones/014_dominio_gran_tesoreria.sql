-- 014_dominio_gran_tesoreria.sql
--
-- La Gran Tesorería deja de ser "un egreso con datos extra" y se vuelve un
-- dominio propio que separa, como exige la operación real:
--
--   membresía  (hecho administrativo: la fotografía que GT envía)
--   tarifa     (catálogo versionado: cápita, templo, locker)
--   obligación (lo exigible, con su documento y su desglose)
--   pago       (el dinero que salió, ligado al libro de caja)
--   aplicación (qué pago cubre qué obligación)
--
-- El cálculo interno (membresía × tarifas) sirve para conciliar; el monto
-- exigible es siempre el que reporta la Gran Tesorería. Una diferencia se
-- muestra, nunca bloquea.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tarifas GT, versionadas
-- ─────────────────────────────────────────────────────────────────────────────

create table gt_tarifa (
  id             bigint generated always as identity primary key,
  concepto       text not null check (concepto in ('capita', 'templo', 'locker', 'otro')),
  descripcion    text,
  monto_centavos int not null check (monto_centavos > 0),
  vigencia_desde date not null,
  vigencia_hasta date,
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id),
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);

create index gt_tarifa_vigencia_idx on gt_tarifa (concepto, vigencia_desde desc);

comment on table gt_tarifa is
  'Lo que la Gran Tesorería cobra por concepto. Cada cambio es una fila nueva: '
  'una tarifa aplicada históricamente no cambia aunque cambie el catálogo.';

create trigger tr_gt_tarifa_inmutable before update or delete on gt_tarifa
  for each row execute function fn_tarifa_inmutable();

create or replace view v_gt_tarifa_vigente as
select distinct on (concepto)
       concepto, descripcion, monto_centavos, vigencia_desde, vigencia_hasta
  from gt_tarifa
 where vigencia_desde <= current_date
   and (vigencia_hasta is null or vigencia_hasta >= current_date)
 order by concepto, vigencia_desde desc, id desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- Membresía GT: la fotografía documental
-- ─────────────────────────────────────────────────────────────────────────────

create table gt_membresia (
  id                 bigint generated always as identity primary key,
  fecha_documento    date not null,
  fecha_recepcion    date,
  periodo_referencia date not null,
  archivo_id         bigint references archivo(id),
  observaciones      text,
  creado_en          timestamptz not null default now(),
  creado_por         bigint references usuario(id),
  constraint gt_membresia_periodo_dia_uno check (extract(day from periodo_referencia) = 1)
);

comment on table gt_membresia is
  'Cada documento de membresía recibido de la Gran Tesorería es una fotografía '
  'independiente. No se reconstruye historia modificando el padrón: se captura '
  'lo que el documento dice, aunque contradiga al padrón interno.';

create table gt_membresia_hermano (
  id                          bigint generated always as identity primary key,
  membresia_id                bigint not null references gt_membresia(id) on delete cascade,
  -- Puede no poderse asociar de inmediato con un hermano del padrón.
  hermano_id                  bigint references hermano(id),
  nombre_reportado            text not null,
  clave_mason_reportada       text,
  grado_reportado             text,
  estatus_reportado           text,
  fecha_iniciacion_reportada  date,
  fecha_aumento_reportada     date,
  fecha_exaltacion_reportada  date,
  genera_capita               boolean not null default true,
  conciliado                  boolean not null default false,
  observaciones               text,
  creado_en                   timestamptz not null default now(),
  creado_por                  bigint references usuario(id),
  constraint gt_mh_nombre_no_vacio check (btrim(nombre_reportado) <> '')
);

create index gt_membresia_hermano_idx on gt_membresia_hermano (membresia_id);

comment on table gt_membresia_hermano is
  'Renglón tal como lo reportó la Gran Tesorería. La liga con el padrón interno '
  '(hermano_id, conciliado) es trabajo de conciliación y puede llegar después.';

create or replace view v_gt_membresia_actual as
select m.id,
       m.periodo_referencia,
       m.fecha_documento,
       m.fecha_recepcion,
       m.archivo_id,
       (select count(*)::int from gt_membresia_hermano r where r.membresia_id = m.id)
         as renglones,
       (select count(*)::int from gt_membresia_hermano r
         where r.membresia_id = m.id and r.genera_capita) as con_capita,
       (select count(*)::int from gt_membresia_hermano r
         where r.membresia_id = m.id and r.hermano_id is null) as sin_ligar
  from gt_membresia m
 order by m.periodo_referencia desc, m.id desc
 limit 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Obligación GT
-- ─────────────────────────────────────────────────────────────────────────────

create table gt_obligacion (
  id                       bigint generated always as identity primary key,
  folio                    text not null unique,
  tipo                     text not null
                           check (tipo in ('ordinaria', 'regularizacion', 'tramite',
                                           'extraordinaria')),
  periodo_desde            date not null,
  periodo_hasta            date not null,
  fecha_documento          date not null,
  monto_reportado_centavos int not null check (monto_reportado_centavos > 0),
  monto_esperado_centavos  int check (monto_esperado_centavos >= 0),
  estatus                  text not null default 'pendiente_pago'
                           check (estatus in ('pendiente_pago', 'parcialmente_pagada',
                                              'pagada', 'cancelada')),
  membresia_id             bigint references gt_membresia(id),
  documento_calculo_id     bigint references archivo(id),
  hermano_id               bigint references hermano(id),
  motivo_cancelacion       text,
  observaciones            text,
  creado_en                timestamptz not null default now(),
  creado_por               bigint references usuario(id),
  actualizado_en           timestamptz not null default now(),
  actualizado_por          bigint references usuario(id),
  constraint gt_obl_periodos_dia_uno check (
    extract(day from periodo_desde) = 1 and extract(day from periodo_hasta) = 1
  ),
  constraint gt_obl_periodos_en_orden check (periodo_hasta >= periodo_desde),
  constraint gt_obl_cancelada_con_motivo check (
    (estatus = 'cancelada') = (motivo_cancelacion is not null)
  )
);

comment on table gt_obligacion is
  'Lo que la Gran Tesorería exige, independiente del pago. El monto reportado es '
  'el oficial; el esperado (membresía × tarifas) es solo para conciliar. La '
  'regularización es una obligación nueva: nunca modifica meses ya cerrados.';

comment on column gt_obligacion.hermano_id is
  'Solo para trámites de un hermano concreto (iniciación, aumento, exaltación).';

create index gt_obligacion_tipo_idx on gt_obligacion (tipo, estatus);
create index gt_obligacion_periodo_idx on gt_obligacion (periodo_desde, periodo_hasta);

create trigger tr_gt_obligacion_toca before update on gt_obligacion
  for each row execute function fn_toca_timestamp();

create table gt_obligacion_detalle (
  id              bigint generated always as identity primary key,
  obligacion_id   bigint not null references gt_obligacion(id) on delete cascade,
  concepto        text not null
                  check (concepto in ('capita', 'templo', 'locker', 'tramite', 'otro')),
  cantidad        int not null default 1 check (cantidad > 0),
  tarifa_centavos int check (tarifa_centavos >= 0),
  subtotal_centavos int not null check (subtotal_centavos >= 0),
  hermano_id      bigint references hermano(id),
  periodo         date,
  descripcion     text,
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  constraint gt_det_periodo_dia_uno check (
    periodo is null or extract(day from periodo) = 1
  )
);

create index gt_obligacion_detalle_idx on gt_obligacion_detalle (obligacion_id);

comment on column gt_obligacion_detalle.periodo is
  'En regularizaciones, el mes que se está regularizando de cada hermano.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Pago GT y su aplicación
-- ─────────────────────────────────────────────────────────────────────────────

create table gt_pago (
  id             bigint generated always as identity primary key,
  folio          text not null unique,
  fecha_pago     date not null,
  monto_centavos int not null check (monto_centavos > 0),
  bolsa          text not null check (bolsa in ('banco', 'efectivo')),
  medio_pago     text check (medio_pago in ('transferencia', 'tarjeta', 'efectivo', 'otro')),
  referencia     text,
  recibo_gt_id   bigint references archivo(id),
  -- Todo pago GT es dinero real que salió: sin movimiento no hay pago.
  movimiento_id  bigint not null unique references movimiento(id),
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id)
);

comment on table gt_pago is
  'El dinero que salió hacia la Gran Tesorería. Nace de la entrega de un egreso '
  'con sus dos firmas; el movimiento del libro es obligatorio.';

create table gt_pago_aplicacion (
  id             bigint generated always as identity primary key,
  pago_id        bigint not null references gt_pago(id),
  obligacion_id  bigint not null references gt_obligacion(id),
  monto_centavos int not null check (monto_centavos > 0),
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id),
  unique (pago_id, obligacion_id)
);

create index gt_pago_aplicacion_obl_idx on gt_pago_aplicacion (obligacion_id);

-- Invariantes de aplicación, diferidas como las de cápitas: lo aplicado no puede
-- pasar del pago ni de lo que la obligación reporta, y el estatus de la
-- obligación se deriva siempre de sus aplicaciones.
create or replace function fn_gt_validar_aplicacion() returns trigger
language plpgsql as $$
declare
  v_pago       bigint := coalesce(new.pago_id, old.pago_id);
  v_obligacion bigint := coalesce(new.obligacion_id, old.obligacion_id);
  v_aplicado   int;
  v_tope       int;
  v_estatus    text;
begin
  select coalesce(sum(monto_centavos), 0) into v_aplicado
    from gt_pago_aplicacion where pago_id = v_pago;
  select monto_centavos into v_tope from gt_pago where id = v_pago;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception 'Se está aplicando % y el pago GT fue de %',
      fn_pesos(v_aplicado), fn_pesos(coalesce(v_tope, 0));
  end if;

  select coalesce(sum(monto_centavos), 0) into v_aplicado
    from gt_pago_aplicacion where obligacion_id = v_obligacion;
  select monto_reportado_centavos into v_tope
    from gt_obligacion where id = v_obligacion;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception 'Se está aplicando % a una obligación de %',
      fn_pesos(v_aplicado), fn_pesos(coalesce(v_tope, 0));
  end if;

  select estatus into v_estatus from gt_obligacion where id = v_obligacion;
  if v_estatus = 'cancelada' then
    raise exception 'La obligación está cancelada, no admite pagos';
  end if;

  update gt_obligacion
     set estatus = case
       when v_aplicado >= monto_reportado_centavos then 'pagada'
       when v_aplicado > 0 then 'parcialmente_pagada'
       else 'pendiente_pago'
     end
   where id = v_obligacion and estatus <> 'cancelada';

  return null;
end $$;

create constraint trigger tr_gt_validar_aplicacion
  after insert or update or delete on gt_pago_aplicacion
  deferrable initially deferred
  for each row execute function fn_gt_validar_aplicacion();

-- Una obligación con pagos aplicados ya no se cancela ni se altera en su monto.
create or replace function fn_gt_obligacion_protegida() returns trigger
language plpgsql as $$
declare v_aplicado int;
begin
  select coalesce(sum(monto_centavos), 0) into v_aplicado
    from gt_pago_aplicacion where obligacion_id = old.id;

  if v_aplicado > 0 and new.monto_reportado_centavos <> old.monto_reportado_centavos then
    raise exception
      'La obligación % ya tiene pagos aplicados: su monto no se altera. Captura una '
      'obligación nueva o cancela con motivo', old.folio;
  end if;
  if v_aplicado > 0 and new.estatus = 'cancelada' then
    raise exception 'La obligación % tiene pagos aplicados, no se puede cancelar', old.folio;
  end if;
  return new;
end $$;

create trigger tr_gt_obligacion_protegida before update on gt_obligacion
  for each row execute function fn_gt_obligacion_protegida();

-- ─────────────────────────────────────────────────────────────────────────────
-- Liga entre el egreso (dos firmas) y las obligaciones que va a pagar
-- ─────────────────────────────────────────────────────────────────────────────

-- El pago GT viaja dentro de un egreso normal: hereda las dos firmas y la
-- entrega con comprobante. Esta tabla guarda qué obligaciones va a cubrir; al
-- registrar la entrega, la aplicación se materializa en gt_pago_aplicacion.
create table egreso_gt_obligacion (
  egreso_id      bigint not null references egreso(id) on delete cascade,
  obligacion_id  bigint not null references gt_obligacion(id),
  monto_centavos int not null check (monto_centavos > 0),
  primary key (egreso_id, obligacion_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Folios GT
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_gt_folio_obligacion(p_anio int, p_tipo text) returns text
language plpgsql as $$
declare
  v_prefijo text := case when p_tipo = 'regularizacion' then 'REG' else 'GT' end;
  v_num int;
begin
  perform pg_advisory_xact_lock(hashtext('folio_gt_obligacion_' || v_prefijo || p_anio));
  select coalesce(max(nullif(regexp_replace(folio, '^' || v_prefijo || '-\d{4}-', ''), '')::int), 0) + 1
    into v_num
    from gt_obligacion
   where folio ~ ('^' || v_prefijo || '-' || p_anio || '-\d+$');
  return v_prefijo || '-' || p_anio || '-' || lpad(v_num::text, 4, '0');
end $$;

create or replace function fn_gt_folio_pago(p_anio int) returns text
language plpgsql as $$
declare v_num int;
begin
  perform pg_advisory_xact_lock(hashtext('folio_gt_pago_' || p_anio));
  select coalesce(max(nullif(regexp_replace(folio, '^GTP-\d{4}-', ''), '')::int), 0) + 1
    into v_num
    from gt_pago
   where folio ~ ('^GTP-' || p_anio || '-\d+$');
  return 'GTP-' || p_anio || '-' || lpad(v_num::text, 4, '0');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vistas de negocio GT
-- ─────────────────────────────────────────────────────────────────────────────

-- Cálculo esperado: membresía vigente por tarifas vigentes. Informativo.
create or replace view v_gt_calculo_esperado as
with membresia as (select * from v_gt_membresia_actual)
select t.concepto,
       t.descripcion,
       case when t.concepto = 'capita'
            then coalesce((select con_capita from membresia), 0)
            else 1 end as cantidad,
       t.monto_centavos as tarifa_centavos,
       (case when t.concepto = 'capita'
             then coalesce((select con_capita from membresia), 0)
             else 1 end * t.monto_centavos)::int as subtotal_centavos
  from v_gt_tarifa_vigente t
 order by case t.concepto when 'capita' then 1 when 'templo' then 2
                          when 'locker' then 3 else 4 end;

create or replace view v_gt_obligaciones_pendientes as
select o.id, o.folio, o.tipo, o.periodo_desde::text, o.periodo_hasta::text,
       o.fecha_documento, o.monto_reportado_centavos, o.monto_esperado_centavos,
       o.estatus, o.hermano_id,
       coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                  where a.obligacion_id = o.id), 0) as pagado_centavos,
       (o.monto_reportado_centavos
         - coalesce((select sum(a.monto_centavos)::int from gt_pago_aplicacion a
                      where a.obligacion_id = o.id), 0)) as saldo_centavos
  from gt_obligacion o
 where o.estatus in ('pendiente_pago', 'parcialmente_pagada')
 order by o.periodo_desde, o.id;

-- Meses del ejercicio cubiertos por obligaciones ordinarias pagadas.
create or replace view v_gt_periodos_cubiertos as
with meses as (
  select generate_series(e.fecha_inicio, e.fecha_fin, interval '1 month')::date as periodo,
         e.anio
    from ejercicio e
)
select mm.anio,
       mm.periodo,
       exists (
         select 1 from gt_obligacion o
          where o.tipo = 'ordinaria' and o.estatus = 'pagada'
            and mm.periodo between o.periodo_desde and o.periodo_hasta
       ) as cubierto,
       (select coalesce(sum(a.monto_centavos), 0)::int
          from gt_obligacion o
          join gt_pago_aplicacion a on a.obligacion_id = o.id
         where o.tipo = 'ordinaria'
           and mm.periodo between o.periodo_desde and o.periodo_hasta) as pagado_centavos
  from meses mm
 order by mm.periodo;

-- El estatus "a plomo" nunca se almacena: se deriva del estado de las
-- obligaciones, con lo ordinario y las regularizaciones por separado.
create or replace view v_gt_estado_aplomo as
with hasta_hoy as (
  select * from v_gt_periodos_cubiertos
   where periodo <= date_trunc('month', current_date)::date
),
primer_hueco as (
  select min(periodo) as periodo from hasta_hoy where not cubierto
)
select
  (select max(periodo)::text from hasta_hoy
    where cubierto
      and periodo < coalesce((select periodo from primer_hueco), '9999-01-01'))
    as cubierto_hasta,
  (select periodo::text from primer_hueco) as primer_pendiente,
  (select count(*)::int from hasta_hoy where not cubierto) as meses_pendientes,
  ((select count(*) from hasta_hoy
     where not cubierto and periodo < date_trunc('month', current_date)::date) = 0)
    as ordinario_a_plomo,
  (select count(*)::int from gt_obligacion
    where tipo = 'regularizacion' and estatus in ('pendiente_pago', 'parcialmente_pagada'))
    as regularizaciones_pendientes,
  (select count(*)::int from gt_obligacion
    where tipo in ('tramite', 'extraordinaria')
      and estatus in ('pendiente_pago', 'parcialmente_pagada'))
    as otras_pendientes;

-- Exposición a regularización: hermanos internos que GT aún no cobra. La cifra
-- es una advertencia administrativa; la deuda nace cuando GT emite su cálculo.
create or replace view v_gt_exposicion_regularizacion as
select h.id as hermano_id,
       h.nombre_completo,
       coalesce(gt.estatus, 'desconocido') as estatus_gt,
       greatest(h.fecha_ingreso, e.fecha_inicio) as desde,
       (extract(year from age(date_trunc('month', current_date),
                              date_trunc('month', greatest(h.fecha_ingreso, e.fecha_inicio))))::int * 12
        + extract(month from age(date_trunc('month', current_date),
                                 date_trunc('month', greatest(h.fecha_ingreso, e.fecha_inicio))))::int
        + 1) as meses_potenciales
  from hermano h
  cross join lateral (
    select fecha_inicio from ejercicio order by anio desc limit 1
  ) e
  left join hermano_gran_tesoreria gt on gt.hermano_id = h.id
 where h.estatus = 'activo'
   and coalesce(gt.estatus, 'desconocido') <> 'activo'
 order by meses_potenciales desc, h.nombre_completo;
