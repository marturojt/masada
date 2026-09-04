-- 023_dispensa_evidencia.sql
--
-- Panel de pendientes de evidencia: lo capturado sin comprobante se persigue
-- desde un solo lugar, y lo que de plano no tiene respaldo documental se
-- cierra como "sin evidencia formal", con motivo y firma de quien lo decidió.
-- La dispensa no borra ni cambia nada del registro: solo deja constancia de
-- que se buscó la evidencia y no la hay, para que el pendiente deje de sonar.

create table evidencia_dispensa (
  id         bigint generated always as identity primary key,
  entidad    text not null check (entidad in
               ('movimiento', 'traspaso', 'aportacion', 'gt_obligacion', 'gt_membresia')),
  entidad_id bigint not null,
  motivo     text not null,
  creado_en  timestamptz not null default now(),
  creado_por bigint not null references usuario(id),
  constraint dispensa_motivo_no_vacio check (btrim(motivo) <> ''),
  unique (entidad, entidad_id)
);

comment on table evidencia_dispensa is
  'Cierres de "sin evidencia formal": el registro queda, la búsqueda quedó '
  'hecha, y el panel de pendientes deja de reclamarlo. Adjuntar la evidencia '
  'después sigue siendo posible donde la entidad lo permita.';
