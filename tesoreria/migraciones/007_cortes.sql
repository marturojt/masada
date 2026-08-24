-- 007_cortes.sql
-- Cortes mensuales: saldo inicial, ingresos, egresos, saldo final, y el bloqueo
-- del mes una vez cerrado.
--
-- Cerrar un corte no es un adorno: es la declaración de que ese mes ya se leyó en
-- tenida. Por eso, después de cerrar, el mes no admite movimientos nuevos y las
-- correcciones se hacen con un movimiento de ajuste en el mes abierto.

create table corte_mensual (
  id                           bigint generated always as identity primary key,
  periodo                      date not null unique,
  ejercicio_anio               int not null references ejercicio(anio),
  estado                       text not null default 'cerrado'
                               check (estado in ('abierto', 'cerrado')),

  saldo_inicial_centavos       int not null,
  total_ingresos_centavos      int not null default 0 check (total_ingresos_centavos >= 0),
  total_egresos_centavos       int not null default 0 check (total_egresos_centavos >= 0),
  saldo_final_centavos         int not null,

  -- Fotografía al cierre, para poder auditar sin recalcular.
  capitas_esperadas_centavos   int not null default 0,
  capitas_cobradas_centavos    int not null default 0,
  pendiente_comprobar_centavos int not null default 0,

  observaciones                text,
  cerrado_por                  bigint references usuario(id),
  cerrado_en                   timestamptz,
  reaperturas                  int not null default 0,
  creado_en                    timestamptz not null default now(),
  creado_por                   bigint references usuario(id),

  constraint corte_dia_uno check (extract(day from periodo) = 1),
  constraint corte_anio_coincide check (extract(year from periodo)::int = ejercicio_anio),
  constraint corte_saldo_cuadra check (
    saldo_final_centavos
      = saldo_inicial_centavos + total_ingresos_centavos - total_egresos_centavos
  ),
  constraint corte_cerrado_con_firma check (
    estado <> 'cerrado' or (cerrado_por is not null and cerrado_en is not null)
  )
);

create index corte_ejercicio_idx on corte_mensual (ejercicio_anio, periodo);

alter table movimiento
  add constraint movimiento_corte_fk foreign key (corte_id) references corte_mensual(id);

