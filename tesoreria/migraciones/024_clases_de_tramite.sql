-- 024_clases_de_tramite.sql
--
-- Cómo funciona un trámite en la vida real: el tesorero va a la Gran
-- Tesorería, pregunta cuánto cuesta, y lo paga en ese momento. No ampara
-- meses: tiene UNA fecha de solicitud, un hermano y una clase. Las clases
-- fijas llevan su regla de grado (iniciación da aprendiz, aumento de salario
-- da compañero, exaltación da maestro, como ya lo hace el padrón), y "otro"
-- cubre los trámites administrativos con nombre libre, como una carta de
-- regularidad para grados filosóficos.

alter table gt_obligacion add column tramite_clase text
  check (tramite_clase in ('iniciacion', 'afiliacion', 'aumento_salario',
                           'exaltacion', 'otro'));

alter table gt_obligacion add column tramite_descripcion text;

-- La clase solo tiene sentido en un trámite. Los trámites viejos pueden no
-- tener clase (se capturaron antes de esta migración); los nuevos la llevan
-- desde la aplicación.
alter table gt_obligacion add constraint tramite_clase_solo_en_tramite
  check (tramite_clase is null or tipo = 'tramite');

-- Un trámite "otro" sin nombre no le dice nada a nadie en el corte.
alter table gt_obligacion add constraint tramite_otro_con_descripcion
  check (tramite_clase is distinct from 'otro' or tramite_descripcion is not null);

comment on column gt_obligacion.tramite_clase is
  'Solo en trámites: iniciación, afiliación, aumento de salario, exaltación u '
  'otro trámite administrativo (con descripción obligatoria).';
