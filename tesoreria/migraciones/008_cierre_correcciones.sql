-- 008_cierre_correcciones.sql
--
-- Dos correcciones al cierre de cortes:
--
-- 1. El bloqueo del mes cerrado impedía el propio sellado de los movimientos:
--    fn_cerrar_corte inserta el corte y enseguida marca corte_id en cada
--    movimiento del mes, y ese update ya encontraba el mes cerrado. Ahora el
--    trigger deja pasar el update que solo cambia corte_id, que es sellar o
--    des-sellar, y sigue bloqueando cualquier cambio de datos.
--
-- 2. to_char con TMMonth devolvía los meses en inglés, porque depende de la
--    configuración regional del servidor. Los mensajes los lee el tesorero, así
--    que el nombre del mes se arma con una lista propia.

create or replace function fn_mes_es(p_fecha date) returns text
language sql immutable as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                'septiembre','octubre','noviembre','diciembre'])
           [extract(month from p_fecha)::int]
         || ' de ' || extract(year from p_fecha)::text
$$;

comment on function fn_mes_es is
  'Nombre del mes en español, sin depender de la configuración regional del servidor.';

create or replace function fn_bloquear_mes_cerrado() returns trigger
language plpgsql as $$
declare v_periodo date;
begin
  /*
   * Sellar un movimiento con su corte, o quitarle el sello al reabrir, no es
   * modificar el mes: es justo lo que hacen fn_cerrar_corte y fn_reabrir_corte.
   */
  if tg_op = 'UPDATE'
     and new.corte_id is distinct from old.corte_id
     and (new.fecha, new.periodo, new.tipo, new.concepto_id, new.monto_centavos,
          new.descripcion, new.hermano_id, new.egreso_id, new.archivo_id)
         is not distinct from
         (old.fecha, old.periodo, old.tipo, old.concepto_id, old.monto_centavos,
          old.descripcion, old.hermano_id, old.egreso_id, old.archivo_id)
  then
    return new;
  end if;

  foreach v_periodo in array array_remove(array[
      case when tg_op <> 'DELETE' then new.periodo end,
      case when tg_op <> 'INSERT' then old.periodo end], null)
  loop
    if exists (
      select 1 from corte_mensual
       where periodo = v_periodo and estado = 'cerrado'
    ) then
      raise exception
        'El mes de % ya tiene corte cerrado. Registra un movimiento de ajuste en el mes '
        'abierto, o pide al Venerable Maestro que reabra el corte',
        fn_mes_es(v_periodo);
    end if;
  end loop;

  return coalesce(new, old);
end $$;

-- Mismos mensajes, ahora en español, en el cierre y la reapertura.
create or replace function fn_cerrar_corte(
  p_periodo       date,
  p_observaciones text default null
) returns bigint
language plpgsql as $$
declare
  v_anio     int := extract(year from p_periodo)::int;
  v_ej       ejercicio;
  v_previo   corte_mensual;
  v_inicial  int;
  v_ingresos int;
  v_egresos  int;
  v_id       bigint;
  v_pendiente record;
