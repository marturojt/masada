-- 018_promocion_dos_pagos.sql
--
-- La logia maneja DOS promociones anuales, no una: 5,000 en un solo pago y
-- 5,500 en dos pagos semestrales (el cargo es uno y admite abonos, así que
-- "dos pagos" o los abonos que sean). La tarifa de la segunda vive aquí, en el
-- ejercicio, como todas las tarifas: el día que cambie, los años anteriores
-- conservan la suya.

alter table ejercicio add column capita_promocion_dos_centavos int not null
  default 550000 check (capita_promocion_dos_centavos > 0);

comment on column ejercicio.capita_promocion_dos_centavos is
  'Anual preferencial en dos pagos. El cargo es uno solo y admite abonos.';

-- Abrir el ejercicio siguiente hereda también esta tarifa. Se parte de la
-- versión vigente de la función (la de dos bolsas de la migración 012).
drop function if exists fn_abrir_ejercicio(int, int, int);

create or replace function fn_abrir_ejercicio(
  p_anio                      int,
  p_capita_mensual_centavos   int default null,
  p_capita_promocion_centavos int default null,
  p_capita_promocion_dos_centavos int default null
) returns void
language plpgsql as $$
declare
  v_anterior  ejercicio;
  v_diciembre corte_mensual;
  v_banco     int := 0;
  v_efectivo  int := 0;
begin
  if exists (select 1 from ejercicio where anio = p_anio) then
    raise exception 'El ejercicio % ya existe', p_anio;
  end if;

  select * into v_anterior from ejercicio where anio = p_anio - 1;
  if v_anterior.anio is null then
    raise exception
      'Solo se puede abrir el año siguiente al último ejercicio: falta el %', p_anio - 1;
  end if;

  select * into v_diciembre
    from corte_mensual
   where periodo = make_date(p_anio - 1, 12, 1) and estado = 'cerrado';
  if v_diciembre.id is not null then
    v_banco    := v_diciembre.banco_final_centavos;
    v_efectivo := v_diciembre.efectivo_final_centavos;
  end if;

  insert into ejercicio
    (anio, fecha_inicio, fecha_fin, capita_mensual_centavos, capita_promocion_centavos,
     capita_promocion_dos_centavos, apertura_banco_centavos, apertura_efectivo_centavos, notas,
     creado_por, actualizado_por)
  values (
    p_anio, make_date(p_anio, 1, 1), make_date(p_anio, 12, 31),
    coalesce(p_capita_mensual_centavos, v_anterior.capita_mensual_centavos),
    coalesce(p_capita_promocion_centavos, v_anterior.capita_promocion_centavos),
    coalesce(p_capita_promocion_dos_centavos, v_anterior.capita_promocion_dos_centavos),
    v_banco, v_efectivo,
    case when v_diciembre.id is null
         then 'Abierto antes de cerrar diciembre de ' || (p_anio - 1)::text ||
              '. La apertura se completa sola al cerrar ese corte.'
         else 'Apertura arrastrada del corte de diciembre de ' || (p_anio - 1)::text || '.'
    end,
    fn_usuario_actual(), fn_usuario_actual()
  );
end $$;
