#!/usr/bin/env node
/*
 * Siembra los datos iniciales del sistema.
 *
 *   node scripts/sembrar.mjs                    crea los usuarios (interactivo)
 *   node scripts/sembrar.mjs --agregar          agrega un usuario más
 *   node scripts/sembrar.mjs --desde-sitio      importa el padrón del sitio público
 *
 * Modo no interactivo para los usuarios, útil al restaurar. La contraseña se lee
 * de la variable TS_CONTRASENA, nunca de un argumento: los argumentos quedan en
 * el historial del shell y son visibles en la lista de procesos.
 *
 *   TS_CONTRASENA='...' node scripts/sembrar.mjs \
 *     --correo tesorero@masada324.org --nombre 'Nombre Completo' --rol tesorero
 *
 * No imprime nada sensible.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MINIMO_CONTRASENA, hashearContrasena, revisarFortaleza } from '../src/lib/auth.ts';
import { argumentos, conectar, pregunta, preguntaOculta, raizApp } from './_comun.mjs';

const { banderas, valores } = argumentos();
const ROLES = ['tesorero', 'venerable_maestro', 'super_admin'];

const cliente = await conectar();

try {
  if (banderas.has('desde-sitio')) {
    await importarDesdeSitio(cliente, Number(valores.anio ?? 2026));
  } else {
    await sembrarUsuarios(cliente);
  }
} finally {
  await cliente.end().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Usuarios
// ─────────────────────────────────────────────────────────────────────────────

async function sembrarUsuarios(cliente) {
  const { rows } = await cliente.query('select count(*)::int as total from usuario');
  const hayUsuarios = rows[0].total > 0;

  if (hayUsuarios && !banderas.has('agregar')) {
    console.error(
      `Ya hay ${rows[0].total} usuario(s) en el sistema.\n` +
        'Para agregar otro usa --agregar, para cambiar una contraseña usa:\n' +
        '  npm run contrasena -- --correo <correo>',
    );
    process.exit(1);
  }

  const noInteractivo = Boolean(valores.correo);
  const usuarios = [];

  if (noInteractivo) {
    const contrasena = process.env.TS_CONTRASENA;
    if (!contrasena) {
      console.error('error: en modo no interactivo la contraseña va en TS_CONTRASENA.');
      process.exit(1);
    }
    usuarios.push({
      correo: String(valores.correo).toLowerCase(),
      nombre: String(valores.nombre ?? '').trim(),
      rol: String(valores.rol ?? ''),
      contrasena,
    });
  } else {
    const cuantos = hayUsuarios ? 1 : 2;
    if (cuantos === 2) {
      console.log(
        '\nSe van a crear los dos usuarios del sistema: el Tesorero y el Venerable Maestro.\n' +
          `La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres. ` +
          'Una frase con espacios sirve y es más fácil de recordar.\n',
      );
    }

    for (let i = 0; i < cuantos; i += 1) {
      const etiqueta = cuantos === 2 ? ` (${i + 1} de 2)` : '';
      console.log(`\nUsuario${etiqueta}`);

      const correo = (await pregunta('  Correo: ')).toLowerCase();
      const nombre = await pregunta('  Nombre completo: ');
      let rol = '';
      while (!ROLES.includes(rol)) {
        rol = await pregunta('  Rol [tesorero | venerable_maestro | super_admin]: ');
        if (!ROLES.includes(rol)) console.log('    Escribe tesorero, venerable_maestro o super_admin.');
      }

      let contrasena = '';
      for (;;) {
        contrasena = await preguntaOculta('  Contraseña: ');
        const problema = revisarFortaleza(contrasena);
        if (problema) {
          console.log(`    ${problema}`);
          continue;
        }
        const otraVez = await preguntaOculta('  Repite la contraseña: ');
        if (contrasena !== otraVez) {
          console.log('    No coinciden, inténtalo de nuevo.');
          continue;
        }
        break;
      }

      usuarios.push({ correo, nombre, rol, contrasena });
    }
  }

  for (const u of usuarios) {
    if (!u.correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.correo)) {
      console.error(`error: el correo "${u.correo}" no tiene formato válido.`);
      process.exit(1);
    }
    if (!u.nombre) {
      console.error('error: el nombre es obligatorio.');
      process.exit(1);
    }
    if (!ROLES.includes(u.rol)) {
      console.error(`error: rol inválido "${u.rol}". Usa tesorero o venerable_maestro.`);
      process.exit(1);
    }
    const problema = revisarFortaleza(u.contrasena);
    if (problema) {
      console.error(`error: ${problema}`);
      process.exit(1);
    }
  }

  for (const u of usuarios) {
    const hash = await hashearContrasena(u.contrasena);
    try {
      await cliente.query(
        'insert into usuario (correo, nombre, hash_contrasena, rol) values ($1, $2, $3, $4)',
        [u.correo, u.nombre, hash, u.rol],
      );
      console.log(`\n+ ${u.correo} creado como ${u.rol}`);
    } catch (error) {
      if (error.code === '23505') {
        console.error(`\nerror: ya existe un usuario con el correo ${u.correo}.`);
        process.exit(1);
      }
      if (error.code?.startsWith('23')) {
        console.error(`\nerror: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
  }

  console.log('\nListo. Entra en http://127.0.0.1:4322/entrar');
}

// ─────────────────────────────────────────────────────────────────────────────
// Padrón desde el sitio público
// ─────────────────────────────────────────────────────────────────────────────

/*
 * Importa el cuadro logial publicado para no capturar los mismos nombres dos
 * veces. Del sitio solo salen nombres, grado y cargo: las fechas de iniciación,
 * el contacto y la fecha real de ingreso las completa después el tesorero.
 *
 * Es idempotente por nombre exacto, así que se puede volver a correr sin
 * duplicar. Lo que ya existe no se toca.
 */
