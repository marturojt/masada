-- 021_conversion_tolerante.sql
--
-- Lo que enseñó el primer caso real en producción (Miller): una promoción con
-- pagos que se "cambió a mensual" por la reasignación normal deja el cargo
-- pagado vivo Y doce mensualidades: esperado de 11,000 en lugar de 5,750.
--
-- Dos remedios, uno preventivo y uno correctivo:
--
-- 1. fn_asignar_capita ya no acepta reasignar a un hermano con promoción
--    pagada: manda a la conversión, que es el camino que hace bien la cuenta.
-- 2. fn_convertir_promocion_a_mensual ya no exige que el plan vigente sea de
--    promoción: repara también el estado torcido. Cancela las mensualidades
--    sin pago anteriores al mes del cambio (ese tramo lo ampara la promoción
--    saldada), recorre el cargo de la promoción a un mes de ese tramo, y
--    completa las mensualidades del cambio a diciembre.

create or replace function fn_asignar_capita(
  p_hermano_id       bigint,
  p_anio             int,
  p_modalidad        text,
  p_mes_promocion    int default null,
  p_autorizado_por   bigint default null,
  p_motivo           text default null,
  p_monto_promocion  int default null
) returns bigint
language plpgsql as $$
declare
  v_ej            ejercicio;
  v_h             hermano;
  v_mes_alta      int;
  v_mes_baja      int;
  v_cubierto      int := 0;
  v_total         int;
  v_plan_anterior bigint;
  v_plan_id       bigint;
  v_mes           int;
  v_periodo       date;
begin
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

  -- Una promoción con pagos vigente no se reasigna por aquí: el cargo pagado
  -- sobrevive y nacerían meses duplicados (el estado de 11,000 que ya pasó).
  -- El camino correcto es la conversión, que salda la promoción en lo pagado.
  if exists (
    select 1 from capita_cargo cc
     where cc.hermano_id = p_hermano_id
       and cc.ejercicio_anio = p_anio
       and cc.estado = 'vigente'
       and cc.clase = 'promocion'
       and exists (select 1 from capita_aplicacion ca where ca.capita_cargo_id = cc.id)
  ) then
    raise exception
      'Este hermano tiene una promoción con pagos. Cambiarle la modalidad por aquí '
      'duplicaría cargos: usa "Convertir la promoción a mensual" en su ficha de cápitas';
  end if;

  -- Mes en que empieza a contar dentro del ejercicio, y último mes exigible.
  v_mes_alta := case
    when extract(year from v_h.fecha_ingreso)::int > p_anio then null
    when extract(year from v_h.fecha_ingreso)::int = p_anio
      then extract(month from v_h.fecha_ingreso)::int
    else 1
  end;

  if v_mes_alta is null then
    raise exception
      'El hermano ingresó en % y no le corresponde cápita de %',
      extract(year from v_h.fecha_ingreso)::int, p_anio;
  end if;

  v_mes_baja := case
    when v_h.fecha_baja is not null and extract(year from v_h.fecha_baja)::int = p_anio
      then extract(month from v_h.fecha_baja)::int
    when v_h.fecha_baja is not null and extract(year from v_h.fecha_baja)::int < p_anio
      then 0
    else 12
  end;

  if v_mes_baja = 0 then
    raise exception 'Ese hermano causó baja antes de %, no le corresponde cápita', p_anio;
  end if;

  -- Reglas de modalidad según el mes de alta.
  if p_modalidad = 'promocion' and v_mes_alta > 1 then
    raise exception
      'La promoción es solo para quien está desde enero. Este hermano ingresó en el mes %, '
      'le corresponde prorrateo', v_mes_alta;
  end if;
  if p_modalidad = 'prorrateo' and v_mes_alta = 1 then
    raise exception
      'El prorrateo es para quien ingresa dentro del año. Este hermano ya estaba desde enero, '
      'le corresponde mensual o promoción';
  end if;
  if p_modalidad = 'mensual' and v_mes_alta > 1 then
    raise exception
      'Este hermano ingresó en el mes %, su modalidad es prorrateo', v_mes_alta;
  end if;

  -- Lo ya cubierto del ejercicio, en pagos y en exenciones.
  select coalesce(sum(
           coalesce((select sum(ca.monto_aplicado_centavos) from capita_aplicacion ca
                      where ca.capita_cargo_id = cc.id), 0)
           + coalesce((select sum(co.monto_centavos) from capita_condonacion co
                        where co.capita_cargo_id = cc.id), 0)
         ), 0)
    into v_cubierto
    from capita_cargo cc
   where cc.hermano_id = p_hermano_id
     and cc.ejercicio_anio = p_anio
     and cc.estado = 'vigente';

  -- Los meses sin nada cubierto se cancelan; los que ya tienen algo se conservan.
  update capita_cargo cc
     set estado = 'cancelado',
         motivo_cancelacion = coalesce(p_motivo, 'cambio de modalidad de cápita'),
         cancelado_por = fn_usuario_actual(),
         cancelado_en = now()
   where cc.hermano_id = p_hermano_id
     and cc.ejercicio_anio = p_anio
     and cc.estado = 'vigente'
     and not exists (select 1 from capita_aplicacion ca where ca.capita_cargo_id = cc.id)
     and not exists (select 1 from capita_condonacion co where co.capita_cargo_id = cc.id);

  select id into v_plan_anterior
    from capita_plan
   where hermano_id = p_hermano_id and ejercicio_anio = p_anio and vigente;

  update capita_plan set vigente = false
   where hermano_id = p_hermano_id and ejercicio_anio = p_anio and vigente;

  -- Total esperado según la modalidad.
  if p_modalidad = 'promocion' then
    if p_monto_promocion is not null and p_monto_promocion <= 0 then
      raise exception 'El monto de la dispensa debe ser mayor que cero';
    end if;
    v_total := coalesce(p_monto_promocion, v_ej.capita_promocion_centavos) - v_cubierto;
    if v_total <= 0 then
      raise exception
        'La promoción no procede: este hermano ya cubrió % del ejercicio, igual o más que '
        'la promoción de %',
        (v_cubierto::numeric / 100)::text,
        (coalesce(p_monto_promocion, v_ej.capita_promocion_centavos)::numeric / 100)::text;
    end if;
  else
    v_total := v_ej.capita_mensual_centavos * (v_mes_baja - v_mes_alta + 1) - v_cubierto;
    if v_total < 0 then v_total := 0; end if;
  end if;

  insert into capita_plan
    (hermano_id, ejercicio_anio, modalidad, mes_desde, mes_hasta, monto_mensual_centavos,
     monto_total_centavos, autorizado_por, autorizado_en, motivo, reemplaza_a,
     creado_por, actualizado_por)
  values (
    p_hermano_id, p_anio, p_modalidad,
    case when p_modalidad = 'promocion' then coalesce(p_mes_promocion, 1) else v_mes_alta end,
    case when p_modalidad = 'promocion' then coalesce(p_mes_promocion, 1) else v_mes_baja end,
    case when p_modalidad = 'promocion' then v_total else v_ej.capita_mensual_centavos end,
    v_total,
    case when p_modalidad = 'promocion'
           then coalesce(p_autorizado_por, fn_usuario_actual()) end,
    case when p_modalidad = 'promocion' then now() end,
    p_motivo, v_plan_anterior, fn_usuario_actual(), fn_usuario_actual()
  )
  returning id into v_plan_id;

  if p_modalidad = 'promocion' then
    v_periodo := make_date(p_anio, coalesce(p_mes_promocion, 1), 1);
    -- Si ese mes ya tiene un cargo mensual cubierto, la promoción va al mes siguiente
    -- libre, para no chocar con el índice de un cargo vigente por mes.
    while exists (
      select 1 from capita_cargo
       where hermano_id = p_hermano_id and periodo = v_periodo and estado = 'vigente'
    ) and extract(month from v_periodo)::int < 12 loop
      v_periodo := v_periodo + interval '1 month';
    end loop;

    insert into capita_cargo
      (plan_id, hermano_id, ejercicio_anio, periodo, monto_esperado_centavos, clase, creado_por)
    values (v_plan_id, p_hermano_id, p_anio, v_periodo, v_total, 'promocion',
            fn_usuario_actual());
  else
    for v_mes in v_mes_alta .. v_mes_baja loop
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
  end if;

  return v_plan_id;
