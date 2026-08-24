-- 011_ejercicios_tarifas_saldo.sql
--
-- Tres piezas que salieron del uso real:
--
-- 1. Tarifas de grado versionadas por fecha de vigencia. La tabla anterior era
--    por año y nunca tuvo pantalla; esta guarda historia y solo aplica hacia
--    adelante: cambiar una tarifa no toca nada de lo ya capturado.
-- 2. Apertura y cierre de ejercicios: abrir el año siguiente arrastrando el
--    saldo de diciembre, y cerrar el ejercicio cuando sus doce cortes cierran.
-- 3. Devolución de saldo a favor: concepto propio para que el sobrante de un
--    hermano pueda regresársele como egreso con sus dos firmas, y la vista de
--    estado de cuenta lo descuenta.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tarifas de grado, versionadas
-- ─────────────────────────────────────────────────────────────────────────────

-- La tabla anterior estaba vacía y sin uso: se reemplaza sin pena.
drop table tarifa_grado;

create table tarifa_grado (
  id             bigint generated always as identity primary key,
  tipo_evento    text not null
                 check (tipo_evento in ('iniciacion', 'aumento_salario', 'exaltacion',
                                        'afiliacion')),
  monto_centavos int not null check (monto_centavos > 0),
  vigente_desde  date not null,
  notas          text,
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id)
);

create index tarifa_grado_vigencia_idx on tarifa_grado (tipo_evento, vigente_desde desc);

comment on table tarifa_grado is
  'Lo que el candidato paga a la logia por cada evento de grado. Cada cambio es '
  'una fila nueva con su fecha de vigencia: nunca se edita ni se borra una '
  'tarifa, y el cambio solo aplica de esa fecha en adelante. Los ingresos ya '
  'capturados congelaron su monto y no se mueven.';

-- Las tarifas no se reescriben: la historia es parte del dato.
create or replace function fn_tarifa_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception
    'Las tarifas no se editan ni se borran. Captura una tarifa nueva con su fecha '
    'de vigencia: la anterior queda como historia';
end $$;

create trigger tr_tarifa_inmutable before update or delete on tarifa_grado
  for each row execute function fn_tarifa_inmutable();

-- Tarifa vigente por tipo de evento a una fecha dada.
create or replace view v_tarifa_vigente as
select distinct on (tipo_evento)
       tipo_evento, monto_centavos, vigente_desde
  from tarifa_grado
 where vigente_desde <= current_date
 order by tipo_evento, vigente_desde desc, id desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- Apertura y cierre de ejercicios
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_abrir_ejercicio(
  p_anio                      int,
  p_capita_mensual_centavos   int default null,
  p_capita_promocion_centavos int default null
) returns void
language plpgsql as $$
declare
  v_anterior ejercicio;
  v_diciembre corte_mensual;
  v_apertura int := 0;
begin
  if exists (select 1 from ejercicio where anio = p_anio) then
    raise exception 'El ejercicio % ya existe', p_anio;
  end if;

  select * into v_anterior from ejercicio where anio = p_anio - 1;
  if v_anterior.anio is null then
    raise exception
      'Solo se puede abrir el año siguiente al último ejercicio: falta el %', p_anio - 1;
  end if;

  -- Si diciembre del año anterior ya cerró, su saldo final es la apertura.
  -- Si no, la apertura queda en cero y se completa sola al cerrar diciembre.
  select * into v_diciembre
    from corte_mensual
   where periodo = make_date(p_anio - 1, 12, 1) and estado = 'cerrado';
  if v_diciembre.id is not null then
    v_apertura := v_diciembre.saldo_final_centavos;
  end if;

  insert into ejercicio
    (anio, fecha_inicio, fecha_fin, capita_mensual_centavos, capita_promocion_centavos,
     saldo_apertura_centavos, notas, creado_por, actualizado_por)
  values (
    p_anio, make_date(p_anio, 1, 1), make_date(p_anio, 12, 31),
    coalesce(p_capita_mensual_centavos, v_anterior.capita_mensual_centavos),
    coalesce(p_capita_promocion_centavos, v_anterior.capita_promocion_centavos),
    v_apertura,
    case when v_diciembre.id is null
         then 'Abierto antes de cerrar diciembre de ' || (p_anio - 1)::text ||
              '. La apertura se completa sola al cerrar ese corte.'
         else 'Apertura arrastrada del corte de diciembre de ' || (p_anio - 1)::text || '.'
    end,
    fn_usuario_actual(), fn_usuario_actual()
  );
