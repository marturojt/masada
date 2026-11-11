-- 027_ajuste_de_capitas.sql
--
-- El ajuste de cápitas es un trámite que sí pasa en la ventanilla: un hermano
-- al que se inició hace meses y cuyo trámite no se concluyó entra después a la
-- membresía, y para que la Gran Tesorería respete su fecha de iniciación hay
-- que pagar las cápitas de esos meses. Caso real: Cristian Colín Chavero,
-- iniciado en noviembre de 2025, ajuste de diciembre de 2025 a octubre de 2026
-- pagado el 4 de noviembre de 2026 (recibo Aju-124396).
--
-- Es un trámite (un hermano, un cobro, su recibo) y no una obligación
-- ordinaria: no cuenta para el a plomo de la logia, que solo mira las
-- ordinarias. A diferencia de los otros trámites, su periodo sí dice algo: los
-- meses que el ajuste cubre.

alter table gt_obligacion drop constraint gt_obligacion_tramite_clase_check;

alter table gt_obligacion add constraint gt_obligacion_tramite_clase_check check (
  tramite_clase in ('iniciacion', 'afiliacion', 'aumento_salario', 'exaltacion',
                    'ajuste_capitas', 'otro')
);

comment on column gt_obligacion.tramite_clase is
  'Solo en trámites: iniciación, afiliación, aumento de salario, exaltación, '
  'ajuste de cápitas (su periodo son los meses que cubre) u otro trámite '
  'administrativo (con descripción obligatoria).';

-- Los ajustes que se capturaron antes como "otro trámite" con ese nombre pasan
-- a su clase. El nombre se queda como descripción; los meses que cubren se
-- corrigen desde la ficha de la obligación.
update gt_obligacion
   set tramite_clase = 'ajuste_capitas'
 where tipo = 'tramite'
   and tramite_clase = 'otro'
   and tramite_descripcion ~* '^\s*ajuste\s+de\s+c[aá]pitas';
