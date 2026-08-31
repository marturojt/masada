-- 017_dispensa_y_reclasificacion.sql
--
-- Dos ajustes de cápitas que el uso real pidió:
--
-- 1. El monto de la promoción (anual preferencial) puede variar por dispensa:
--    la función acepta un monto opcional; en blanco usa el del ejercicio. Las
--    llamadas existentes no cambian.
-- 2. Un sobrante de cápita se puede convertir en donativo, con el consentimiento
--    del hermano, en lugar de arrastrarse como saldo a favor a futuros años.
--    La reclasificación son dos movimientos en la misma bolsa que se anulan
--    entre sí en el saldo: sale de cápitas, entra como donativo. El concepto
--    de la salida es propio, para que el corte y la conciliación lo lean claro.

-- La versión anterior tenía seis parámetros: se elimina para que no queden dos
-- sobrecargas ambiguas conviviendo.
drop function if exists fn_asignar_capita(bigint, int, text, int, bigint, text);

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

-- Concepto de la reclasificación: es la contraparte de egreso del donativo que
-- nace del sobrante. No es dinero que salga de la caja: las dos líneas van en
-- la misma bolsa y se anulan.
insert into concepto
  (clave, nombre, naturaleza, tipo_especial, requiere_hermano, requiere_comprobante,
   seleccionable, activo, orden, clasificacion)
values
  ('capita_a_donativo', 'Reclasificación de cápita a donativo', 'egreso', 'otro',
   true, false, false, true, 95, 'ajuste')
on conflict (clave) do nothing;
