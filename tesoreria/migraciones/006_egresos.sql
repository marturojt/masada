-- 006_egresos.sql
-- Egresos: documento con máquina de estados, dos firmas, comprobantes y el caso
-- particular del pago de cápitas a la Gran Tesorería.
--
-- El egreso es el documento; el dinero que sale es un movimiento del libro. Están
-- separados para poder representar "entregué 3,000, comprobó 2,600, devolvió 400"
-- sin ensuciar el saldo de caja.

create table egreso (
  id                        bigint generated always as identity primary key,
  -- Folio legible, para citarlo en el acta de la tenida.
  folio                     text not null unique,
  fecha_solicitud           date not null,
  ejercicio_anio            int not null references ejercicio(anio),
  concepto_id               bigint not null references concepto(id),
  beneficiario              text not null,
  descripcion               text not null,
  hermano_id                bigint references hermano(id),

  monto_solicitado_centavos int not null check (monto_solicitado_centavos between 1 and 100000000),
  monto_autorizado_centavos int check (monto_autorizado_centavos between 1 and 100000000),
  monto_entregado_centavos  int check (monto_entregado_centavos between 1 and 100000000),
  monto_comprobado_centavos int not null default 0 check (monto_comprobado_centavos >= 0),
  monto_devuelto_centavos   int not null default 0 check (monto_devuelto_centavos >= 0),

  requiere_comprobacion     boolean not null default false,

  estado                    text not null default 'registrado'
                            check (estado in ('registrado', 'autorizado', 'rechazado',
                                              'cancelado', 'pagado', 'por_comprobar',
                                              'comprobado')),
  fecha_autorizacion        timestamptz,
  fecha_entrega             date,
  fecha_comprobacion        date,
  motivo_rechazo            text,
  motivo_cancelacion        text,
  notas                     text,

  creado_en                 timestamptz not null default now(),
  creado_por                bigint references usuario(id),
  actualizado_en            timestamptz not null default now(),
  actualizado_por           bigint references usuario(id),

  constraint egreso_beneficiario_no_vacio check (btrim(beneficiario) <> ''),
  constraint egreso_descripcion_no_vacia check (btrim(descripcion) <> ''),
  constraint egreso_anio_coincide check (
    extract(year from fecha_solicitud)::int = ejercicio_anio
  ),
  -- Se puede autorizar por menos de lo pedido, nunca por más: para más dinero se
  -- levanta otro egreso, y así queda su propia firma.
  constraint egreso_autorizado_no_excede check (
    monto_autorizado_centavos is null
    or monto_autorizado_centavos <= monto_solicitado_centavos
  ),
  constraint egreso_rechazo_con_motivo check (
    estado <> 'rechazado' or motivo_rechazo is not null
  ),
  constraint egreso_cancelacion_con_motivo check (
    estado <> 'cancelado' or motivo_cancelacion is not null
  ),
  -- Si el dinero ya salió, hay monto entregado y fecha de entrega.
  constraint egreso_entrega_completa check (
    estado not in ('pagado', 'por_comprobar', 'comprobado')
    or (monto_entregado_centavos is not null and fecha_entrega is not null)
  ),
  -- Lo comprobado más lo devuelto nunca pasa de lo entregado.
  constraint egreso_comprobacion_no_excede check (
    monto_comprobado_centavos + monto_devuelto_centavos
      <= coalesce(monto_entregado_centavos, 0)
  ),
  -- Y para cerrar el ciclo, tiene que cuadrar exacto.
  constraint egreso_comprobado_cuadra check (
    estado <> 'comprobado'
    or monto_comprobado_centavos + monto_devuelto_centavos = monto_entregado_centavos
  )
);

comment on column egreso.estado is
  'pagado y por_comprobar significan los dos que el dinero ya salió de caja. La '
  'diferencia es si falta rendir cuentas. comprobado cierra el ciclo: recibos más '
  'devolución igual a lo entregado.';