-- La reapertura es excepcional y deja huella permanente.
create table corte_reapertura (
  id            bigint generated always as identity primary key,
  corte_id      bigint not null references corte_mensual(id),
  motivo        text not null,
  reabierto_por bigint not null references usuario(id),
  reabierto_en  timestamptz not null default now(),
  constraint reapertura_motivo_no_vacio check (btrim(motivo) <> '')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Bloqueo del mes cerrado
-- ─────────────────────────────────────────────────────────────────────────────

-- Este trigger es el que hace real el cierre. Sin él, "cerrado" sería una
-- etiqueta que solo respeta la interfaz.
create or replace function fn_bloquear_mes_cerrado() returns trigger
language plpgsql as $$
declare v_periodo date;
begin
  foreach v_periodo in array array_remove(array[
      case when tg_op <> 'DELETE' then new.periodo end,
      case when tg_op <> 'INSERT' then old.periodo end], null)
  loop
    if exists (
      select 1 from corte_mensual
       where periodo = v_periodo and estado = 'cerrado'
    ) then
      raise exception
        'El mes % ya tiene corte cerrado. Registra un movimiento de ajuste en el mes '
        'abierto, o pide al Venerable Maestro que reabra el corte',
        to_char(v_periodo, 'TMMonth YYYY');
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger tr_movimiento_bloquear_mes
  before insert or update on movimiento
  for each row execute function fn_bloquear_mes_cerrado();

-- ─────────────────────────────────────────────────────────────────────────────
-- Cierre
-- ─────────────────────────────────────────────────────────────────────────────

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
    raise exception 'El mes % ya está cerrado', to_char(p_periodo, 'TMMonth YYYY');
  end if;

  -- Los cortes se cierran en orden: sin el mes anterior cerrado, el saldo inicial
  -- de este no significa nada.
  if p_periodo > v_ej.fecha_inicio then
    select * into v_previo
      from corte_mensual
     where periodo = (p_periodo - interval '1 month')::date;
    if v_previo.id is null or v_previo.estado <> 'cerrado' then
      raise exception 'Antes hay que cerrar %',
        to_char((p_periodo - interval '1 month')::date, 'TMMonth YYYY');
    end if;
    v_inicial := v_previo.saldo_final_centavos;
  else
    v_inicial := v_ej.saldo_apertura_centavos;
  end if;

  -- No se cierra un mes arrastrando dinero entregado y sin comprobar de meses
  -- anteriores: eso es justo lo que el corte debe estorbar.
  select e.folio, e.fecha_entrega into v_pendiente
    from egreso e
   where e.estado = 'por_comprobar'
     and date_trunc('month', e.fecha_entrega)::date < p_periodo
   order by e.fecha_entrega
   limit 1;

  if v_pendiente.folio is not null then
    raise exception
      'El egreso % sigue por comprobar desde %. Sube los recibos o registra la '
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

  -- Los movimientos del mes quedan sellados con su corte.
  update movimiento set corte_id = v_id where periodo = p_periodo and corte_id is null;

  return v_id;
end $$;

comment on function fn_cerrar_corte is
  'Cierra un mes. Exige que el anterior esté cerrado y que no haya egresos por '
  'comprobar arrastrados de meses previos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Reapertura
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_reabrir_corte(
  p_corte_id bigint,
  p_motivo   text,
  p_usuario  bigint
) returns void
language plpgsql as $$
declare
  v_corte corte_mensual;
  v_ultimo date;
begin
  select * into v_corte from corte_mensual where id = p_corte_id for update;
  if v_corte.id is null then
    raise exception 'Ese corte no existe';
  end if;
  if v_corte.estado <> 'cerrado' then
    raise exception 'Ese corte ya está abierto';
  end if;

  -- Solo el último mes cerrado: reabrir uno de en medio dejaría los saldos
  -- encadenados sin sentido.
  select max(periodo) into v_ultimo from corte_mensual where estado = 'cerrado';
  if v_corte.periodo <> v_ultimo then
    raise exception
      'Solo se puede reabrir el último mes cerrado, que es %',
      to_char(v_ultimo, 'TMMonth YYYY');
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

comment on function fn_reabrir_corte is
  'Reapertura excepcional del último mes cerrado. Deja huella permanente en '
  'corte_reapertura y suma uno al contador del corte.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista de saldos encadenados
-- ─────────────────────────────────────────────────────────────────────────────

-- Calcula el corte de cada mes aunque no se haya cerrado, para poder ver el
-- borrador y compararlo contra lo que quedó guardado al cerrar.
create or replace view v_corte_calculado as
with meses as (
  select generate_series(e.fecha_inicio, e.fecha_fin, interval '1 month')::date as periodo,
         e.anio,
         e.saldo_apertura_centavos
    from ejercicio e
),
flujo as (
  select mm.anio,
         mm.periodo,
         mm.saldo_apertura_centavos,
         coalesce(sum(m.monto_centavos) filter (where m.tipo = 'ingreso'), 0)::int as ingresos,
         coalesce(sum(m.monto_centavos) filter (where m.tipo = 'egreso'), 0)::int as egresos
    from meses mm
    left join movimiento m on m.periodo = mm.periodo
   group by mm.anio, mm.periodo, mm.saldo_apertura_centavos
)
select f.anio,
       f.periodo,
       f.ingresos as total_ingresos_centavos,
       f.egresos as total_egresos_centavos,
       (f.saldo_apertura_centavos
         + coalesce(sum(f.ingresos - f.egresos) over w, 0)
         - (f.ingresos - f.egresos))::int as saldo_inicial_centavos,
       (f.saldo_apertura_centavos + coalesce(sum(f.ingresos - f.egresos) over w, 0))::int
         as saldo_final_centavos,
       c.id as corte_id,
       c.estado as estado_corte,
       c.cerrado_en::text,
       u.nombre as cerrado_nombre,
       c.reaperturas
  from flujo f
  left join corte_mensual c on c.periodo = f.periodo
  left join usuario u on u.id = c.cerrado_por
window w as (partition by f.anio order by f.periodo rows between unbounded preceding and current row)
order by f.periodo;
