-- 003_caja.sql
-- Catálogo de conceptos, archivos de comprobante y el libro de caja.
--
-- Contabilidad de partida simple: una sola bolsa, un solo libro. La partida
-- doble sería sobreingeniería para una logia sin centros de costo ni bancos
-- separados.

-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo de conceptos
-- ─────────────────────────────────────────────────────────────────────────────

create table concepto (
  id            bigint generated always as identity primary key,
  clave         text not null unique,
  nombre        text not null,
  naturaleza    text not null check (naturaleza in ('ingreso', 'egreso')),
  -- Discrimina los conceptos que tienen lógica propia en el sistema. El tesorero
  -- puede crear cuantos quiera con tipo_especial 'otro' sin tocar código.
  tipo_especial text not null default 'otro'
                check (tipo_especial in ('capita', 'cuota_grado', 'donativo',
                                         'devolucion_por_comprobar', 'gran_tesoreria',
                                         'gran_logia_grado', 'otro')),
  requiere_hermano          boolean not null default false,
  requiere_comprobante      boolean not null default false,
  por_comprobar_por_defecto boolean not null default false,
  -- Los conceptos que el sistema usa por su cuenta no se ofrecen en los
  -- formularios genéricos: las cápitas se registran en su propio módulo y las
  -- devoluciones las genera la comprobación de un egreso.
  seleccionable boolean not null default true,
  activo        boolean not null default true,
  orden         int not null default 100,
  notas         text,
  creado_en     timestamptz not null default now(),
  creado_por    bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id),
  constraint concepto_nombre_no_vacio check (btrim(nombre) <> '')
);

create trigger tr_concepto_toca before update on concepto
  for each row execute function fn_toca_timestamp();

comment on column concepto.requiere_comprobante is
  'Todo egreso pagado necesita imagen de comprobante. En los ingresos es '
  'opcional, porque muchos hermanos pagan en efectivo en la tenida.';

insert into concepto
  (clave, nombre, naturaleza, tipo_especial, requiere_hermano, requiere_comprobante,
   por_comprobar_por_defecto, seleccionable, orden, notas)
values
  -- Ingresos
  ('capita', 'Cápita', 'ingreso', 'capita', true, false, false, false, 1,
   'Se registra desde el módulo de cápitas, no desde el formulario de ingresos.'),
  ('cuota_iniciacion', 'Cuota de iniciación', 'ingreso', 'cuota_grado', true, false, false, true, 10,
   'Lo que el candidato paga a la logia por su iniciación.'),
  ('cuota_aumento_salario', 'Cuota de aumento de salario', 'ingreso', 'cuota_grado', true, false, false, true, 11, null),
  ('cuota_exaltacion', 'Cuota de exaltación', 'ingreso', 'cuota_grado', true, false, false, true, 12, null),
  ('cuota_afiliacion', 'Cuota de afiliación', 'ingreso', 'cuota_grado', true, false, false, true, 13, null),
  ('donativo', 'Donativo o aportación extraordinaria', 'ingreso', 'donativo', false, false, false, true, 20, null),
  ('devolucion_por_comprobar', 'Devolución de gasto por comprobar', 'ingreso',
   'devolucion_por_comprobar', false, false, false, false, 30,
   'La genera la comprobación de un egreso, no se captura a mano.'),
  ('otro_ingreso', 'Otro ingreso', 'ingreso', 'otro', false, false, false, true, 90, null),

  -- Egresos
  ('gran_tesoreria', 'Pago de cápitas a la Gran Tesorería', 'egreso', 'gran_tesoreria',
   false, true, false, true, 1,
   'Lleva el cálculo que envía la Gran Tesorería y el comprobante del pago.'),
  ('gl_iniciacion', 'Pago de iniciación a la Gran Logia', 'egreso', 'gran_logia_grado', true, true, false, true, 10, null),
  ('gl_aumento_salario', 'Pago de aumento de salario a la Gran Logia', 'egreso', 'gran_logia_grado', true, true, false, true, 11, null),
  ('gl_exaltacion', 'Pago de exaltación a la Gran Logia', 'egreso', 'gran_logia_grado', true, true, false, true, 12, null),
  ('agape', 'Ágape, vino y alimentos', 'egreso', 'otro', false, true, true, true, 20,
   'Normalmente se entrega dinero por comprobar y después se suben los recibos.'),
  ('templo', 'Gastos del templo y mantenimiento', 'egreso', 'otro', false, true, false, true, 21, null),
  ('beneficencia', 'Beneficencia y apoyo a hermanos', 'egreso', 'otro', false, true, false, true, 22, null),
  ('papeleria', 'Papelería, mandiles y joyas', 'egreso', 'otro', false, true, false, true, 23, null),
  ('otro_egreso', 'Otro egreso', 'egreso', 'otro', false, true, false, true, 90, null);

-- ─────────────────────────────────────────────────────────────────────────────
-- Archivos de comprobante
-- ─────────────────────────────────────────────────────────────────────────────

