-- 004_capitas.sql
-- Cápitas: el plan pactado con cada hermano, los cargos exigibles mes por mes,
-- la aplicación de pagos y las condonaciones que autoriza el Venerable Maestro.
--
-- Dos niveles a propósito:
--   capita_plan   la modalidad acordada, con su autorización y su total congelado
--   capita_cargo  lo exigible, una fila por mes, contra lo que se aplican pagos
--
-- Sin el segundo nivel no se podría responder la pregunta que de verdad importa
-- en una logia: quién está al corriente y de qué mes debe.

-- ─────────────────────────────────────────────────────────────────────────────
-- Plan
-- ─────────────────────────────────────────────────────────────────────────────

create table capita_plan (
  id                      bigint generated always as identity primary key,
  hermano_id              bigint not null references hermano(id) on delete cascade,
  ejercicio_anio          int not null references ejercicio(anio) on delete cascade,
  modalidad               text not null
                          check (modalidad in ('mensual', 'promocion', 'prorrateo')),
  mes_desde               int not null check (mes_desde between 1 and 12),
  mes_hasta               int not null check (mes_hasta between 1 and 12),
  monto_mensual_centavos  int not null check (monto_mensual_centavos >= 0),
  monto_total_centavos    int not null check (monto_total_centavos >= 0),

  -- La promoción es discrecional del VM: sin constancia de quién la autorizó y
  -- cuándo, no existe. Lo garantiza un constraint, no una convención.
  autorizado_por          bigint references usuario(id),
  autorizado_en           timestamptz,
  motivo                  text,

  vigente                 boolean not null default true,
  reemplaza_a             bigint references capita_plan(id),

  creado_en               timestamptz not null default now(),
  creado_por              bigint references usuario(id),
  actualizado_en          timestamptz not null default now(),
  actualizado_por         bigint references usuario(id),

  check (mes_hasta >= mes_desde),
  constraint promocion_requiere_autorizacion check (
    modalidad <> 'promocion'
    or (autorizado_por is not null and autorizado_en is not null)
  )
);

comment on column capita_plan.monto_total_centavos is
  'Total esperado del ejercicio según la modalidad, congelado al pactar el plan. '
  'Se congela a propósito: si la tarifa cambia en junio, los planes ya pactados '
  'no se mueven.';

-- Un solo plan vigente por hermano y ejercicio.
create unique index capita_plan_vigente_unico
  on capita_plan (hermano_id, ejercicio_anio) where vigente;
create index capita_plan_ejercicio_idx on capita_plan (ejercicio_anio);

create trigger tr_capita_plan_toca before update on capita_plan
  for each row execute function fn_toca_timestamp();

-- ─────────────────────────────────────────────────────────────────────────────
-- Cargos exigibles
-- ─────────────────────────────────────────────────────────────────────────────

create table capita_cargo (
  id                      bigint generated always as identity primary key,
  plan_id                 bigint not null references capita_plan(id) on delete cascade,
  hermano_id              bigint not null references hermano(id) on delete cascade,
  ejercicio_anio          int not null references ejercicio(anio) on delete cascade,
  -- Mes de exigibilidad, día 1.
  periodo                 date not null,
  monto_esperado_centavos int not null check (monto_esperado_centavos > 0),
  clase                   text not null default 'mensual'
                          check (clase in ('mensual', 'promocion')),
  estado                  text not null default 'vigente'
                          check (estado in ('vigente', 'cancelado')),
  motivo_cancelacion      text,
  cancelado_por           bigint references usuario(id),
  cancelado_en            timestamptz,
  creado_en               timestamptz not null default now(),
  creado_por              bigint references usuario(id),

  constraint capita_cargo_dia_uno check (extract(day from periodo) = 1),
  constraint capita_cargo_anio_coincide check (
    extract(year from periodo)::int = ejercicio_anio
  ),
  constraint capita_cargo_cancelacion_coherente check (
    (estado = 'cancelado') = (motivo_cancelacion is not null)
  ),
  -- Nadie puede tener dos cargos vigentes del mismo mes.
  constraint capita_cargo_unico_por_mes
    exclude (hermano_id with =, periodo with =) where (estado = 'vigente')
);

comment on column capita_cargo.periodo is
  'En modalidad mensual y prorrateo hay una fila por mes. En promoción hay UNA '
  'sola fila, en el mes en que el VM la autorizó: los 5,000 son pago único y '
  'repartirlos entre doce daría 416.66 repetido.';