create index egreso_estado_idx on egreso (estado);
create index egreso_ejercicio_idx on egreso (ejercicio_anio, fecha_solicitud desc);
create index egreso_concepto_idx on egreso (concepto_id);

create trigger tr_egreso_toca before update on egreso
  for each row execute function fn_toca_timestamp();

-- Ahora que existe egreso, el libro puede apuntarle.
alter table movimiento
  add constraint movimiento_egreso_fk foreign key (egreso_id) references egreso(id);

-- Un egreso mueve dinero hacia afuera una sola vez. Las devoluciones son
-- movimientos de ingreso ligados al mismo egreso, y de esas puede haber varias.
create unique index egreso_una_sola_salida
  on movimiento (egreso_id) where tipo = 'egreso' and egreso_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Folio
-- ─────────────────────────────────────────────────────────────────────────────

-- Consecutivo por ejercicio, sin huecos. El bloqueo por año evita que dos
-- capturas simultáneas tomen el mismo número.
create or replace function fn_siguiente_folio(p_anio int) returns text
language plpgsql as $$
declare v_num int;
begin
  perform pg_advisory_xact_lock(hashtext('folio_egreso_' || p_anio));
  select coalesce(max(nullif(regexp_replace(folio, '^EG-\d{4}-', ''), '')::int), 0) + 1
    into v_num
    from egreso
   where ejercicio_anio = p_anio and folio ~ ('^EG-' || p_anio || '-\d+$');
  return 'EG-' || p_anio || '-' || lpad(v_num::text, 4, '0');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Firmas
-- ─────────────────────────────────────────────────────────────────────────────

-- Una fila por firma requerida. Todo egreso necesita las dos: tesorero y
-- Venerable Maestro.
create table egreso_firma (
  id               bigint generated always as identity primary key,
  egreso_id        bigint not null references egreso(id) on delete cascade,
  rol_requerido    text not null check (rol_requerido in ('tesorero', 'venerable_maestro')),
  firmado_por      bigint not null references usuario(id),
  rol_firmante     text not null check (rol_firmante in ('tesorero', 'venerable_maestro')),
  es_suplencia     boolean not null default false,
  motivo_suplencia text,
  firmado_en       timestamptz not null default now(),
  unique (egreso_id, rol_requerido),

  -- Si quien firma no es del rol requerido, es suplencia y hay que justificarla.
  constraint firma_suplencia_coherente check (
    (rol_firmante = rol_requerido and not es_suplencia and motivo_suplencia is null)
    or (rol_firmante <> rol_requerido and es_suplencia and motivo_suplencia is not null)
  ),
  -- Suplencia asimétrica: el V∴M∴ puede cubrir la firma del tesorero, no al revés.
  constraint solo_vm_suple check (
    not es_suplencia
    or (rol_requerido = 'tesorero' and rol_firmante = 'venerable_maestro')
  )
);

comment on constraint solo_vm_suple on egreso_firma is
  'El Venerable Maestro puede firmar por el tesorero cuando no está, dejando '
  'constancia del motivo. El tesorero no puede firmar por el Venerable Maestro.';

create index egreso_firma_egreso_idx on egreso_firma (egreso_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Documentos
-- ─────────────────────────────────────────────────────────────────────────────

create table egreso_documento (
  id             bigint generated always as identity primary key,
  egreso_id      bigint not null references egreso(id) on delete cascade,
  tipo           text not null
                 check (tipo in ('calculo_gran_tesoreria', 'comprobante_pago', 'recibo',
                                 'factura', 'otro')),
  fecha          date not null,
  -- Solo los recibos y facturas comprueban un monto; el comprobante de pago es
  -- evidencia de que se pagó, no una comprobación de gasto.
  monto_centavos int check (monto_centavos > 0),
  descripcion    text,
  archivo_id     bigint references archivo(id),
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id),
  constraint documento_comprobatorio_con_monto check (
    tipo not in ('recibo', 'factura') or monto_centavos is not null
  )
);