-- Los bytes viven en disco, fuera del webroot. Aquí va la ruta relativa, para
-- que mover el almacén sea cambiar una variable de entorno.
create table archivo (
  id              bigint generated always as identity primary key,
  ruta_relativa   text not null unique,
  nombre_original text not null,
  -- Tipo detectado por los primeros bytes, no el que declaró el navegador.
  mime            text not null
                  check (mime in ('image/jpeg', 'image/png', 'image/webp',
                                  'image/heic', 'application/pdf')),
  bytes           int not null check (bytes between 1 and 20971520),
  -- Deduplica y sirve para verificar que el respaldo no se corrompió.
  sha256          text not null unique,
  subido_por      bigint references usuario(id),
  subido_en       timestamptz not null default now()
);

create index archivo_subido_idx on archivo (subido_en desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Libro de caja
-- ─────────────────────────────────────────────────────────────────────────────

create table movimiento (
  id              bigint generated always as identity primary key,
  fecha           date not null,
  ejercicio_anio  int not null references ejercicio(anio),
  -- Mes contable, día 1. Es lo que agrupa el corte.
  periodo         date not null,
  tipo            text not null check (tipo in ('ingreso', 'egreso')),
  concepto_id     bigint not null references concepto(id),
  monto_centavos  int not null check (monto_centavos between 1 and 100000000),
  -- Columna generada con signo: el saldo de caja es un simple sum().
  efecto_centavos int generated always as
                  (case when tipo = 'ingreso' then monto_centavos else -monto_centavos end)
                  stored,
  descripcion     text not null,
  hermano_id      bigint references hermano(id),
  -- Se les pone llave foránea en 005 y 006, cuando existan esas tablas.
  egreso_id       bigint,
  corte_id        bigint,
  archivo_id      bigint references archivo(id),
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id),
  constraint movimiento_descripcion_no_vacia check (btrim(descripcion) <> ''),
  constraint movimiento_periodo_dia_uno check (extract(day from periodo) = 1),
  constraint movimiento_periodo_coincide check (periodo = date_trunc('month', fecha)::date),
  constraint movimiento_anio_coincide check (extract(year from fecha)::int = ejercicio_anio)
);

comment on table movimiento is
  'Fuente de verdad del efectivo. No se borra nunca (lo impide un trigger) y no '
  'tiene estado "cancelado": una equivocación se corrige con un movimiento de '
  'signo contrario que apunta al original a través de movimiento_ajuste. Así el '
  'libro no miente hacia atrás.';

create index movimiento_fecha_idx    on movimiento (fecha);
create index movimiento_periodo_idx  on movimiento (periodo);
create index movimiento_concepto_idx on movimiento (concepto_id);
create index movimiento_hermano_idx  on movimiento (hermano_id) where hermano_id is not null;
create index movimiento_egreso_idx   on movimiento (egreso_id) where egreso_id is not null;
create index movimiento_corte_idx    on movimiento (corte_id) where corte_id is not null;

create trigger tr_movimiento_toca before update on movimiento
  for each row execute function fn_toca_timestamp();

-- El libro de caja no admite borrado físico, nunca.
create or replace function fn_prohibir_borrado() returns trigger
language plpgsql as $$
begin
  raise exception
    'Los movimientos no se borran. Registra un movimiento de ajuste que lo corrija.';
end $$;

create trigger tr_movimiento_no_borrar before delete on movimiento
  for each row execute function fn_prohibir_borrado();

-- Coherencia entre el movimiento y su concepto. Un CHECK no puede consultar otra
-- tabla, así que va como trigger.
create or replace function fn_movimiento_coherente() returns trigger
language plpgsql as $$
declare c concepto;
begin
  select * into c from concepto where id = new.concepto_id;

  if c.naturaleza <> new.tipo then
    raise exception 'El concepto "%" es de %, no se puede usar en un %',
      c.nombre, c.naturaleza, new.tipo;
  end if;

  if c.requiere_hermano and new.hermano_id is null then
    raise exception 'El concepto "%" exige indicar de qué hermano se trata', c.nombre;
  end if;

  return new;
end $$;

create trigger tr_movimiento_coherente before insert or update on movimiento
  for each row execute function fn_movimiento_coherente();

-- ─────────────────────────────────────────────────────────────────────────────
-- Ajustes
-- ─────────────────────────────────────────────────────────────────────────────

create table movimiento_ajuste (
  movimiento_ajuste_id bigint primary key references movimiento(id),
  movimiento_origen_id bigint not null references movimiento(id),
  motivo               text not null,
  autorizado_por       bigint not null references usuario(id),
  creado_en            timestamptz not null default now(),
  creado_por           bigint references usuario(id),
  check (movimiento_ajuste_id <> movimiento_origen_id),
  constraint ajuste_motivo_no_vacio check (btrim(motivo) <> '')
);

comment on table movimiento_ajuste is
  'Corrección explícita y rastreable. Es el camino normal para arreglar un mes '
  'que ya tiene corte cerrado, sin reescribir el pasado.';
