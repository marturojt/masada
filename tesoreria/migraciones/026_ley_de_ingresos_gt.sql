-- 026_ley_de_ingresos_gt.sql
--
-- Las tarifas de la Gran Tesorería salen de su Ley de Ingresos, que trae mucho
-- más que cápita, templo y locker: movimientos de grado, regularización,
-- talleres, lockers, auditorio y reconocimientos. Cada tarifa pasa a tener su
-- clave, su grupo, su nombre, su unidad y su fundamento (el decreto que la
-- fija). La vigente es la última de cada clave, ya no la última de cada
-- concepto.
--
-- Se carga la Ley de Ingresos 2026-2027 (Decreto 201/2026), vigente desde el
-- 21 de septiembre de 2026, solo con la columna de "Logias en edificio sede",
-- que es la que le aplica a Masada. Los montos se mantienen hasta que la Gran
-- Asamblea los ajuste o apruebe la ley siguiente, por eso no llevan fecha
-- final: los cierra la tarifa nueva de la misma clave.
--
-- Además, con la membresía como respaldo de consulta, se retiran las dos
-- vistas que la ponían a trabajar: el cálculo esperado (membresía por
-- tarifas) y la conciliación de padrones, que es asunto de la secretaría. Los
-- registros externos de cada hermano se quedan como consulta.

alter table gt_tarifa add column grupo text;
alter table gt_tarifa add column clave text;
alter table gt_tarifa add column nombre text;
alter table gt_tarifa add column unidad text;
alter table gt_tarifa add column fundamento text;

-- Las tarifas no se editan, salvo esta vez: completar las columnas nuevas de
-- las filas que ya existían no cambia ningún monto ni fecha.
alter table gt_tarifa disable trigger tr_gt_tarifa_inmutable;

update gt_tarifa
   set grupo = case concepto
                 when 'capita' then 'capitas'
                 when 'templo' then 'talleres'
                 when 'locker' then 'lockers'
                 else 'otro'
               end,
       clave = case concepto
                 when 'capita' then 'capita'
                 when 'templo' then 'templo'
                 when 'locker' then 'locker_renta'
                 else 'otro_' || id
               end,
       nombre = coalesce(descripcion, case concepto
                 when 'capita' then 'Cápita individual por hermano'
                 when 'templo' then 'Renta de templo'
                 when 'locker' then 'Renta de locker'
                 else 'Otro'
               end),
       unidad = case concepto
                  when 'capita' then 'por hermano al mes'
                  when 'otro' then null
                  else 'por mes'
                end;

alter table gt_tarifa enable trigger tr_gt_tarifa_inmutable;

alter table gt_tarifa alter column grupo set not null;
alter table gt_tarifa alter column clave set not null;
alter table gt_tarifa alter column nombre set not null;

alter table gt_tarifa add constraint gt_tarifa_grupo_valido check (
  grupo in ('capitas', 'movimientos', 'regularizacion', 'talleres', 'lockers',
            'auditorio', 'reconocimientos', 'otro')
);
alter table gt_tarifa add constraint gt_tarifa_clave_formato check (clave ~ '^[a-z0-9_]+$');
alter table gt_tarifa add constraint gt_tarifa_nombre_no_vacio check (btrim(nombre) <> '');

create index gt_tarifa_clave_idx on gt_tarifa (clave, vigencia_desde desc);

comment on column gt_tarifa.clave is
  'Identifica la tarifa a lo largo de las leyes: una tarifa nueva con la misma '
  'clave sustituye a la anterior desde su fecha.';
comment on column gt_tarifa.fundamento is
  'De dónde sale el monto, por ejemplo el decreto de la Ley de Ingresos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vistas: fuera lo que dependía de la membresía y de la conciliación
-- ─────────────────────────────────────────────────────────────────────────────

drop view if exists v_gt_calculo_esperado;
drop view if exists v_conciliacion_padrones;
drop view v_gt_tarifa_vigente;

