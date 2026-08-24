-- 009_conceptos_ajuste.sql
--
-- Un movimiento de ajuste va en sentido contrario al que corrige, así que no
-- puede reusar su concepto: un concepto de ingreso no cabe en un egreso. Además,
-- en el corte conviene que los ajustes se lean aparte y no inflando el concepto
-- original.

insert into concepto
  (clave, nombre, naturaleza, tipo_especial, requiere_hermano, requiere_comprobante,
   por_comprobar_por_defecto, seleccionable, orden, notas)
values
  ('ajuste_ingreso', 'Ajuste de un ingreso', 'egreso', 'otro',
   false, false, false, false, 95,
   'Lo genera un movimiento de ajuste que corrige un ingreso ya registrado.'),
  ('ajuste_egreso', 'Ajuste de un egreso', 'ingreso', 'otro',
   false, false, false, false, 95,
   'Lo genera un movimiento de ajuste que corrige un egreso ya registrado.');
