/*
 * Informe de tenida: lo que el tesorero lee a los hermanos cada mes.
 *
 * Lleva dos textos. Uno lo arma el sistema con las cifras del corte, para que
 * nunca diga algo distinto de los números. El otro es el mensaje del tesorero,
 * que se guarda aparte del corte (migración 034) y se puede corregir aunque el
 * mes ya esté cerrado. El informe no nombra a quienes deben: solo da cifras.
 */
import { consulta, unaFila, type Tx } from '../db';
import { formatoMXN } from '../dinero';
import { nombrePeriodo } from '../fechas';
import type { EstadoAplomo } from './gt';

export interface MensajeInforme {
  mensaje: string;
  actualizado_nombre: string | null;
  actualizado_en: string;
}

export const mensajeDelInforme = (periodo: string): Promise<MensajeInforme | null> =>
  unaFila<MensajeInforme>(
    `select i.mensaje, u.nombre as actualizado_nombre, i.actualizado_en::text
       from informe_mensaje i
       left join usuario u on u.id = coalesce(i.actualizado_por, i.creado_por)
      where i.periodo = $1`,
    [`${periodo}-01`],
  );

/** Guarda el mensaje; vacío lo borra. Devuelve si había uno antes. */
export async function guardarMensajeEnBase(
  tx: Tx,
  periodo: string,
  mensaje: string | undefined,
  usuarioId: number,
): Promise<'creado' | 'actualizado' | 'borrado' | 'sin_cambio'> {
  const fecha = `${periodo}-01`;
  const previo = await tx.unaFila<{ mensaje: string }>(
    'select mensaje from informe_mensaje where periodo = $1 for update',
    [fecha],
  );

  if (mensaje === undefined) {
    if (!previo) return 'sin_cambio';
    await tx.consulta('delete from informe_mensaje where periodo = $1', [fecha]);
    return 'borrado';
  }
  if (previo?.mensaje === mensaje) return 'sin_cambio';

  await tx.consulta(
    `insert into informe_mensaje (periodo, ejercicio_anio, mensaje, creado_por, actualizado_por)
     values ($1, $2, $3, $4, $4)
     on conflict (periodo) do update set mensaje = excluded.mensaje`,
    [fecha, Number(periodo.slice(0, 4)), mensaje, usuarioId],
  );
  return previo ? 'actualizado' : 'creado';
}

/** Cápitas del mes: lo que se esperaba cobrar y lo que se aplicó a ese mes. */
export const capitasDelMes = async (
  periodo: string,
): Promise<{ esperado: number; cobrado: number }> => {
  const fila = await unaFila<{ esperado: number; cobrado: number }>(
    `select coalesce((select sum(monto_esperado_centavos) from capita_cargo
                       where periodo = $1 and estado = 'vigente'), 0)::int as esperado,
            coalesce((select sum(ca.monto_aplicado_centavos)
                        from capita_aplicacion ca
                        join capita_cargo cc on cc.id = ca.capita_cargo_id
                       where cc.periodo = $1), 0)::int as cobrado`,
    [`${periodo}-01`],
  );
  return fila ?? { esperado: 0, cobrado: 0 };
};

/** Egresos del mes con su detalle, para que los hermanos vean a dónde fue el dinero. */
export const egresosDelMes = (
  periodo: string,
): Promise<{ fecha: string; concepto_nombre: string; descripcion: string; beneficiario: string | null; monto_centavos: number }[]> =>
  consulta(
    `select m.fecha::text, c.nombre as concepto_nombre, m.descripcion,
            e.beneficiario, m.monto_centavos
       from movimiento m
       join concepto c on c.id = m.concepto_id
       left join egreso e on e.id = m.egreso_id
      where m.periodo = $1 and m.tipo = 'egreso'
      order by m.fecha, m.id`,
    [`${periodo}-01`],
  );

export interface DatosParrafos {
  periodo: string;
  cerrado: boolean;
  saldoInicial: number;
  ingresos: number;
  egresos: number;
  saldoFinal: number;
  /** Banco y efectivo al cierre, solo si el control por bolsa ya vale ese mes. */
  bolsas: { banco: number; efectivo: number } | null;
  mayorIngreso: { nombre: string; monto: number } | null;
  mayorEgreso: { nombre: string; monto: number } | null;
  capitasMes: { esperado: number; cobrado: number };
  capitasHoy: { alCorriente: number; conAdeudo: number; vencido: number };
  aplomo: EstadoAplomo;
}