async function importarDesdeSitio(cliente, anio) {
  const raizSitio = process.env.TS_RUTA_SITIO_PUBLICO ?? join(raizApp, '..');
  const rutaCuadro = join(raizSitio, 'src', 'content', 'cuadro', `${anio}.json`);
  const rutaPast = join(raizSitio, 'src', 'content', 'pastmasters', 'historico.json');

  let cuadro;
  try {
    cuadro = JSON.parse(await readFile(rutaCuadro, 'utf8'));
  } catch (error) {
    console.error(`error: no se pudo leer ${rutaCuadro}\n  ${error.message}`);
    process.exit(1);
  }

  const { rows: ejercicios } = await cliente.query(
    'select anio, fecha_inicio from ejercicio where anio = $1',
    [anio],
  );
  if (ejercicios.length === 0) {
    console.error(`error: no existe el ejercicio ${anio} en la base.`);
    process.exit(1);
  }

  /*
   * Quien ya estaba en la logia antes del ejercicio paga el año completo, así que
   * su fecha de ingreso tiene que ser anterior al 1 de enero. Se marca como
   * regularización y queda como dato pendiente de corregir.
   */
  const fechaIngreso = `${anio - 1}-12-31`;

  const DIGNATARIOS = [
    'venerableMaestro',
    'primerVigilante',
    'segundoVigilante',
    'orador',
    'secretario',
    'tesorero',
  ];

  const aImportar = [];

  for (const claveJson of DIGNATARIOS) {
    const dato = cuadro[claveJson];
    if (dato?.nombre) {
      aImportar.push({ nombre: dato.nombre, grado: 'maestro', claveJson, cargoNombre: null });
    }
  }

  for (const oficial of cuadro.oficiales ?? []) {
    if (oficial?.nombre) {
      aImportar.push({
        nombre: oficial.nombre,
        grado: 'maestro',
        claveJson: null,
        cargoNombre: oficial.cargo ?? null,
      });
    }
  }

  for (const nombre of cuadro.maestros ?? []) {
    aImportar.push({ nombre, grado: 'maestro', claveJson: null, cargoNombre: null });
  }
  for (const nombre of cuadro.companeros ?? []) {
    aImportar.push({ nombre, grado: 'companero', claveJson: null, cargoNombre: null });
  }
  for (const nombre of cuadro.aprendices ?? []) {
    aImportar.push({ nombre, grado: 'aprendiz', claveJson: null, cargoNombre: null });
  }

  let creados = 0;
  let existentes = 0;
  let cargosAsignados = 0;

  await cliente.query('begin');
  try {
    for (const registro of aImportar) {
      const nombre = registro.nombre.trim().replace(/\s+/g, ' ');

      const { rows: previos } = await cliente.query(
        'select id from hermano where nombre_completo = $1',
        [nombre],
      );

      let hermanoId;
      if (previos.length > 0) {
        hermanoId = previos[0].id;
        existentes += 1;
      } else {
        const { rows } = await cliente.query(
          `insert into hermano
             (nombre_completo, grado, fecha_ingreso, motivo_ingreso, notas)
           values ($1, $2::grado_masonico, $3, 'regularizacion', $4)
           returning id`,
          [
            nombre,
            registro.grado,
            fechaIngreso,
            `Importado del cuadro logial ${anio} del sitio. Falta confirmar la fecha real de ingreso.`,
          ],
        );
        hermanoId = rows[0].id;
        creados += 1;

        await cliente.query(
          `insert into hermano_grado (hermano_id, grado, fecha, tipo_evento, notas)
           values ($1, $2::grado_masonico, $3, 'regularizacion', $4)
           on conflict (hermano_id, tipo_evento, fecha) do nothing`,
          [hermanoId, registro.grado, fechaIngreso, 'Registro inicial importado del sitio.'],
        );
      }

      /* Cargo del año, por clave del JSON para dignatarios o por nombre para oficiales. */
      let cargoId = null;
      if (registro.claveJson) {
        const { rows } = await cliente.query('select id from cargo where clave_json = $1', [
          registro.claveJson,
        ]);
        cargoId = rows[0]?.id ?? null;
      } else if (registro.cargoNombre) {
        const { rows } = await cliente.query('select id from cargo where nombre = $1', [
          registro.cargoNombre,
        ]);
        if (rows.length > 0) {
          cargoId = rows[0].id;
        } else {
          /* Cargo que el sitio nombra y el catálogo no tenía. Se agrega. */
          /* Mismo criterio que slugifyTag del sitio: NFD y fuera los diacríticos. */
          const clave = registro.cargoNombre
            .toLowerCase()
            .normalize('NFD')
            .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
          const { rows: nuevo } = await cliente.query(
            `insert into cargo (clave, nombre, es_dignatario, orden) values ($1, $2, false, 50)
             on conflict (clave) do update set nombre = excluded.nombre
             returning id`,
            [clave, registro.cargoNombre],
          );
          cargoId = nuevo[0].id;
          console.log(`  cargo agregado al catálogo: ${registro.cargoNombre}`);
        }
      }

      if (cargoId !== null) {
        await cliente.query(
          'delete from cuadro_asignacion where anio = $1 and cargo_id = $2',
          [anio, cargoId],
        );
        await cliente.query(
          `insert into cuadro_asignacion (anio, cargo_id, hermano_id, orden)
           values ($1, $2, $3, (select orden from cargo where id = $2))`,
          [anio, cargoId, hermanoId],
        );
        cargosAsignados += 1;
      }
    }

    /* Past masters de años anteriores, que pueden ya no estar en el padrón. */
    let pastMasters = 0;
    try {
      const historico = JSON.parse(await readFile(rutaPast, 'utf8'));
      for (const item of historico.items ?? []) {
        if (!item?.anio || !item?.nombre) continue;
        if (item.anio >= anio) continue;
        const { rows } = await cliente.query(
          'select id from hermano where nombre_completo = $1',
          [item.nombre],
        );
        await cliente.query(
          `insert into past_master_historico (anio, nombre, hermano_id)
           values ($1, $2, $3)
           on conflict (anio) do update
             set nombre = excluded.nombre, hermano_id = excluded.hermano_id`,
          [item.anio, item.nombre, rows[0]?.id ?? null],
        );
        pastMasters += 1;
      }
    } catch {
      console.log('  aviso: no se encontró el histórico de past masters, se omite.');
    }

    await cliente.query('commit');

    console.log(
      `\nPadrón importado del cuadro ${anio}:\n` +
        `  hermanos nuevos:   ${creados}\n` +
        `  ya existentes:     ${existentes}\n` +
        `  cargos asignados:  ${cargosAsignados}\n` +
        `  past masters:      ${pastMasters}\n\n` +
        'Pendiente por hermano: fecha real de ingreso, iniciación y contacto.',
    );
  } catch (error) {
    await cliente.query('rollback');
    throw error;
  }
}
