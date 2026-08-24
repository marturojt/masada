-- 015_aportaciones_clasificacion.sql
--
-- Tres piezas del refinamiento:
--
-- 1. Aportaciones: las monetarias son ingresos normales con recibo; las
--    aportaciones en especie se registran para trazabilidad con constancia
--    propia (APO-) pero NUNCA generan movimiento financiero, ni real ni
--    ficticio. Su valor estimado queda fuera de toda suma de caja.
-- 2. Clasificación de alto nivel en los conceptos, para que el informe mensual
--    separe ingresos y egresos por categoría de negocio.
-- 3. Migración del dominio GT viejo: lo que vivía en egreso_gran_tesoreria se
--    proyecta a gt_obligacion y gt_pago sin inventar datos, y deja de usarse.

-- ─────────────────────────────────────────────────────────────────────────────
-- Aportaciones
-- ─────────────────────────────────────────────────────────────────────────────

create table aportacion (
  id                      bigint generated always as identity primary key,
  tipo                    text not null check (tipo in ('monetaria', 'especie')),
  folio                   text unique,
  hermano_id              bigint references hermano(id),
  aportante_nombre        text not null,
  fecha                   date not null,
  descripcion             text not null,
  destino                 text,
  cantidad                numeric(12,2),
  unidad                  text,
  valor_estimado_centavos int check (valor_estimado_centavos >= 0),
  movimiento_id           bigint unique references movimiento(id),
  documento_id            bigint references archivo(id),
  creado_en               timestamptz not null default now(),
  creado_por              bigint references usuario(id),
  constraint aportacion_nombre_no_vacio check (btrim(aportante_nombre) <> ''),
  constraint aportacion_descripcion_no_vacia check (btrim(descripcion) <> ''),
  -- La monetaria mueve dinero de verdad; la especie jamás.
  constraint aportacion_monetaria_con_movimiento check (
    (tipo = 'monetaria') = (movimiento_id is not null)
  ),
  -- La constancia con folio propio es de las aportaciones en especie; las
  -- monetarias ya tienen su recibo REC del movimiento.
  constraint aportacion_folio_especie check (
    (tipo = 'especie') = (folio is not null)
  ),
  constraint aportacion_especie_con_cantidad check (
    tipo <> 'especie' or cantidad is not null
  )
);

comment on table aportacion is
  'Aportaciones extraordinarias. El valor estimado de una aportación en especie '
  'es informativo y queda expresamente fuera del cálculo de saldos.';

create or replace function fn_folio_aportacion(p_anio int) returns text
language plpgsql as $$
declare v_num int;
begin
  perform pg_advisory_xact_lock(hashtext('folio_aportacion_' || p_anio));
  select coalesce(max(nullif(regexp_replace(folio, '^APO-\d{4}-', ''), '')::int), 0) + 1
    into v_num
    from aportacion
   where folio ~ ('^APO-' || p_anio || '-\d+$');
  return 'APO-' || p_anio || '-' || lpad(v_num::text, 4, '0');
end $$;

-- Las constancias emitidas no se reescriben.
create or replace function fn_aportacion_inmutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las aportaciones no se borran: registra una nota o una corrección nueva';
  end if;
  if (new.tipo, new.folio, new.fecha, new.aportante_nombre, new.cantidad,
      new.valor_estimado_centavos, new.movimiento_id)
     is distinct from
     (old.tipo, old.folio, old.fecha, old.aportante_nombre, old.cantidad,
      old.valor_estimado_centavos, old.movimiento_id)
  then
    raise exception
      'La constancia ya se emitió: sus datos de fondo no se editan. Solo descripción, '
      'destino, documento y observaciones';
  end if;
  return new;
end $$;

create trigger tr_aportacion_inmutable before update or delete on aportacion
  for each row execute function fn_aportacion_inmutable();

create or replace view v_aportaciones_especie_periodo as
select a.id, a.folio, a.fecha,
       date_trunc('month', a.fecha)::date as periodo,
       a.aportante_nombre, a.hermano_id, a.descripcion, a.destino,
       a.cantidad, a.unidad, a.valor_estimado_centavos, a.documento_id
  from aportacion a
 where a.tipo = 'especie'
 order by a.fecha desc, a.id desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- Clasificación de conceptos para el informe mensual
-- ─────────────────────────────────────────────────────────────────────────────

alter table concepto add column clasificacion text
  check (clasificacion in ('ingreso_interno', 'aportacion_monetaria', 'egreso_ordinario',
                           'gt_ordinario', 'gt_regularizacion', 'gt_tramite',
                           'devolucion', 'ajuste'));

update concepto set clasificacion = case
  when tipo_especial = 'capita' then 'ingreso_interno'
  when tipo_especial = 'cuota_grado' then 'ingreso_interno'
  when tipo_especial = 'donativo' then 'aportacion_monetaria'
  when tipo_especial = 'devolucion_por_comprobar' then 'devolucion'
  when clave = 'devolucion_saldo_favor' then 'devolucion'
  when clave like 'ajuste%' then 'ajuste'
  when tipo_especial = 'gran_tesoreria' then 'gt_ordinario'
  when tipo_especial = 'gran_logia_grado' then 'gt_tramite'
  else case when naturaleza = 'ingreso' then 'ingreso_interno' else 'egreso_ordinario' end
end;

alter table concepto alter column clasificacion set not null;

