/*
 * Errores del dominio. Los mensajes están en español y se muestran al usuario,
 * así que se escriben pensando en quién los va a leer: el tesorero, no un
 * programador.
 */

/** Regla de negocio incumplida. Se muestra tal cual en el formulario. */
export class ErrorDeNegocio extends Error {
  constructor(
    mensaje: string,
    readonly campo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorDeNegocio';
  }
}

/** El mes ya tiene corte cerrado. */
export class MesCerrado extends ErrorDeNegocio {
  constructor(periodo: string) {
    super(
      `El mes ${periodo} ya tiene corte cerrado. Registra un movimiento de ajuste ` +
        'en el mes abierto, o pide al Venerable Maestro que reabra el corte.',
    );
    this.name = 'MesCerrado';
  }
}

/** Formulario reenviado: el nonce ya se había consumido. */
export class FormularioYaEnviado extends ErrorDeNegocio {
  constructor() {
    super(
      'Este formulario ya fue enviado. Si el movimiento no aparece, vuelve a ' +
        'capturarlo desde el formulario en blanco.',
    );
    this.name = 'FormularioYaEnviado';
  }
}

/**
 * No hay sesión donde debería haberla. Solo puede pasar si el middleware y la
 * página no están de acuerdo sobre qué rutas son públicas, y en ese caso un 500
 * ruidoso es exactamente lo que se quiere.
 */
export class SesionRequerida extends Error {
  constructor() {
    super(
      'La página exige sesión y el middleware no la resolvió. Revisa la lista de ' +
        'rutas públicas en src/middleware.ts.',
    );
    this.name = 'SesionRequerida';
  }
}
