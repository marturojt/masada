-- 030_membresia_solo_documento.sql
--
-- La membresía queda como lo que es para la tesorería: el respaldo del
-- documento que manda la Gran Tesorería, para consultarlo. Ya no se capturan
-- sus renglones (los que existan se conservan para consulta) y no alimenta
-- ningún cálculo, así que una membresía registrada dos veces por error se
-- puede eliminar.
--
-- Para que eliminarla no deje nada colgado:
-- - Las obligaciones que la citaban (de cuando servía para el cálculo
--   esperado) se quedan sin esa referencia.
-- - Si tenía un cierre "sin evidencia formal" en Pendientes, se va con ella.
-- Los renglones ya se borraban en cascada.

alter table gt_obligacion drop constraint gt_obligacion_membresia_id_fkey;
alter table gt_obligacion add constraint gt_obligacion_membresia_id_fkey
  foreign key (membresia_id) references gt_membresia(id) on delete set null;

create or replace function fn_gt_membresia_eliminada() returns trigger
language plpgsql as $$
begin
  delete from evidencia_dispensa
   where entidad = 'gt_membresia' and entidad_id = old.id;
  return old;
end $$;

create trigger tr_gt_membresia_eliminada
  after delete on gt_membresia
  for each row execute function fn_gt_membresia_eliminada();

comment on table gt_membresia is
  'Respaldo del documento con el que la Gran Tesorería reporta a quién reconoce '
  'de Masada. Es de consulta: no alimenta cálculos ni concilia. Una capturada '
  'por error se elimina con motivo en la bitácora.';

comment on table gt_membresia_hermano is
  'Renglones capturados cuando la membresía se conciliaba. Ya no se capturan; '
  'los existentes se conservan para consulta.';