create index egreso_documento_egreso_idx on egreso_documento (egreso_id);
create index egreso_documento_archivo_idx on egreso_documento (archivo_id)
  where archivo_id is not null;

-- El monto comprobado no se captura: es la suma de los recibos y facturas.
create or replace function fn_recalcular_comprobado() returns trigger
language plpgsql as $$
declare v_egreso bigint := coalesce(new.egreso_id, old.egreso_id);
begin
  update egreso e
     set monto_comprobado_centavos = coalesce((
           select sum(d.monto_centavos)::int
             from egreso_documento d
            where d.egreso_id = e.id and d.tipo in ('recibo', 'factura')
         ), 0)
   where e.id = v_egreso;
  return null;
end $$;

create trigger tr_recalcular_comprobado
  after insert or update or delete on egreso_documento
  for each row execute function fn_recalcular_comprobado();

-- ─────────────────────────────────────────────────────────────────────────────
-- Pago a la Gran Tesorería
-- ─────────────────────────────────────────────────────────────────────────────

-- El monto no se calcula aquí: lo determina la Gran Tesorería según los hermanos
-- que tiene registrados. Se guarda el cálculo que envía y el comprobante del pago,
-- y se admite más de un pago por mes, porque hay retroactivos de hermanos que no
-- estaban regularizados.
create table egreso_gran_tesoreria (
  egreso_id      bigint primary key references egreso(id) on delete cascade,
  tipo_pago      text not null
                 check (tipo_pago in ('ordinario', 'retroactivo', 'extraordinario')),
  periodo_desde  date not null,
  periodo_hasta  date not null,
  capitas        int check (capitas >= 0),
  notas          text,
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id),
  constraint gt_periodos_dia_uno check (
    extract(day from periodo_desde) = 1 and extract(day from periodo_hasta) = 1
  ),
  constraint gt_periodos_en_orden check (periodo_hasta >= periodo_desde)
);

comment on table egreso_gran_tesoreria is
  'periodo_desde y periodo_hasta amparan los meses que cubre el pago. Un pago '
  'ordinario suele cubrir un mes; un retroactivo puede cubrir varios.';

comment on column egreso_gran_tesoreria.capitas is
  'Número de cápitas que ampara, informativo: sirve para conciliar contra el '
  'padrón, no para calcular el monto.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Máquina de estados
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_egreso_transicion() returns trigger
language plpgsql as $$
declare v_firmas int;
begin
  if old.estado = new.estado then return new; end if;

  if not (case old.estado
            when 'registrado'    then new.estado in ('autorizado', 'rechazado', 'cancelado')
            when 'autorizado'    then new.estado in ('pagado', 'por_comprobar', 'cancelado')
            when 'por_comprobar' then new.estado = 'comprobado'
            else false
          end)
  then
    raise exception 'No se puede pasar de "%" a "%"', old.estado, new.estado;
  end if;

  if new.estado = 'autorizado' then
    select count(distinct rol_requerido) into v_firmas
      from egreso_firma where egreso_id = new.id;
    if v_firmas < 2 then
      raise exception
        'Faltan firmas: se requieren la del tesorero y la del Venerable Maestro. '
        'El V∴M∴ puede cubrir la del tesorero dejando constancia del motivo';
    end if;
    new.fecha_autorizacion := coalesce(new.fecha_autorizacion, now());
    new.monto_autorizado_centavos :=
      coalesce(new.monto_autorizado_centavos, old.monto_solicitado_centavos);
  end if;

  if new.estado in ('pagado', 'por_comprobar') then
    if new.requiere_comprobacion and new.estado = 'pagado' then
      raise exception
        'Este egreso se entrega por comprobar, no se puede marcar como pagado directo';
    end if;
    if new.monto_entregado_centavos > coalesce(new.monto_autorizado_centavos, 0) then
      raise exception 'Lo entregado (%) pasa de lo autorizado (%)',
        fn_pesos(new.monto_entregado_centavos),
        fn_pesos(coalesce(new.monto_autorizado_centavos, 0));
    end if;
  end if;

  return new;
