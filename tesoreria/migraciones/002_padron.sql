-- 002_padron.sql
-- Ejercicio anual, padrón de hermanos, cargos del cuadro y past masters.

-- ─────────────────────────────────────────────────────────────────────────────
-- Ejercicio
-- ─────────────────────────────────────────────────────────────────────────────

-- Las tarifas viven aquí y no como constantes en el código: el día que la cápita
-- cambie, los ejercicios anteriores conservan la suya y el histórico no se mueve.
create table ejercicio (
  anio                      int primary key check (anio between 2026 and 2100),
  fecha_inicio              date not null,
  fecha_fin                 date not null,
  capita_mensual_centavos   int not null default 50000
                            check (capita_mensual_centavos between 1 and 100000000),
  capita_promocion_centavos int not null default 500000
                            check (capita_promocion_centavos between 1 and 100000000),
  saldo_apertura_centavos   int not null default 0,
  estado                    text not null default 'abierto'
                            check (estado in ('abierto', 'cerrado')),
  cerrado_por               bigint references usuario(id),
  cerrado_en                timestamptz,
  notas                     text,
  creado_en                 timestamptz not null default now(),
  creado_por                bigint references usuario(id),
  actualizado_en            timestamptz not null default now(),
  actualizado_por           bigint references usuario(id),
  check (fecha_fin > fecha_inicio),
  check (extract(year from fecha_inicio)::int = anio),
  check (extract(year from fecha_fin)::int = anio)
);

comment on column ejercicio.saldo_apertura_centavos is
  'Saldo de caja al primer día del ejercicio. Para 2026 lo captura el tesorero, '
  'porque no hay información recuperable de años anteriores. De 2027 en adelante '
  'debe coincidir con el saldo final del corte de diciembre previo.';

create trigger tr_ejercicio_toca before update on ejercicio
  for each row execute function fn_toca_timestamp();

-- El sistema arranca en 2026. El saldo de apertura se ajusta desde Herramientas.
insert into ejercicio (anio, fecha_inicio, fecha_fin, notas)
values (2026, '2026-01-01', '2026-12-31',
        'Primer ejercicio con registro. Falta capturar el saldo de apertura.');

-- ─────────────────────────────────────────────────────────────────────────────
-- Hermanos
-- ─────────────────────────────────────────────────────────────────────────────

create type grado_masonico as enum ('aprendiz', 'companero', 'maestro');
comment on type grado_masonico is
  'El orden del enum es semántico: permite comparar grado >= ''companero''.';

create table hermano (
  id                bigint generated always as identity primary key,
  -- Forma exacta que se publica en el cuadro logial del sitio.
  nombre_completo   text not null,
  grado             grado_masonico not null,

  -- Fecha con la que se calcula la cápita del ejercicio. Para quien viene de
  -- años anteriores es anterior al 1 de enero, y entonces paga el año completo.
  fecha_ingreso     date not null,
  motivo_ingreso    text not null default 'afiliacion'
                    check (motivo_ingreso in ('fundacion', 'iniciacion', 'afiliacion',
                                              'regularizacion')),

  fecha_iniciacion  date,
  fecha_afiliacion  date,

  estatus           text not null default 'activo'
                    check (estatus in ('activo', 'baja')),
  fecha_baja        date,
  motivo_baja       text
                    check (motivo_baja in ('plancha_de_quite', 'irradiacion', 'defuncion',
                                           'traslado', 'suspension', 'otro')),

  correo            text,
  telefono          text,
  notas             text,

  creado_en         timestamptz not null default now(),
  creado_por        bigint references usuario(id),
  actualizado_en    timestamptz not null default now(),
  actualizado_por   bigint references usuario(id),

  constraint hermano_nombre_no_vacio check (btrim(nombre_completo) <> ''),
  constraint hermano_nombre_unico unique (nombre_completo),
  -- La baja es un estado con fecha: o están las dos cosas, o ninguna.
  constraint hermano_baja_coherente check (
    (estatus = 'baja') = (fecha_baja is not null)
  ),
  constraint hermano_baja_con_motivo check (
    (fecha_baja is null) = (motivo_baja is null)
  ),
  constraint hermano_baja_posterior check (
    fecha_baja is null or fecha_baja >= fecha_ingreso
  )
);

comment on column hermano.grado is
  'Grado vigente. El historial de iniciación, aumento de salario y exaltación vive '
  'en hermano_grado; esta columna es la que se consulta para el cuadro y las listas.';
comment on column hermano.fecha_ingreso is
  'Determina el prorrateo de la cápita: quien ingresa en abril de 2026 paga los '
  'meses de abril a diciembre.';

create index hermano_estatus_idx on hermano (estatus);
create index hermano_grado_idx on hermano (grado);

create trigger tr_hermano_toca before update on hermano
  for each row execute function fn_toca_timestamp();

-- ─────────────────────────────────────────────────────────────────────────────
-- Historial de grados
-- ─────────────────────────────────────────────────────────────────────────────