end $$;

comment on function fn_abrir_ejercicio is
  'Crea el ejercicio siguiente. Las tarifas de cápita se heredan del año anterior '
  'salvo que se indiquen otras, y el saldo de apertura se arrastra del corte de '
  'diciembre si ya está cerrado.';

create or replace function fn_cerrar_ejercicio(p_anio int) returns void
language plpgsql as $$
declare
  v_ej ejercicio;
  v_cerrados int;
begin
  select * into v_ej from ejercicio where anio = p_anio for update;
  if v_ej.anio is null then
    raise exception 'No existe el ejercicio %', p_anio;
  end if;
  if v_ej.estado = 'cerrado' then
    raise exception 'El ejercicio % ya está cerrado', p_anio;
  end if;

  select count(*) into v_cerrados
    from corte_mensual
   where ejercicio_anio = p_anio and estado = 'cerrado';
  if v_cerrados < 12 then
    raise exception
      'El ejercicio % tiene % corte(s) cerrados de 12. Cierra todos los meses primero',
      p_anio, v_cerrados;
  end if;

  update ejercicio
     set estado = 'cerrado', cerrado_por = fn_usuario_actual(), cerrado_en = now()
   where anio = p_anio;
end $$;

-- Al cerrar diciembre, la apertura del año siguiente se completa sola, siempre
-- que ese ejercicio exista y todavía no tenga cortes cerrados propios.
create or replace function fn_arrastrar_apertura() returns trigger
language plpgsql as $$
begin
  if new.estado = 'cerrado'
     and extract(month from new.periodo)::int = 12
     and exists (select 1 from ejercicio where anio = new.ejercicio_anio + 1)
     and not exists (
       select 1 from corte_mensual
        where ejercicio_anio = new.ejercicio_anio + 1 and estado = 'cerrado'
     )
  then
    update ejercicio
       set saldo_apertura_centavos = new.saldo_final_centavos,
           notas = 'Apertura arrastrada del corte de diciembre de '
                   || new.ejercicio_anio::text || '.'
     where anio = new.ejercicio_anio + 1;
  end if;
  return null;
end $$;

create trigger tr_arrastrar_apertura
  after insert or update of estado on corte_mensual
  for each row execute function fn_arrastrar_apertura();

-- ─────────────────────────────────────────────────────────────────────────────
-- Devolución de saldo a favor
-- ─────────────────────────────────────────────────────────────────────────────

insert into concepto
  (clave, nombre, naturaleza, tipo_especial, requiere_hermano, requiere_comprobante,
   por_comprobar_por_defecto, seleccionable, orden, notas)
values
  ('devolucion_saldo_favor', 'Devolución de saldo a favor de cápita', 'egreso', 'otro',
   true, true, false, false, 96,
   'Lo genera el botón de devolver saldo a favor. Pasa por las dos firmas como '
   'cualquier egreso.');

-- El estado de cuenta descuenta las devoluciones ya pagadas del saldo a favor.
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
),
devoluciones as (
  select m.hermano_id, m.ejercicio_anio,
         sum(m.monto_centavos)::int as devuelto
    from movimiento m
    join concepto c on c.id = m.concepto_id
   where m.tipo = 'egreso' and c.clave = 'devolucion_saldo_favor'
     and m.hermano_id is not null
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
       greatest(coalesce(pg.sin_aplicar, 0) - coalesce(dv.devuelto, 0), 0)
         as saldo_a_favor_centavos,
       cg.meses_vencidos,
       cg.meses,
       (cg.meses_vencidos = 0) as al_corriente
  from hermano h
  join cargos cg on cg.hermano_id = h.id
  left join pagos pg on pg.hermano_id = h.id and pg.ejercicio_anio = cg.ejercicio_anio
  left join devoluciones dv on dv.hermano_id = h.id and dv.ejercicio_anio = cg.ejercicio_anio
  left join capita_plan cp
    on cp.hermano_id = h.id and cp.ejercicio_anio = cg.ejercicio_anio and cp.vigente;