end $$;

create trigger tr_egreso_transicion before update of estado on egreso
  for each row execute function fn_egreso_transicion();

-- Los estados terminales no se editan: un error posterior se corrige con un
-- movimiento de ajuste, nunca reescribiendo el documento.
create or replace function fn_egreso_terminal() returns trigger
language plpgsql as $$
begin
  if old.estado in ('rechazado', 'cancelado', 'comprobado')
     and new.estado = old.estado
     and (new.monto_solicitado_centavos, new.monto_autorizado_centavos,
          new.monto_entregado_centavos, new.beneficiario, new.descripcion)
         is distinct from
         (old.monto_solicitado_centavos, old.monto_autorizado_centavos,
          old.monto_entregado_centavos, old.beneficiario, old.descripcion)
  then
    raise exception
      'El egreso % está en estado "%" y ya no se edita. Corrige con un movimiento de ajuste',
      old.folio, old.estado;
  end if;
  return new;
end $$;

create trigger tr_egreso_terminal before update on egreso
  for each row execute function fn_egreso_terminal();

-- ─────────────────────────────────────────────────────────────────────────────
-- Vistas
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view v_pendiente_comprobar as
select e.id,
       e.folio,
       e.fecha_entrega,
       e.beneficiario,
       e.descripcion,
       c.nombre as concepto_nombre,
       e.monto_entregado_centavos,
       e.monto_comprobado_centavos,
       e.monto_devuelto_centavos,
       e.monto_entregado_centavos - e.monto_comprobado_centavos - e.monto_devuelto_centavos
         as pendiente_centavos,
       (current_date - e.fecha_entrega) as dias_sin_comprobar
  from egreso e
  join concepto c on c.id = e.concepto_id
 where e.estado = 'por_comprobar'
 order by e.fecha_entrega;

-- Conciliación de cápitas pagadas a la Gran Tesorería contra el padrón activo del
-- mes. La diferencia no es necesariamente un error: la Gran Tesorería suele ir
-- desfasada de la Gran Secretaría, y de ahí salen los pagos retroactivos.
create or replace view v_conciliacion_gran_tesoreria as
with meses as (
  select generate_series(e.fecha_inicio, e.fecha_fin, interval '1 month')::date as periodo,
         e.anio
    from ejercicio e
),
padron as (
  select mm.periodo,
         count(*)::int as capitas_padron
    from meses mm
    join hermano h
      on h.fecha_ingreso <= (mm.periodo + interval '1 month - 1 day')::date
     and (h.fecha_baja is null or h.fecha_baja >= mm.periodo)
   group by mm.periodo
),
pagado as (
  select mm.periodo,
         sum(gt.capitas)::int as capitas_pagadas,
         sum(m.monto_centavos)::int as monto_centavos,
         count(*)::int as pagos
    from meses mm
    join egreso_gran_tesoreria gt
      on mm.periodo between gt.periodo_desde and gt.periodo_hasta
    join egreso e on e.id = gt.egreso_id
    left join movimiento m on m.egreso_id = e.id and m.tipo = 'egreso'
   where e.estado in ('pagado', 'por_comprobar', 'comprobado')
   group by mm.periodo
)
select mm.periodo,
       mm.anio,
       coalesce(p.capitas_padron, 0) as capitas_padron,
       coalesce(g.capitas_pagadas, 0) as capitas_pagadas,
       coalesce(p.capitas_padron, 0) - coalesce(g.capitas_pagadas, 0) as diferencia,
       coalesce(g.monto_centavos, 0) as monto_centavos,
       coalesce(g.pagos, 0) as pagos
  from meses mm
  left join padron p on p.periodo = mm.periodo
  left join pagado g on g.periodo = mm.periodo
 order by mm.periodo;