end $$;

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
  if v_plan.id is null then
    raise exception 'Este hermano no tiene modalidad asignada en %', p_anio;
  end if;

  -- El ancla es el cargo de promoción con pagos, sin importar qué plan quedó
  -- vigente: así también repara una reasignación equivocada.
  select cc.* into v_cargo
    from capita_cargo cc
   where cc.hermano_id = p_hermano_id
     and cc.ejercicio_anio = p_anio
     and cc.estado = 'vigente'
     and cc.clase = 'promocion';
  if v_cargo.id is null then
    raise exception 'La conversión es para un hermano con cargo de promoción vigente';
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

  v_mes_baja := case
    when v_h.fecha_baja is not null and extract(year from v_h.fecha_baja)::int = p_anio
      then extract(month from v_h.fecha_baja)::int
    else 12
  end;
  if p_mes_desde > v_mes_baja then
    raise exception 'El mes del cambio (%) es posterior a la baja del hermano', p_mes_desde;
  end if;

  -- Las mensualidades anteriores al cambio no van: ese tramo lo ampara la
  -- promoción saldada. Si alguna tiene pagos, mejor detenerse y revisar a mano.
  if exists (
    select 1 from capita_cargo cc
     where cc.hermano_id = p_hermano_id and cc.ejercicio_anio = p_anio
       and cc.estado = 'vigente' and cc.clase = 'mensual'
       and cc.periodo < make_date(p_anio, p_mes_desde, 1)
       and exists (select 1 from capita_aplicacion ca where ca.capita_cargo_id = cc.id)
  ) then
    raise exception
      'Hay mensualidades con pagos antes del mes del cambio: ese tramo debería ampararlo '
      'la promoción. Revisa los pagos aplicados antes de convertir';
  end if;

  update capita_cargo cc
     set estado = 'cancelado',
         cancelado_en = now(),
         cancelado_por = fn_usuario_actual(),
         motivo_cancelacion = 'Conversión de promoción a mensual: este tramo lo ampara la promoción saldada'
   where cc.hermano_id = p_hermano_id and cc.ejercicio_anio = p_anio
     and cc.estado = 'vigente' and cc.clase = 'mensual'
     and cc.periodo < make_date(p_anio, p_mes_desde, 1)
     and not exists (select 1 from capita_condonacion co where co.capita_cargo_id = cc.id);

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
  --     fechado dentro del tramo mensual, se recorre a un mes libre anterior.
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