create index capita_cargo_hermano_idx on capita_cargo (hermano_id, periodo);
create index capita_cargo_periodo_idx on capita_cargo (ejercicio_anio, periodo);
create index capita_cargo_plan_idx on capita_cargo (plan_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Aplicación de pagos
-- ─────────────────────────────────────────────────────────────────────────────

-- Muchos a muchos: un pago puede cubrir varios meses y un mes puede cubrirse con
-- varios pagos parciales.
create table capita_aplicacion (
  id                      bigint generated always as identity primary key,
  movimiento_id           bigint not null references movimiento(id),
  capita_cargo_id         bigint not null references capita_cargo(id),
  monto_aplicado_centavos int not null check (monto_aplicado_centavos > 0),
  creado_en               timestamptz not null default now(),
  creado_por              bigint references usuario(id),
  unique (movimiento_id, capita_cargo_id)
);

create index capita_aplicacion_cargo_idx on capita_aplicacion (capita_cargo_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Condonaciones
-- ─────────────────────────────────────────────────────────────────────────────

-- Una exención cubre un cargo sin que entre dinero. Se modela como una
-- aplicación que no es pago, y así el adeudo por mes sigue siendo una resta
-- simple, sin tocar el libro de caja: exentar no es un ingreso.
create table capita_condonacion (
  id              bigint generated always as identity primary key,
  capita_cargo_id bigint not null references capita_cargo(id),
  monto_centavos  int not null check (monto_centavos > 0),
  motivo          text not null,
  autorizado_por  bigint not null references usuario(id),
  autorizado_en   timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  constraint condonacion_motivo_no_vacio check (btrim(motivo) <> ''),
  unique (capita_cargo_id)
);

comment on table capita_condonacion is
  'Exención total o parcial de un mes, a discreción del Venerable Maestro. '
  'Queda siempre quién la autorizó, cuándo y por qué.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Invariantes de aplicación
-- ─────────────────────────────────────────────────────────────────────────────

-- Son invariantes agregadas, así que no caben en un CHECK. El trigger es
-- diferido para que un pago que cubre varios meses pueda insertarse en cualquier
-- orden dentro de la transacción.
create or replace function fn_validar_aplicacion() returns trigger
language plpgsql as $$
declare
  v_mov     bigint := coalesce(new.movimiento_id, old.movimiento_id);
  v_cargo   bigint := coalesce(new.capita_cargo_id, old.capita_cargo_id);
  v_aplicado int;
  v_tope     int;
begin
  if tg_op <> 'DELETE' then
    perform 1
      from movimiento m
      join concepto c on c.id = m.concepto_id
      join capita_cargo cc on cc.id = new.capita_cargo_id
     where m.id = new.movimiento_id
       and m.tipo = 'ingreso'
       and c.tipo_especial = 'capita'
       and cc.estado = 'vigente'
       and cc.hermano_id = m.hermano_id;
    if not found then
      raise exception
        'Aplicación inválida: el pago debe ser un ingreso de cápita del mismo hermano '
        'y el mes debe estar vigente';
    end if;
  end if;

  -- Lo aplicado no puede pasar del pago.
  select coalesce(sum(monto_aplicado_centavos), 0) into v_aplicado
    from capita_aplicacion where movimiento_id = v_mov;
  select monto_centavos into v_tope from movimiento where id = v_mov;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception 'Se está aplicando más (%) de lo que se pagó (%)', v_aplicado, v_tope;
  end if;

  -- Lo aplicado más lo condonado no puede pasar del cargo del mes.
  select coalesce(sum(monto_aplicado_centavos), 0) into v_aplicado
    from capita_aplicacion where capita_cargo_id = v_cargo;
  select cc.monto_esperado_centavos
           - coalesce((select sum(monto_centavos) from capita_condonacion co
                        where co.capita_cargo_id = cc.id), 0)
    into v_tope
    from capita_cargo cc where cc.id = v_cargo;
  if v_aplicado > coalesce(v_tope, 0) then
    raise exception
      'Se está aplicando más (%) de lo que falta en ese mes (%)', v_aplicado, v_tope;
  end if;

  return null;
end $$;

create constraint trigger tr_validar_aplicacion
  after insert or update or delete on capita_aplicacion
  deferrable initially deferred
  for each row execute function fn_validar_aplicacion();

-- Una condonación tampoco puede rebasar lo que falta del mes.
create or replace function fn_validar_condonacion() returns trigger
language plpgsql as $$
declare v_falta int;
begin
  select cc.monto_esperado_centavos
           - coalesce((select sum(monto_aplicado_centavos) from capita_aplicacion ca
                        where ca.capita_cargo_id = cc.id), 0)
    into v_falta
    from capita_cargo cc where cc.id = new.capita_cargo_id;

  if v_falta is null then
    raise exception 'El mes que se quiere exentar no existe';
  end if;
  if new.monto_centavos > v_falta then
    raise exception
      'La exención (%) pasa de lo que falta en ese mes (%)', new.monto_centavos, v_falta;
  end if;
  return new;
end $$;

create trigger tr_validar_condonacion before insert or update on capita_condonacion
  for each row execute function fn_validar_condonacion();

-- ─────────────────────────────────────────────────────────────────────────────
-- Generador de cargos
-- ─────────────────────────────────────────────────────────────────────────────

-- Único camino para crear los cargos de un hermano. Concentra las tres reglas de
-- cápita, incluido lo que pasa al cambiar de modalidad a media marcha.
create or replace function fn_asignar_capita(
  p_hermano_id       bigint,
  p_anio             int,
  p_modalidad        text,
  p_mes_promocion    int default null,
  p_autorizado_por   bigint default null,
  p_motivo           text default null
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
    v_total := v_ej.capita_promocion_centavos - v_cubierto;
    if v_total <= 0 then
      raise exception
        'La promoción no procede: este hermano ya cubrió % del ejercicio, igual o más que '
        'la promoción de %',
        (v_cubierto::numeric / 100)::text, (v_ej.capita_promocion_centavos::numeric / 100)::text;
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

comment on function fn_asignar_capita is
  'Asigna o cambia la modalidad de cápita de un hermano. Al cambiar a media '
  'marcha conserva los meses ya cubiertos, cancela los que no tienen nada y '
  'descuenta lo cubierto del nuevo total, que es la regla acordada para la '
  'promoción habilitada después de enero.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vistas de consulta
-- ─────────────────────────────────────────────────────────────────────────────

-- Adeudo mes por mes. Responde "quién debe y de qué mes".
create or replace view v_adeudo_capita_mes as
select cc.id as capita_cargo_id,
       cc.hermano_id,
       h.nombre_completo,
       h.estatus as estatus_hermano,
       cc.ejercicio_anio,
       cc.periodo,
       cc.clase,
       cc.monto_esperado_centavos,
       coalesce(ap.pagado, 0) as pagado_centavos,
       coalesce(co.condonado, 0) as condonado_centavos,
       cc.monto_esperado_centavos - coalesce(ap.pagado, 0) - coalesce(co.condonado, 0)
         as saldo_centavos,
       case
         when coalesce(ap.pagado, 0) + coalesce(co.condonado, 0) >= cc.monto_esperado_centavos
           then 'cubierto'
         when cc.periodo < date_trunc('month', current_date)::date
           then case when coalesce(ap.pagado, 0) + coalesce(co.condonado, 0) > 0
                     then 'vencido_parcial' else 'vencido' end
         when coalesce(ap.pagado, 0) + coalesce(co.condonado, 0) > 0 then 'parcial'
         else 'pendiente'
       end as estado_pago
  from capita_cargo cc
  join hermano h on h.id = cc.hermano_id
  left join (
    select capita_cargo_id, sum(monto_aplicado_centavos)::int as pagado
      from capita_aplicacion group by capita_cargo_id
  ) ap on ap.capita_cargo_id = cc.id
  left join (
    select capita_cargo_id, sum(monto_centavos)::int as condonado
      from capita_condonacion group by capita_cargo_id
  ) co on co.capita_cargo_id = cc.id
 where cc.estado = 'vigente';

-- Estado de cuenta por hermano y ejercicio.
create or replace view v_estado_cuenta_capita as
with cargos as (
  select hermano_id, ejercicio_anio,
         sum(monto_esperado_centavos)::int as esperado,
         sum(pagado_centavos)::int         as pagado,
         sum(condonado_centavos)::int      as condonado,
         sum(saldo_centavos)::int          as saldo,
         count(*) filter (where estado_pago like 'vencido%')::int as meses_vencidos,
         count(*)::int as meses
    from v_adeudo_capita_mes
   group by hermano_id, ejercicio_anio
),
pagos as (
  select m.hermano_id, m.ejercicio_anio,
         sum(m.monto_centavos)::int as pagado_caja,
         (sum(m.monto_centavos)
           - coalesce(sum((select coalesce(sum(ca.monto_aplicado_centavos), 0)
                             from capita_aplicacion ca where ca.movimiento_id = m.id)), 0)
         )::int as sin_aplicar
    from movimiento m
    join concepto c on c.id = m.concepto_id
   where m.tipo = 'ingreso' and c.tipo_especial = 'capita' and m.hermano_id is not null
   group by m.hermano_id, m.ejercicio_anio
)
select h.id as hermano_id,
       h.nombre_completo,
       h.grado,
       h.estatus,
       cg.ejercicio_anio,
       cp.modalidad,
       cp.id as plan_id,
       cg.esperado as esperado_centavos,
       cg.pagado   as pagado_centavos,
       cg.condonado as condonado_centavos,
       cg.saldo    as adeudo_centavos,
       coalesce(pg.sin_aplicar, 0) as saldo_a_favor_centavos,
       cg.meses_vencidos,
       cg.meses,
       (cg.meses_vencidos = 0) as al_corriente
  from hermano h
  join cargos cg on cg.hermano_id = h.id
  left join pagos pg on pg.hermano_id = h.id and pg.ejercicio_anio = cg.ejercicio_anio
  left join capita_plan cp
    on cp.hermano_id = h.id and cp.ejercicio_anio = cg.ejercicio_anio and cp.vigente;
