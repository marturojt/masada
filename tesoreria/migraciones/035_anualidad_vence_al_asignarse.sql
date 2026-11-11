-- 035_anualidad_vence_al_asignarse.sql
--
-- La anual preferencial es un solo cargo por el año, y su cargo se crea en el
-- mes en que se asigna. Con la regla general (vence lo de meses anteriores al
-- mes en curso), una anualidad asignada este mes salía "pendiente" y el
-- hermano aparecía al corriente sin haber pagado nada. La anualidad cubre el
-- año que ya está corriendo: si no está pagada, se debe desde que se asigna.
--
-- Solo cambia el estado_pago de los cargos de clase promoción del ejercicio en
-- curso o anteriores. Una anualidad asignada por adelantado para el año
-- siguiente sigue la regla normal hasta que ese año empiece. Los montos no se
-- tocan. Las vistas que leen esta (estado de cuenta, resumen) toman el cambio
-- solas.

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
           or (cc.clase = 'promocion'
               and cc.ejercicio_anio <= extract(year from current_date)::int)
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