create table hermano_grado (
  id          bigint generated always as identity primary key,
  hermano_id  bigint not null references hermano(id) on delete cascade,
  grado       grado_masonico not null,
  fecha       date not null,
  tipo_evento text not null
              check (tipo_evento in ('iniciacion', 'aumento_salario', 'exaltacion',
                                     'afiliacion', 'regularizacion')),
  notas       text,
  creado_en   timestamptz not null default now(),
  creado_por  bigint references usuario(id),
  unique (hermano_id, tipo_evento, fecha)
);

create index hermano_grado_hermano_idx on hermano_grado (hermano_id, fecha desc);

comment on table hermano_grado is
  'Subir de grado dentro del año NO cambia la cápita: es la misma para los tres '
  'grados. Sí cambia la columna del cuadro logial en la siguiente exportación.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cargos del cuadro
-- ─────────────────────────────────────────────────────────────────────────────

create table cargo (
  id            bigint generated always as identity primary key,
  clave         text not null unique,
  nombre        text not null,
  -- Llave fija del JSON del sitio público. Solo la tienen los dignatarios.
  clave_json    text unique,
  es_dignatario boolean not null default false,
  orden         int not null default 100,
  activo        boolean not null default true,
  check (es_dignatario = (clave_json is not null))
);

comment on column cargo.clave_json is
  'venerableMaestro, primerVigilante, segundoVigilante, orador, secretario y '
  'tesorero son claves fijas del esquema de src/content/config.ts del sitio. Los '
  'oficiales van al array "oficiales" con su nombre de cargo, por eso no la tienen.';

insert into cargo (clave, nombre, clave_json, es_dignatario, orden) values
  ('venerable_maestro',  'Venerable Maestro',  'venerableMaestro',  true,  1),
  ('primer_vigilante',   'Primer Vigilante',   'primerVigilante',   true,  2),
  ('segundo_vigilante',  'Segundo Vigilante',  'segundoVigilante',  true,  3),
  ('orador',             'Orador',             'orador',            true,  4),
  ('secretario',         'Secretario',         'secretario',        true,  5),
  ('tesorero',           'Tesorero',           'tesorero',          true,  6);

insert into cargo (clave, nombre, es_dignatario, orden) values
  ('primer_experto',      'Primer Experto',       false, 10),
  ('segundo_experto',     'Segundo Experto',      false, 11),
  ('primer_diacono',      'Primer Diácono',       false, 12),
  ('segundo_diacono',     'Segundo Diácono',      false, 13),
  ('maestro_ceremonias',  'Maestro de Ceremonias', false, 14),
  ('hospitalario',        'Hospitalario',         false, 15),
  ('porta_estandarte',    'Porta Estandarte',     false, 16),
  ('guarda_templo',       'Guarda Templo',        false, 17),
  ('maestro_banquetes',   'Maestro de Banquetes', false, 18),
  ('representante_gl',    'Representante ante la M∴R∴G∴L∴ Valle de México', false, 20);

-- ─────────────────────────────────────────────────────────────────────────────
-- Asignación anual de cargos
-- ─────────────────────────────────────────────────────────────────────────────

create table cuadro_asignacion (
  id         bigint generated always as identity primary key,
  anio       int not null references ejercicio(anio) on delete cascade,
  cargo_id   bigint not null references cargo(id),
  hermano_id bigint not null references hermano(id) on delete cascade,
  orden      int not null default 100,
  creado_en  timestamptz not null default now(),
  creado_por bigint references usuario(id),
  -- Un solo titular por cargo y año, y nadie ocupa dos veces el mismo cargo.
  unique (anio, cargo_id)
);

create index cuadro_asignacion_anio_idx on cuadro_asignacion (anio);
create index cuadro_asignacion_hermano_idx on cuadro_asignacion (hermano_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Past masters
-- ─────────────────────────────────────────────────────────────────────────────

-- De 2026 en adelante el past master se deriva de cuadro_asignacion. Los años
-- anteriores viven aquí: hay past masters que ya no están en el padrón vigente y
-- no tiene sentido inventarles una ficha con datos que no existen.
create table past_master_historico (
  anio       int primary key check (anio between 1900 and 2100),
  nombre     text not null,
  hermano_id bigint references hermano(id) on delete set null,
  creado_en  timestamptz not null default now(),
  creado_por bigint references usuario(id),
  constraint past_master_nombre_no_vacio check (btrim(nombre) <> '')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tarifas de cuotas de grado
-- ─────────────────────────────────────────────────────────────────────────────

-- Lo que el candidato paga a la logia por su iniciación, aumento de salario o
-- exaltación. Los montos los captura el tesorero, aquí no se inventa ninguno.
create table tarifa_grado (
  anio           int not null references ejercicio(anio) on delete cascade,
  tipo_evento    text not null
                 check (tipo_evento in ('iniciacion', 'aumento_salario', 'exaltacion',
                                        'afiliacion')),
  monto_centavos int not null check (monto_centavos >= 0),
  notas          text,
  creado_en      timestamptz not null default now(),
  creado_por     bigint references usuario(id),
  primary key (anio, tipo_evento)
);