/**
 * El texto que arma el sistema. Frases cortas, en el orden en que se leen en
 * tenida: el dinero del mes, de dónde vino y a dónde fue, las cápitas y la
 * Gran Tesorería.
 */
export function parrafosAutomaticos(d: DatosParrafos): string[] {
  const mes = nombrePeriodo(d.periodo);
  const parrafos: string[] = [];
  const resultado = d.ingresos - d.egresos;

  let dinero =
    d.ingresos === 0 && d.egresos === 0
      ? `En ${mes} no hubo ingresos ni egresos, y el saldo de la tesorería se mantuvo en ${formatoMXN(d.saldoFinal)}.`
      : `En ${mes} ingresaron ${formatoMXN(d.ingresos)} y salieron ${formatoMXN(d.egresos)}, ` +
        (resultado > 0
          ? `con un resultado a favor de ${formatoMXN(resultado)}. `
          : resultado < 0
            ? `con un resultado en contra de ${formatoMXN(-resultado)}. `
            : 'así que el mes quedó parejo. ') +
        `El saldo de la tesorería pasó de ${formatoMXN(d.saldoInicial)} a ${formatoMXN(d.saldoFinal)}.`;
  if (d.bolsas) {
    dinero += ` De ese saldo, ${formatoMXN(d.bolsas.banco)} están en el banco y ${formatoMXN(d.bolsas.efectivo)} en efectivo.`;
  }
  parrafos.push(dinero);

  /* Los nombres de concepto van tal cual: algunos son nombres propios. */
  const ing = d.mayorIngreso && `${d.mayorIngreso.nombre} (${formatoMXN(d.mayorIngreso.monto)})`;
  const egr = d.mayorEgreso && `${d.mayorEgreso.nombre} (${formatoMXN(d.mayorEgreso.monto)})`;
  if (ing && egr) {
    parrafos.push(`El concepto con más ingresos fue ${ing}, y el de más egresos, ${egr}.`);
  } else if (ing) {
    parrafos.push(`El concepto con más ingresos fue ${ing}.`);
  } else if (egr) {
    parrafos.push(`El concepto con más egresos fue ${egr}.`);
  }

  let capitas =
    d.capitasMes.esperado > 0
      ? `De las cápitas del mes se esperaban ${formatoMXN(d.capitasMes.esperado)} y se han cobrado ` +
        `${formatoMXN(d.capitasMes.cobrado)}, el ${Math.round((d.capitasMes.cobrado / d.capitasMes.esperado) * 100)}%.`
      : 'Este mes no tenía cápitas por cobrar.';
  capitas +=
    d.capitasHoy.conAdeudo === 0
      ? ' Al día de hoy todos los hermanos están al corriente.'
      : ` Al día de hoy, ${d.capitasHoy.alCorriente} ${d.capitasHoy.alCorriente === 1 ? 'hermano está' : 'hermanos están'} al corriente ` +
        `y ${d.capitasHoy.conAdeudo} ${d.capitasHoy.conAdeudo === 1 ? 'tiene' : 'tienen'} adeudo vencido por ${formatoMXN(d.capitasHoy.vencido)}.`;
  parrafos.push(capitas);

  const cubierta = d.aplomo.cubierto_hasta
    ? `, con lo ordinario cubierto hasta ${nombrePeriodo(d.aplomo.cubierto_hasta.slice(0, 7))}`
    : '';
  parrafos.push(
    d.aplomo.ordinario_a_plomo
      ? `Con la Gran Tesorería, la logia está a plomo${cubierta}.`
      : `Con la Gran Tesorería, la logia tiene ${d.aplomo.meses_pendientes} ` +
          `${d.aplomo.meses_pendientes === 1 ? 'mes ordinario pendiente' : 'meses ordinarios pendientes'}${cubierta}.`,
  );

  if (!d.cerrado) {
    parrafos.push('Este informe es un borrador: el mes todavía no se cierra y las cifras pueden cambiar.');
  }
  return parrafos;
}
