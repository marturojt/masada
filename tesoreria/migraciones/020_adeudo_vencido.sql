-- 020_adeudo_vencido.sql
--
-- El adeudo que se muestra debe ser lo VENCIDO, no el año completo: quien va
-- al día en agosto no "debe" septiembre a diciembre, esos meses aún no llegan.
-- La vista separa el saldo en vencido (meses anteriores al mes en curso, que
-- es la cartera real) y por vencer (el mes en curso y los que faltan del año).
-- La columna adeudo_centavos conserva su significado de saldo total del año,
-- para no mover lo que ya la consume.

-- Las columnas nuevas van a media vista, así que se recrea completa.
drop view v_estado_cuenta_capita;

create view v_estado_cuenta_capita as
with cargos as (
  select hermano_id, ejercicio_anio,
         sum(monto_esperado_centavos)::int as esperado,
         sum(pagado_centavos)::int         as pagado,
         sum(condonado_centavos)::int      as condonado,
         sum(saldo_centavos)::int          as saldo,
         sum(saldo_centavos) filter (where estado_pago like 'vencido%')::int
           as vencido,
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
       coalesce(cg.vencido, 0) as vencido_centavos,
       cg.saldo - coalesce(cg.vencido, 0) as por_vencer_centavos,
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
