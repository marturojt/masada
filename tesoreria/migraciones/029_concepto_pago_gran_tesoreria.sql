-- 029_concepto_pago_gran_tesoreria.sql
--
-- El concepto de los pagos a la Gran Tesorería nació llamándose "Pago de
-- cápitas a la Gran Tesorería", pero por él salen también los trámites
-- (iniciaciones, afiliaciones, grados), los ajustes de cápitas y las
-- regularizaciones. El nombre se lee en el egreso, el libro de caja y los
-- cortes, y decía algo que no siempre es cierto.
--
-- Solo cambia el nombre, y solo si sigue siendo el original: si ya se
-- renombró desde Conceptos, se respeta. La clave y todo lo ligado no cambian.

update concepto
   set nombre = 'Pago a la Gran Tesorería'
 where clave = 'gran_tesoreria'
   and nombre = 'Pago de cápitas a la Gran Tesorería';
