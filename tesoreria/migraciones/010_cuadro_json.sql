-- 010_cuadro_json.sql
-- Proyección del padrón al JSON que publica el sitio.
--
-- Estas vistas SON la lista blanca: solo nombre, grado y cargo cruzan la
-- frontera. Ni correos, ni teléfonos, ni fechas, ni montos. Ese archivo termina
-- en internet, así que la restricción se escribe una sola vez y aquí.
--
-- El contrato lo fija src/content/config.ts del sitio: dignatarios como claves
-- fijas, "oficiales" como arreglo de {cargo, nombre} y arreglos de nombres para
-- maestros, companeros y aprendices.

create or replace view v_cuadro_json as
with dignatarios as (
  select ca.anio,
         jsonb_object_agg(c.clave_json, jsonb_build_object('nombre', h.nombre_completo))
           as datos
    from cuadro_asignacion ca
    join cargo c on c.id = ca.cargo_id and c.es_dignatario
    join hermano h on h.id = ca.hermano_id and h.estatus = 'activo'
   group by ca.anio
),
oficiales as (
  select ca.anio,
         jsonb_agg(
           jsonb_build_object('cargo', c.nombre, 'nombre', h.nombre_completo)
           order by ca.orden, c.orden, h.nombre_completo
         ) as datos
    from cuadro_asignacion ca
    join cargo c on c.id = ca.cargo_id and not c.es_dignatario
    join hermano h on h.id = ca.hermano_id and h.estatus = 'activo'
   group by ca.anio
),
-- "maestros" lleva SOLO a los maestros sin cargo: la página del sitio arma esa
-- columna uniendo dignatarios, oficiales y este arreglo. Meterlos a todos aquí
-- haría que el JSON dejara de reflejar la intención.
columnas as (
  select e.anio,
         h.grado,
         jsonb_agg(to_jsonb(h.nombre_completo) order by h.nombre_completo) as nombres
    from ejercicio e
    join hermano h on h.estatus = 'activo'
   where h.grado <> 'maestro'
      or not exists (
        select 1 from cuadro_asignacion ca
         where ca.anio = e.anio and ca.hermano_id = h.id
      )
   group by e.anio, h.grado
)
select e.anio,
       jsonb_build_object(
         'anio', e.anio,
         'anioVulgar', e.anio::text || ' E∴V∴'
       )
       || coalesce(d.datos, '{}'::jsonb)
       || jsonb_build_object(
            'oficiales', coalesce(o.datos, '[]'::jsonb),
            'maestros', coalesce(
              (select nombres from columnas c where c.anio = e.anio and c.grado = 'maestro'),
              '[]'::jsonb),
            'companeros', coalesce(
              (select nombres from columnas c where c.anio = e.anio and c.grado = 'companero'),
              '[]'::jsonb),
            'aprendices', coalesce(
              (select nombres from columnas c where c.anio = e.anio and c.grado = 'aprendiz'),
              '[]'::jsonb)
          ) as documento
  from ejercicio e
  left join dignatarios d on d.anio = e.anio
  left join oficiales o on o.anio = e.anio;

comment on view v_cuadro_json is
  'Cuadro logial de un ejercicio con la forma exacta que valida el esquema del '
  'sitio. Solo publica nombre, grado y cargo.';

-- Past masters: los Venerables Maestros de ejercicios ya concluidos, más el
-- histórico capturado de los años sin registro. El V∴M∴ vigente nunca aparece.
create or replace view v_pastmasters_json as
with vigente as (
  select max(anio) as anio from ejercicio
),
derivados as (
  select ca.anio, h.nombre_completo as nombre
    from cuadro_asignacion ca
    join cargo c on c.id = ca.cargo_id and c.clave = 'venerable_maestro'
    join hermano h on h.id = ca.hermano_id
   where ca.anio < (select anio from vigente)
),
todos as (
  select anio, nombre from derivados
  union all
  select p.anio, coalesce(h.nombre_completo, p.nombre)
    from past_master_historico p
    left join hermano h on h.id = p.hermano_id
   where p.anio not in (select anio from derivados)
     and p.anio < (select anio from vigente)
)
select jsonb_build_object(
         'items',
         coalesce(
           (select jsonb_agg(jsonb_build_object('anio', anio, 'nombre', nombre)
                             order by anio desc)
              from todos),
           '[]'::jsonb)
       ) as documento;
