-- 019_convertir_promocion.sql
--
-- El caso real que lo motivó: un hermano tomó la anual preferencial de dos
-- pagos (5,500), pagó el primer semestre (2,750) y luego acordó pagar el resto
-- del año mes a mes. Su total termina siendo 2,750 + 6 x 500 = 5,750.
--
-- Reasignar a mensual con fn_asignar_capita no sirve aquí: el cargo de la
-- promoción tiene pagos, sobrevive completo, y además nacerían los doce meses.
-- Esta operación hace la aritmética del trato real:
--
--   1. La promoción se salda en lo ya pagado: el resto se condona, con motivo
--      y autorización (queda en capita_condonacion, visible en la matriz).
--   2. Nace un plan mensual desde el mes del cambio hasta diciembre (o la
--      baja), con sus cargos de tarifa mensual.
--
-- El mes del cambio se indica porque suele ser captura histórica: el acuerdo
-- pudo ser en julio aunque se capture en septiembre.

create or replace function fn_convertir_promocion_a_mensual(
  p_hermano_id bigint,
  p_anio       int,
  p_mes_desde  int,
  p_motivo     text default null
) returns bigint
language plpgsql as $$
declare
  v_ej        ejercicio;
  v_h         hermano;
  v_plan      capita_plan;
  v_cargo     capita_cargo;
  v_pagado    int;
  v_saldo     int;
  v_mes_baja  int;
  v_plan_id   bigint;
  v_mes       int;
begin
  if p_mes_desde is null or p_mes_desde < 1 or p_mes_desde > 12 then
    raise exception 'El mes del cambio debe estar entre 1 y 12';
  end if;

  select * into v_ej from ejercicio where anio = p_anio;
  if v_ej.anio is null then
    raise exception 'No existe el ejercicio %', p_anio;
  end if;
  if v_ej.estado = 'cerrado' then
    raise exception 'El ejercicio % está cerrado', p_anio;
  end if;

  select * into v_h from hermano where id = p_hermano_id;
  if v_h.id is null then
    raise exception 'Ese hermano no está en el padrón';
  end if;

  select * into v_plan
    from capita_plan
   where hermano_id = p_hermano_id and ejercicio_anio = p_anio and vigente;
  if v_plan.id is null or v_plan.modalidad <> 'promocion' then
    raise exception 'La conversión es solo para un plan vigente de promoción';
  end if;

  select cc.* into v_cargo
    from capita_cargo cc
   where cc.plan_id = v_plan.id and cc.estado = 'vigente' and cc.clase = 'promocion';
  if v_cargo.id is null then
    raise exception 'El plan de promoción no tiene su cargo vigente';
  end if;

  select coalesce(sum(monto_aplicado_centavos), 0) into v_pagado
    from capita_aplicacion where capita_cargo_id = v_cargo.id;
  v_saldo := v_cargo.monto_esperado_centavos - v_pagado;
  if v_saldo <= 0 then
    raise exception
      'La promoción ya está saldada: no hay nada que convertir, el hermano terminó de pagarla';
  end if;
  if exists (select 1 from capita_condonacion where capita_cargo_id = v_cargo.id) then
    raise exception 'Ese cargo de promoción ya tiene una exención registrada';
  end if;

  -- 1. La promoción queda saldada en lo pagado: el resto se condona.
  insert into capita_condonacion
    (capita_cargo_id, monto_centavos, motivo, autorizado_por, creado_por)
  values (
    v_cargo.id, v_saldo,
    coalesce(p_motivo, 'Promoción convertida a mensual desde el mes ' || p_mes_desde ||
                       ': lo pagado salda la promoción y el resto del año va mes a mes'),
    fn_usuario_actual(), fn_usuario_actual()
  );

  -- 1b. El cargo de la promoción ampara el tramo ANTERIOR al cambio: si quedó
  --     fechado en un mes del tramo mensual (pasa cuando la captura es tardía),
  --     se recorre al mes libre más cercano antes del cambio, para que cada mes
  --     del tramo nuevo pueda tener su mensualidad.
  if v_cargo.periodo >= make_date(p_anio, p_mes_desde, 1) and p_mes_desde > 1 then
    for v_mes in reverse (p_mes_desde - 1) .. 1 loop
      if not exists (
        select 1 from capita_cargo
         where hermano_id = p_hermano_id
           and periodo = make_date(p_anio, v_mes, 1)
           and estado = 'vigente'
           and id <> v_cargo.id
      ) then
        update capita_cargo set periodo = make_date(p_anio, v_mes, 1)
         where id = v_cargo.id;
        exit;
      end if;
    end loop;
  end if;

  -- 2. Plan mensual desde el mes del cambio.
  v_mes_baja := case
    when v_h.fecha_baja is not null and extract(year from v_h.fecha_baja)::int = p_anio
      then extract(month from v_h.fecha_baja)::int
    else 12
  end;
  if p_mes_desde > v_mes_baja then
    raise exception 'El mes del cambio (%) es posterior a la baja del hermano', p_mes_desde;
  end if;

  update capita_plan set vigente = false
   where hermano_id = p_hermano_id and ejercicio_anio = p_anio and vigente;

  insert into capita_plan
    (hermano_id, ejercicio_anio, modalidad, mes_desde, mes_hasta,
     monto_mensual_centavos, monto_total_centavos, motivo, reemplaza_a,
     creado_por, actualizado_por)
  values (
    p_hermano_id, p_anio, 'mensual', p_mes_desde, v_mes_baja,
    v_ej.capita_mensual_centavos,
    v_ej.capita_mensual_centavos * (v_mes_baja - p_mes_desde + 1),
    coalesce(p_motivo, 'Conversión de promoción a mensual'),
    v_plan.id, fn_usuario_actual(), fn_usuario_actual()
  )
  returning id into v_plan_id;

  for v_mes in p_mes_desde .. v_mes_baja loop
    if not exists (
      select 1 from capita_cargo
       where hermano_id = p_hermano_id
         and periodo = make_date(p_anio, v_mes, 1)
         and estado = 'vigente'
    ) then
      insert into capita_cargo
        (plan_id, hermano_id, ejercicio_anio, periodo, monto_esperado_centavos, clase,
         creado_por)
      values (v_plan_id, p_hermano_id, p_anio, make_date(p_anio, v_mes, 1),
              v_ej.capita_mensual_centavos, 'mensual', fn_usuario_actual());
    end if;
  end loop;

  return v_plan_id;
end $$;

comment on function fn_convertir_promocion_a_mensual is
  'Promoción con pagos que cambia a mensual: lo pagado salda la promoción (el '
  'resto se condona con motivo) y nacen mensualidades desde el mes del cambio.';
