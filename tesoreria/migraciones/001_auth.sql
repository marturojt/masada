-- 001_auth.sql
-- Usuarios, sesiones y bitácora. Solo entran el tesorero y el Venerable Maestro,
-- los hermanos no tienen acceso al sistema.

create extension if not exists btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- Contexto de la transacción
-- ─────────────────────────────────────────────────────────────────────────────

-- La aplicación inyecta el usuario con set_config('app.usuario_id', ..., true)
-- al abrir cada transacción. Los triggers de auditoría lo leen de aquí. Si viene
-- nulo, significa que algo se hizo fuera de la aplicación (por ejemplo desde
-- psql), y eso mismo es información útil, no un error.
create or replace function fn_usuario_actual() returns bigint
language sql stable as $$
  select nullif(current_setting('app.usuario_id', true), '')::bigint
$$;

create or replace function fn_toca_timestamp() returns trigger
language plpgsql as $$
begin
  new.actualizado_en  := now();
  new.actualizado_por := coalesce(fn_usuario_actual(), new.actualizado_por);
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Usuarios
-- ─────────────────────────────────────────────────────────────────────────────

create table usuario (
  id              bigint generated always as identity primary key,
  correo          text not null unique,
  nombre          text not null,
  -- Formato: scrypt$N$r$p$<salt base64>$<derivada base64>. El prefijo versionado
  -- permite subir el costo o migrar de KDF sin tocar la tabla.
  hash_contrasena text not null,
  rol             text not null check (rol in ('tesorero', 'venerable_maestro')),
  activo          boolean not null default true,
  ultimo_acceso   timestamptz,
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id),
  constraint usuario_correo_no_vacio check (btrim(correo) <> ''),
  constraint usuario_nombre_no_vacio check (btrim(nombre) <> '')
);

comment on column usuario.rol is
  'Determina qué firma puede aportar en un egreso. El VM puede cubrir la firma '
  'del tesorero, nunca al revés.';

create trigger tr_usuario_toca before update on usuario
  for each row execute function fn_toca_timestamp();

-- ─────────────────────────────────────────────────────────────────────────────
-- Sesiones
-- ─────────────────────────────────────────────────────────────────────────────

-- Se guarda el sha256 del identificador, nunca el identificador. Un volcado de
-- la base no alcanza para secuestrar una sesión viva.
create table sesion (
  id_hash      text        primary key,
  usuario_id   bigint      not null references usuario(id) on delete cascade,
  csrf_token   text        not null,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  limite_en    timestamptz not null,
  ultimo_uso   timestamptz not null default now(),
  ip           text,
  user_agent   text,
  check (expira_en > creada_en),
  check (limite_en >= expira_en)
);

comment on column sesion.expira_en is
  'Expiración por inactividad, se desliza con el uso.';
comment on column sesion.limite_en is
  'Tope absoluto desde la creación. Ni con uso continuo se pasa de aquí.';

create index sesion_usuario_idx on sesion (usuario_id);
create index sesion_expira_idx  on sesion (expira_en);

-- ─────────────────────────────────────────────────────────────────────────────
-- Intentos de acceso, para el límite de intentos
-- ─────────────────────────────────────────────────────────────────────────────

-- En base y no en memoria: systemd reinicia el proceso y la memoria se va,
-- justo cuando más importa que el contador siga ahí.
create table intento_acceso (
  id        bigint generated always as identity primary key,
  correo    text        not null,
  ip        text,
  exito     boolean     not null,
  momento   timestamptz not null default now()
);

create index intento_acceso_busqueda_idx
  on intento_acceso (correo, ip, momento desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Nonces de formulario, contra el doble envío
-- ─────────────────────────────────────────────────────────────────────────────

create table nonce_formulario (
  token        text        primary key,
  sesion_hash  text        not null references sesion(id_hash) on delete cascade,
  proposito    text        not null,
  creado_en    timestamptz not null default now(),
  expira_en    timestamptz not null
);

create index nonce_formulario_sesion_idx on nonce_formulario (sesion_hash);
create index nonce_formulario_expira_idx on nonce_formulario (expira_en);

comment on table nonce_formulario is
  'Se consume de forma atómica con delete ... returning dentro de la misma '
  'transacción del movimiento. El segundo envío del mismo formulario falla con '
  '409 en lugar de duplicar un asiento de dinero.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Bitácora de aplicación
-- ─────────────────────────────────────────────────────────────────────────────

-- Complementa la auditoría por trigger (migración 008): aquí se registra la
-- intención en términos del dominio ("autorizó el egreso EG-2026-0004 supliendo
-- al tesorero"), no el diff de columnas.
create table bitacora (
  id          bigint generated always as identity primary key,
  momento     timestamptz not null default now(),
  usuario_id  bigint references usuario(id),
  id_peticion text,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  ip          text
);

create index bitacora_momento_idx on bitacora (momento desc);
create index bitacora_entidad_idx on bitacora (entidad, entidad_id, momento desc);
create index bitacora_usuario_idx on bitacora (usuario_id, momento desc);
