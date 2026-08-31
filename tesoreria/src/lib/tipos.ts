/* Tipos del dominio compartidos por toda la app. */

export type Rol = 'tesorero' | 'venerable_maestro' | 'super_admin';

/** El super_admin tiene el mismo nivel de autoridad que el Venerable Maestro. */
export const esNivelVM = (rol: Rol): boolean =>
  rol === 'venerable_maestro' || rol === 'super_admin';

export type Grado = 'aprendiz' | 'companero' | 'maestro';

export type Bolsa = 'banco' | 'efectivo';

export const NOMBRE_BOLSA: Record<Bolsa, string> = {
  banco: 'Banco',
  efectivo: 'Efectivo',
};

export const NOMBRE_ROL: Record<Rol, string> = {
  tesorero: 'Tesorero',
  venerable_maestro: 'Venerable Maestro',
  super_admin: 'Super administrador',
};

export const NOMBRE_GRADO: Record<Grado, string> = {
  aprendiz: 'Aprendiz',
  companero: 'Compañero',
  maestro: 'Maestro',
};

/** Plural, para encabezados de columna del cuadro. */
export const NOMBRE_GRADO_PLURAL: Record<Grado, string> = {
  aprendiz: 'Aprendices',
  companero: 'Compañeros',
  maestro: 'Maestros',
};

/** Opción de un <select>. Vive aquí porque un .astro no exporta tipos. */
export interface Opcion {
  valor: string;
  texto: string;
  /** Agrupa opciones bajo un optgroup. */
  grupo?: string;
}

export interface UsuarioSesion {
  id: number;
  correo: string;
  nombre: string;
  rol: Rol;
}