begin
  if extract(day from p_periodo) <> 1 then
    raise exception 'El periodo debe ser el día primero del mes';
  end if;

  select * into v_ej from ejercicio where anio = v_anio;
  if v_ej.anio is null then
    raise exception 'No existe el ejercicio %', v_anio;
  end if;
  if v_ej.estado = 'cerrado' then
    raise exception 'El ejercicio % está cerrado', v_anio;
  end if;

  if exists (select 1 from corte_mensual where periodo = p_periodo and estado = 'cerrado') then
    raise exception 'El mes de % ya está cerrado', fn_mes_es(p_periodo);
  end if;

  if p_periodo > v_ej.fecha_inicio then
    select * into v_previo
      from corte_mensual
     where periodo = (p_periodo - interval '1 month')::date;
    if v_previo.id is null or v_previo.estado <> 'cerrado' then
      raise exception 'Antes hay que cerrar el mes de %',
        fn_mes_es((p_periodo - interval '1 month')::date);
    end if;
    v_inicial := v_previo.saldo_final_centavos;
  else
    v_inicial := v_ej.saldo_apertura_centavos;
  end if;

  select e.folio, e.fecha_entrega into v_pendiente
    from egreso e
   where e.estado = 'por_comprobar'
     and date_trunc('month', e.fecha_entrega)::date < p_periodo
   order by e.fecha_entrega
   limit 1;

  if v_pendiente.folio is not null then
    raise exception
      'El egreso % sigue por comprobar desde el %. Sube los recibos o registra la '
      'devolución antes de cerrar este mes',
      v_pendiente.folio, to_char(v_pendiente.fecha_entrega, 'DD/MM/YYYY');
  end if;

  select coalesce(sum(monto_centavos) filter (where tipo = 'ingreso'), 0)::int,
         coalesce(sum(monto_centavos) filter (where tipo = 'egreso'), 0)::int
    into v_ingresos, v_egresos
    from movimiento
   where periodo = p_periodo;

  insert into corte_mensual (
    periodo, ejercicio_anio, estado, saldo_inicial_centavos, total_ingresos_centavos,
    total_egresos_centavos, saldo_final_centavos, capitas_esperadas_centavos,
    capitas_cobradas_centavos, pendiente_comprobar_centavos, observaciones,
    cerrado_por, cerrado_en, creado_por
  )
  values (
    p_periodo, v_anio, 'cerrado', v_inicial, v_ingresos, v_egresos,
    v_inicial + v_ingresos - v_egresos,
    coalesce((select sum(monto_esperado_centavos)::int from capita_cargo
               where periodo = p_periodo and estado = 'vigente'), 0),
    coalesce((select sum(ca.monto_aplicado_centavos)::int
                from capita_aplicacion ca
                join capita_cargo cc on cc.id = ca.capita_cargo_id
               where cc.periodo = p_periodo), 0),
    coalesce((select sum(monto_entregado_centavos - monto_comprobado_centavos
                         - monto_devuelto_centavos)::int
                from egreso where estado = 'por_comprobar'), 0),
    p_observaciones, fn_usuario_actual(), now(), fn_usuario_actual()
  )
  on conflict (periodo) do update
     set estado = 'cerrado',
         saldo_inicial_centavos = excluded.saldo_inicial_centavos,
         total_ingresos_centavos = excluded.total_ingresos_centavos,
         total_egresos_centavos = excluded.total_egresos_centavos,
         saldo_final_centavos = excluded.saldo_final_centavos,
         capitas_esperadas_centavos = excluded.capitas_esperadas_centavos,
         capitas_cobradas_centavos = excluded.capitas_cobradas_centavos,
         pendiente_comprobar_centavos = excluded.pendiente_comprobar_centavos,
         observaciones = excluded.observaciones,
         cerrado_por = excluded.cerrado_por,
         cerrado_en = now()
  returning id into v_id;

  update movimiento set corte_id = v_id where periodo = p_periodo and corte_id is null;

  return v_id;
end $$;

create or replace function fn_reabrir_corte(
  p_corte_id bigint,
  p_motivo   text,
  p_usuario  bigint
) returns void
language plpgsql as $$
declare
  v_corte  corte_mensual;
  v_ultimo date;
begin
  select * into v_corte from corte_mensual where id = p_corte_id for update;
  if v_corte.id is null then
    raise exception 'Ese corte no existe';
  end if;
  if v_corte.estado <> 'cerrado' then
    raise exception 'Ese corte ya está abierto';
  end if;

  select max(periodo) into v_ultimo from corte_mensual where estado = 'cerrado';
  if v_corte.periodo <> v_ultimo then
    raise exception 'Solo se puede reabrir el último mes cerrado, que es el de %',
      fn_mes_es(v_ultimo);
  end if;

  update corte_mensual
     set estado = 'abierto',
         reaperturas = reaperturas + 1,
         cerrado_por = null,
         cerrado_en = null
   where id = p_corte_id;

  update movimiento set corte_id = null where corte_id = p_corte_id;

  insert into corte_reapertura (corte_id, motivo, reabierto_por)
  values (p_corte_id, p_motivo, p_usuario);
end $$;
