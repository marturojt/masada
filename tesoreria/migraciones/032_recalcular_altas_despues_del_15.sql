-- 032_recalcular_altas_despues_del_15.sql
--
-- La regla del día 15 (migración 031) aplica hacia adelante al asignar la
-- modalidad. Esta migración corrige a quienes ya estaban asignados con el mes
-- de ingreso cobrado de más: ingresaron del 15 en adelante, en el año del
-- ejercicio, y tienen un cargo mensual vigente en su mes de ingreso. Caso real:
-- Adolfo Ponce de León Lima, iniciado el 29 de agosto de 2026.
--
-- Para cada uno: se reasigna su prorrateo con la regla nueva (el mes de más se
-- cancela y su pago se libera) y ese dinero liberado se vuelve a aplicar a sus
-- meses pendientes, del más antiguo al más nuevo, como se aplicó el pago
-- original. Solo ese dinero: un saldo a favor que el hermano ya tuviera no se
-- toca, porque sus salidas siguen siendo decisión de la tesorería.
--
-- Fuera quedan, con aviso: los ejercicios cerrados, las promociones (no tienen
-- cargos mensuales) y quien ingresó del 15 de diciembre en adelante, que ya no
-- tiene cápita ese año y se revisa a mano.

create or replace function fn_recalcular_alta_capita(
  p_hermano_id bigint,
  p_anio       int
) returns int
language plpgsql as $$
declare
  v_antes   int;
  v_despues int;
  v_libre   int;
  m         record;
  c         record;
  v_disp    int;
  v_aplica  int;
begin
  select coalesce(sum(ca.monto_aplicado_centavos), 0) into v_antes
    from capita_aplicacion ca
    join capita_cargo cc on cc.id = ca.capita_cargo_id
   where cc.hermano_id = p_hermano_id and cc.ejercicio_anio = p_anio;

  perform fn_asignar_capita(
    p_hermano_id, p_anio, 'prorrateo', null, null,
    'Recalculado: ingresó del día 15 en adelante, su cápita empieza el mes siguiente');

  select coalesce(sum(ca.monto_aplicado_centavos), 0) into v_despues
    from capita_aplicacion ca
    join capita_cargo cc on cc.id = ca.capita_cargo_id
   where cc.hermano_id = p_hermano_id and cc.ejercicio_anio = p_anio;

  v_libre := v_antes - v_despues;

  -- Lo liberado vuelve a los meses pendientes, desde los pagos de cápita del
  -- hermano que tienen capacidad sin aplicar, del más antiguo al más nuevo.
  for m in
    select mv.id,
           (mv.monto_centavos
             - coalesce((select sum(ca.monto_aplicado_centavos) from capita_aplicacion ca
                          where ca.movimiento_id = mv.id), 0))::int as disponible
      from movimiento mv
      join concepto co on co.id = mv.concepto_id
     where mv.hermano_id = p_hermano_id and mv.tipo = 'ingreso'
       and co.tipo_especial = 'capita'
     order by mv.fecha, mv.id
  loop
    exit when v_libre <= 0;
    v_disp := least(m.disponible, v_libre);
    continue when v_disp <= 0;

    for c in
      select cc.id,
             (cc.monto_esperado_centavos
               - coalesce((select sum(ca.monto_aplicado_centavos) from capita_aplicacion ca
                            where ca.capita_cargo_id = cc.id), 0)
               - coalesce((select sum(cn.monto_centavos) from capita_condonacion cn
                            where cn.capita_cargo_id = cc.id), 0))::int as falta
        from capita_cargo cc
       where cc.hermano_id = p_hermano_id and cc.ejercicio_anio = p_anio
         and cc.estado = 'vigente'
       order by cc.periodo
    loop
      exit when v_disp <= 0;
      continue when c.falta <= 0;
      v_aplica := least(c.falta, v_disp);
      insert into capita_aplicacion
        (movimiento_id, capita_cargo_id, monto_aplicado_centavos, creado_por)
      values (m.id, c.id, v_aplica, fn_usuario_actual())
      on conflict (movimiento_id, capita_cargo_id)
        do update set monto_aplicado_centavos =
          capita_aplicacion.monto_aplicado_centavos + excluded.monto_aplicado_centavos;
      v_disp := v_disp - v_aplica;
      v_libre := v_libre - v_aplica;
    end loop;
  end loop;

  return v_antes - v_despues;
end $$;

comment on function fn_recalcular_alta_capita is
  'Reasigna el prorrateo de un hermano con la regla del día 15 y vuelve a '
  'aplicar a sus meses pendientes solo el dinero que esa reasignación liberó. '
  'Devuelve cuánto se liberó.';

do $$
declare
  r        record;
  v_libre  int;
  v_total  int := 0;
begin
  for r in
    select h.id, h.nombre_completo, h.fecha_ingreso, p.ejercicio_anio as anio
      from hermano h
      join capita_plan p on p.hermano_id = h.id and p.vigente
      join ejercicio e on e.anio = p.ejercicio_anio and e.estado <> 'cerrado'
     where p.modalidad in ('prorrateo', 'mensual')
       and extract(year from h.fecha_ingreso)::int = p.ejercicio_anio
       and extract(day from h.fecha_ingreso)::int >= 15
       and exists (
         select 1 from capita_cargo cc
          where cc.hermano_id = h.id and cc.ejercicio_anio = p.ejercicio_anio
            and cc.estado = 'vigente' and cc.clase = 'mensual'
            and cc.periodo = date_trunc('month', h.fecha_ingreso)::date)
     order by h.nombre_completo
  loop
    if r.fecha_ingreso >= make_date(r.anio, 12, 15) then
      raise notice 'Sin recalcular, revisar a mano: % ingresó el % y ya no tiene cápita de %',
        r.nombre_completo, r.fecha_ingreso, r.anio;
      continue;
    end if;
    v_libre := fn_recalcular_alta_capita(r.id, r.anio);
    v_total := v_total + 1;
    raise notice 'Recalculado: % (ingresó el %), liberado y reaplicado: %',
      r.nombre_completo, r.fecha_ingreso, fn_pesos(v_libre);
  end loop;
  raise notice 'Hermanos recalculados: %', v_total;
end $$;