create view v_gt_tarifa_vigente as
select distinct on (clave)
       clave, grupo, nombre, unidad, fundamento, concepto, descripcion,
       monto_centavos, vigencia_desde, vigencia_hasta
  from gt_tarifa
 where vigencia_desde <= current_date
   and (vigencia_hasta is null or vigencia_hasta >= current_date)
 order by clave, vigencia_desde desc, id desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ley de Ingresos 2026-2027, logias en edificio sede
-- ─────────────────────────────────────────────────────────────────────────────

insert into gt_tarifa
  (concepto, grupo, clave, nombre, unidad, monto_centavos, vigencia_desde, fundamento)
select concepto, grupo, clave, nombre, unidad, monto, date '2026-09-21',
       'Ley de Ingresos 2026-2027 de la M∴R∴G∴L∴V∴M∴, Decreto 201/2026'
  from (values
    ('capita', 'capitas', 'capita', 'Cápita individual por hermano', 'por hermano al mes', 25000),

    ('otro', 'movimientos', 'iniciacion_opalina', 'Iniciación, diploma en opalina', 'por hermano', 225000),
    ('otro', 'movimientos', 'iniciacion_piel', 'Iniciación, diploma en piel', 'por hermano', 250000),
    ('otro', 'movimientos', 'aumento_opalina', 'Aumento de salario, diploma en opalina', 'por hermano', 170000),
    ('otro', 'movimientos', 'aumento_piel', 'Aumento de salario, diploma en piel', 'por hermano', 195000),
    ('otro', 'movimientos', 'exaltacion_opalina', 'Exaltación, diploma en opalina', 'por hermano', 350000),
    ('otro', 'movimientos', 'exaltacion_piel', 'Exaltación, diploma en piel', 'por hermano', 375000),
    ('otro', 'movimientos', 'adopcion_luvetones', 'Adopción de luvetones', 'por luvetón', 150000),
    ('otro', 'movimientos', 'ingreso_ajef', 'Ingreso a la AJEF', 'por persona', 150000),
    ('otro', 'movimientos', 'intersticio', 'Intersticio', 'por hermano', 100000),

    ('otro', 'regularizacion', 'regularizacion', 'Regularización o afiliación por hermano', 'por hermano', 150000),

    ('templo', 'talleres', 'templo_pequeno', 'Renta de templo pequeño', 'por mes', 30000),
    ('templo', 'talleres', 'templo_mediano', 'Renta de templo mediano', 'por mes', 35000),
    ('templo', 'talleres', 'templo_grande', 'Renta de templo grande', 'por mes', 45000),
    ('otro', 'talleres', 'camara_enmedio', 'Uso de la Cámara de Enmedio', null, 35000),

    ('locker', 'lockers', 'locker_renta', 'Renta de locker', 'por mes', 10000),
    ('otro', 'lockers', 'locker_asignacion', 'Asignación de locker', 'una vez', 80000),

    ('otro', 'auditorio', 'auditorio_logias', 'Renta del auditorio para logias', 'por dos horas', 200000),

    ('otro', 'reconocimientos', 'carta_patente_opalina', 'Carta patente impresa en opalina', null, 1000000),
    ('otro', 'reconocimientos', 'carta_patente_piel', 'Carta patente impresa en piel', null, 1500000),
    ('otro', 'reconocimientos', 'carta_dispensa', 'Carta dispensa', null, 550000),
    ('otro', 'reconocimientos', 'diploma_opalina', 'Diploma en opalina', null, 30000),
    ('otro', 'reconocimientos', 'diploma_piel', 'Diploma en piel', null, 50000),
    ('otro', 'reconocimientos', 'pasaporte', 'Pasaporte', null, 60000),
    ('otro', 'reconocimientos', 'refrendo_pasaporte', 'Refrendo de pasaporte (2 años)', null, 32000),
    ('otro', 'reconocimientos', 'carta_regularidad', 'Carta de regularidad', null, 7000),
    ('otro', 'reconocimientos', 'credencial', 'Credencial', null, 10000)
  ) as ley (concepto, grupo, clave, nombre, unidad, monto);
