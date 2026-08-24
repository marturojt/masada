/*
 * Ayuda para las pruebas.
 *
 * Corren contra una base de verdad, no contra imitaciones: casi todas las reglas
 * de este sistema viven en funciones y triggers de PostgreSQL, así que probarlas
 * con dobles no probaría nada.
 *
 * Cada prueba abre una transacción y la revierte al terminar, de modo que la base
 * de pruebas queda igual que como estaba.
 */
import { strict as assert } from 'node:assert';
import pg from 'pg';
import { join } from 'node:path';
import { raizApp } from '../scripts/_comun.mjs';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(raizApp, '.env'));
  } catch {
    /* sin .env */
  }
}

/** La base de pruebas es otra, nunca la de trabajo. */
export function urlDePruebas() {
  const url = process.env.TS_BD_PRUEBAS ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL o TS_BD_PRUEBAS');
  if (url === process.env.DATABASE_URL && !url.includes('pruebas')) {
    /* Se deriva el nombre agregando el sufijo, para no tocar la base real. */
    return url.replace(/\/([^/?]+)(\?|$)/, '/$1_pruebas$2');
  }
  return url;
}

/**
 * Ejecuta el cuerpo dentro de una transacción que siempre se revierte.
 * El cliente recibe además el usuario de la sesión, que es lo que leen los
 * triggers de auditoría.
 */
export async function enPrueba(cuerpo) {
  const cliente = new pg.Client({ connectionString: urlDePruebas() });
  await cliente.connect();
  try {
    await cliente.query('begin');

    /* Dos usuarios para las pruebas de firmas: tesorero y Venerable Maestro. */
    const { rows: usuarios } = await cliente.query(
      `insert into usuario (correo, nombre, hash_contrasena, rol) values
         ('prueba-tesorero@ejemplo.mx', 'Tesorero de prueba', 'scrypt$1$1$1$x$y', 'tesorero'),
         ('prueba-vm@ejemplo.mx', 'Venerable de prueba', 'scrypt$1$1$1$x$y', 'venerable_maestro')
       returning id, rol`,
    );
    /*
     * Los bigint llegan como texto: el cliente de las pruebas no lleva los
     * parsers que la app configura en lib/db.ts.
     */
    const tesorero = Number(usuarios.find((u) => u.rol === 'tesorero').id);
    const vm = Number(usuarios.find((u) => u.rol === 'venerable_maestro').id);

    await cliente.query('select set_config($1, $2, true)', ['app.usuario_id', String(vm)]);

    await cuerpo({ cliente, tesorero, vm });
  } finally {
    await cliente.query('rollback').catch(() => {});
    await cliente.end().catch(() => {});
  }
}

/**
 * Comprueba que una operación falle, sin dejar la transacción abortada.
 *
 * En PostgreSQL, después de un error toda la transacción queda inservible hasta
 * que se retrocede a un savepoint. Sin esto, la primera comprobación de error
 * arrastraría al resto de la prueba.
 */
export async function debeFallar(cliente, operacion, patron) {
  await cliente.query('savepoint prueba_error');
  try {
    await assert.rejects(operacion(), patron);
  } finally {
    await cliente.query('rollback to savepoint prueba_error');
  }
}

/** Alta rápida de un hermano para las pruebas. */
export async function crearHermano(cliente, nombre, fechaIngreso, grado = 'maestro') {
  const { rows } = await cliente.query(
    `insert into hermano (nombre_completo, grado, fecha_ingreso, motivo_ingreso)
     values ($1, $2::grado_masonico, $3, 'regularizacion') returning id`,
    [nombre, grado, fechaIngreso],
  );
  return rows[0].id;
}

/** Registra un pago de cápita ya aplicado a los meses más antiguos con saldo. */
export async function pagarCapita(cliente, hermanoId, fecha, centavos, usuarioId) {
  const { rows: concepto } = await cliente.query(
    "select id from concepto where clave = 'capita'",
  );
  const { rows: mov } = await cliente.query(
    `insert into movimiento
       (fecha, ejercicio_anio, periodo, tipo, bolsa, concepto_id, monto_centavos,
        descripcion, hermano_id, creado_por)
     values ($1, $2, date_trunc('month', $1::date)::date, 'ingreso', 'banco', $3, $4,
             'Pago de prueba', $5, $6)
     returning id`,
    [fecha, Number(fecha.slice(0, 4)), concepto[0].id, centavos, hermanoId, usuarioId],
  );

  const { rows: cargos } = await cliente.query(
    `select capita_cargo_id, saldo_centavos from v_adeudo_capita_mes
      where hermano_id = $1 and saldo_centavos > 0 order by periodo`,
    [hermanoId],
  );

  let restante = centavos;
  for (const cargo of cargos) {
    if (restante <= 0) break;
    const aplica = Math.min(restante, cargo.saldo_centavos);
    await cliente.query(
      `insert into capita_aplicacion
         (movimiento_id, capita_cargo_id, monto_aplicado_centavos, creado_por)
       values ($1, $2, $3, $4)`,
      [mov[0].id, cargo.capita_cargo_id, aplica, usuarioId],
    );
    restante -= aplica;
  }

  return { movimientoId: mov[0].id, aplicado: centavos - restante, sinAplicar: restante };
}

/** Convierte centavos a pesos, para que los mensajes de las pruebas se lean. */
export const pesos = (centavos) => (centavos / 100).toFixed(2);
