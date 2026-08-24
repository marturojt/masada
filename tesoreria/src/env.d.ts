/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    /** Identificador corto de la petición, para correlacionar bitácora y logs. */
    idPeticion: string;
    /** Sesión resuelta por el middleware. null si no hay sesión válida. */
    sesion: import('./lib/sesion').Sesion | null;
  }
}
