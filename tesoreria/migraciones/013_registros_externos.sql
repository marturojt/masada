-- 013_registros_externos.sql
--
-- Tres realidades administrativas que el sistema deja de asumir sincronizadas:
--
--   A. el padrón interno de Masada (la tabla hermano, que no cambia),
--   B. el registro ante Gran Secretaría (si el hermano ya fue formalizado),
--   C. la presencia ante Gran Tesorería (si aparece en la membresía que GT usa
--      para cobrar cápitas).
--
-- Se modelan como entidades separadas porque las reglas de ambos organismos
-- evolucionan por su cuenta. La conciliación entre los tres universos es
-- informativa: señala diferencias, nunca bloquea operaciones financieras.

create table hermano_gran_secretaria (
  id              bigint generated always as identity primary key,
  hermano_id      bigint not null unique references hermano(id) on delete cascade,
  estatus         text not null default 'desconocido'
                  check (estatus in ('pendiente', 'activo', 'baja', 'desconocido')),
  fecha_registro  date,
  fecha_efectiva  date,
  fecha_baja      date,
  observaciones   text,
  documento_id    bigint references archivo(id),
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id)
);

comment on table hermano_gran_secretaria is
  'Situación del hermano ante la Gran Secretaría, independiente del padrón '
  'interno. Los cambios quedan en la bitácora de la aplicación.';

create trigger tr_hgs_toca before update on hermano_gran_secretaria
  for each row execute function fn_toca_timestamp();

create table hermano_gran_tesoreria (
  id              bigint generated always as identity primary key,
  hermano_id      bigint not null unique references hermano(id) on delete cascade,
  estatus         text not null default 'desconocido'
                  check (estatus in ('pendiente', 'activo', 'baja', 'desconocido')),
  fecha_registro  date,
  fecha_efectiva  date,
  fecha_baja      date,
  observaciones   text,
  documento_id    bigint references archivo(id),
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id)
);

comment on table hermano_gran_tesoreria is
  'Situación del hermano en la membresía que usa la Gran Tesorería para generar '
  'cápitas. Puede ir desfasada del padrón interno y de la Gran Secretaría; las '
  'fotografías documentales viven en gt_membresia.';

create trigger tr_hgt_toca before update on hermano_gran_tesoreria
  for each row execute function fn_toca_timestamp();

-- Conciliación de padrones. Estados según la matriz funcional:
--   interno+gs+gt        conciliado
--   interno+gs sin gt    pendiente_gt
--   interno solo         pendiente_formalizacion
--   presencia externa sin padrón interno activo   inconsistencia
create or replace view v_conciliacion_padrones as
select h.id as hermano_id,
       h.nombre_completo,
       (h.estatus = 'activo') as interno,
       coalesce(gs.estatus, 'desconocido') as estatus_gs,
       coalesce(gt.estatus, 'desconocido') as estatus_gt,
       (coalesce(gs.estatus, 'desconocido') = 'activo') as en_gran_secretaria,
       (coalesce(gt.estatus, 'desconocido') = 'activo') as en_gran_tesoreria,
       case
         when h.estatus = 'activo'
              and coalesce(gs.estatus, '') = 'activo'
              and coalesce(gt.estatus, '') = 'activo' then 'conciliado'
         when h.estatus = 'activo'
              and coalesce(gs.estatus, '') = 'activo' then 'pendiente_gt'
         when h.estatus = 'activo'
              and coalesce(gt.estatus, '') = 'activo'
              and coalesce(gs.estatus, '') <> 'activo' then 'inconsistencia'
         when h.estatus = 'activo' then 'pendiente_formalizacion'
         when coalesce(gs.estatus, '') = 'activo'
              or coalesce(gt.estatus, '') = 'activo' then 'inconsistencia'
         else 'sin_diferencias'
       end as estado,
       gs.fecha_registro as gs_fecha_registro,
       gt.fecha_registro as gt_fecha_registro,
       gs.observaciones as gs_observaciones,
       gt.observaciones as gt_observaciones
  from hermano h
  left join hermano_gran_secretaria gs on gs.hermano_id = h.id
  left join hermano_gran_tesoreria gt on gt.hermano_id = h.id
 order by h.nombre_completo;