-- Los trámites de grado ante la Gran Logia dejan de capturarse como egresos
-- sueltos: ahora viven en el dominio GT (obligación tipo trámite y su pago).
-- Los conceptos se desactivan sin borrar nada: los movimientos históricos que
-- los usaron conservan su concepto.
update concepto set activo = false where clave like 'gl_%';

-- El comprobante que emite la Gran Tesorería al recibir un pago es un documento
-- con nombre propio.
alter table egreso_documento drop constraint egreso_documento_tipo_check;
alter table egreso_documento add constraint egreso_documento_tipo_check
  check (tipo in ('calculo_gran_tesoreria', 'comprobante_pago', 'recibo', 'factura',
                  'recibo_gt', 'otro'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración del dominio GT viejo
-- ─────────────────────────────────────────────────────────────────────────────

-- Cada fila de egreso_gran_tesoreria se proyecta al dominio nuevo. Solo se
-- derivan datos que ya existen; lo que no puede inferirse queda nulo.
do $$
declare
  r record;
  v_obligacion bigint;
  v_pago bigint;
begin
  for r in
    select egt.*, e.folio as egreso_folio, e.estado as egreso_estado,
           e.fecha_solicitud,
           coalesce(e.monto_entregado_centavos, e.monto_autorizado_centavos,
                    e.monto_solicitado_centavos) as monto,
           e.hermano_id,
           m.id as movimiento_id, m.fecha as fecha_mov, m.bolsa,
           (select d.archivo_id from egreso_documento d
             where d.egreso_id = egt.egreso_id and d.tipo = 'calculo_gran_tesoreria'
               and d.archivo_id is not null
             order by d.id limit 1) as calculo_id
      from egreso_gran_tesoreria egt
      join egreso e on e.id = egt.egreso_id
      left join movimiento m on m.egreso_id = e.id and m.tipo = 'egreso'
     order by egt.egreso_id
  loop
    insert into gt_obligacion
      (folio, tipo, periodo_desde, periodo_hasta, fecha_documento,
       monto_reportado_centavos, estatus, documento_calculo_id, hermano_id,
       observaciones, creado_por, actualizado_por, motivo_cancelacion)
    values (
      fn_gt_folio_obligacion(extract(year from r.fecha_solicitud)::int,
        case r.tipo_pago when 'retroactivo' then 'regularizacion' else 'ordinaria' end),
      case r.tipo_pago
        when 'ordinario' then 'ordinaria'
        when 'retroactivo' then 'regularizacion'
        else 'extraordinaria'
      end,
      r.periodo_desde, r.periodo_hasta, r.fecha_solicitud,
      r.monto,
      case when r.egreso_estado in ('rechazado', 'cancelado') then 'cancelada'
           else 'pendiente_pago' end,
      r.calculo_id, r.hermano_id,
      'Migrada del egreso ' || r.egreso_folio || ' (dominio GT anterior).'
        || coalesce(' ' || r.notas, ''),
      null, null,
      case when r.egreso_estado in ('rechazado', 'cancelado')
           then 'Egreso ' || r.egreso_estado || ' en el dominio anterior' end
    )
    returning id into v_obligacion;

    if r.capitas is not null then
      insert into gt_obligacion_detalle
        (obligacion_id, concepto, cantidad, subtotal_centavos, descripcion)
      values (v_obligacion, 'capita', r.capitas, r.monto,
              'Cápitas informativas del registro anterior; el desglose exacto no se conocía');
    end if;

    -- Liga histórica egreso ↔ obligación, para que un egreso pendiente de
    -- entrega siga el flujo nuevo.
    insert into egreso_gt_obligacion (egreso_id, obligacion_id, monto_centavos)
    values (r.egreso_id, v_obligacion, r.monto)
    on conflict do nothing;

    -- Si el dinero ya salió, el pago y su aplicación se materializan.
    if r.movimiento_id is not null then
      insert into gt_pago
        (folio, fecha_pago, monto_centavos, bolsa, medio_pago, movimiento_id,
         recibo_gt_id, creado_por)
      values (
        fn_gt_folio_pago(extract(year from r.fecha_mov)::int),
        r.fecha_mov,
        r.monto,
        r.bolsa,
        case r.bolsa when 'banco' then 'transferencia' else 'efectivo' end,
        r.movimiento_id,
        null, null
      )
      returning id into v_pago;

      insert into gt_pago_aplicacion (pago_id, obligacion_id, monto_centavos)
      values (v_pago, v_obligacion, r.monto);
    end if;
  end loop;
end $$;

-- La conciliación vieja comparaba contra el padrón interno, que era justo la
-- premisa equivocada: la sustituyen las vistas del dominio GT.
drop view if exists v_conciliacion_gran_tesoreria;

-- ─────────────────────────────────────────────────────────────────────────────
-- Informe mensual: totales por clasificación
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view v_tesoreria_informe_mensual as
select m.periodo,
       m.tipo,
       c.clasificacion,
       c.nombre as concepto_nombre,
       count(*)::int as movimientos,
       sum(m.monto_centavos)::int as monto_centavos
  from movimiento m
  join concepto c on c.id = m.concepto_id
 group by m.periodo, m.tipo, c.clasificacion, c.nombre
 order by m.periodo, m.tipo desc, c.clasificacion, sum(m.monto_centavos) desc;
