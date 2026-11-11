-- 034_mensaje_del_informe.sql
--
-- El informe de tenida lleva, además del texto que arma el sistema con las
-- cifras, un mensaje que escribe el tesorero para los hermanos. Va en una tabla
-- propia y no en el corte: el mensaje se escribe casi siempre después de cerrar
-- el mes, antes de la tenida, y el corte cerrado no se toca.
--
-- No es dinero: se puede corregir y borrar. Cada cambio queda en la bitácora.

create table informe_mensaje (
  periodo         date primary key,
  ejercicio_anio  int not null references ejercicio(anio),
  mensaje         text not null,
  creado_en       timestamptz not null default now(),
  creado_por      bigint references usuario(id),
  actualizado_en  timestamptz not null default now(),
  actualizado_por bigint references usuario(id),
  constraint informe_mensaje_dia_uno check (extract(day from periodo) = 1),
  constraint informe_mensaje_anio_coincide
    check (extract(year from periodo)::int = ejercicio_anio),
  constraint informe_mensaje_no_vacio check (btrim(mensaje) <> ''),
  constraint informe_mensaje_largo check (char_length(mensaje) <= 4000)
);

comment on table informe_mensaje is
  'Mensaje del tesorero para el informe de tenida de un mes. Se imprime junto al '
  'texto que el sistema arma con las cifras del corte.';

create trigger tr_informe_mensaje_toca before update on informe_mensaje
  for each row execute function fn_toca_timestamp();
