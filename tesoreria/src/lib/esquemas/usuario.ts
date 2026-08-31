/* Validación del ABC de usuarios de la plataforma. */
import { z } from 'zod';
import { MINIMO_CONTRASENA } from '../auth';
import { correo, opcionDe, texto } from './comunes';

const rolDeUsuario = opcionDe(
  ['tesorero', 'venerable_maestro', 'super_admin'],
  'Elige el rol.',
);

const contrasenaNueva = z
  .string({ error: 'La contraseña es obligatoria.' })
  .min(
    MINIMO_CONTRASENA,
    `La contraseña debe tener al menos ${MINIMO_CONTRASENA} caracteres. Una frase con espacios sirve y se recuerda mejor.`,
  )
  .max(200, 'La contraseña es demasiado larga.');

export const esquemaUsuarioNuevo = z
  .object({
    correo,
    nombre: texto('El nombre', 120),
    rol: rolDeUsuario,
    contrasena: contrasenaNueva,
    confirmacion: z.string({ error: 'Confirma la contraseña.' }),
  })
  .refine((d) => d.contrasena === d.confirmacion, {
    path: ['confirmacion'],
    message: 'La confirmación no coincide con la contraseña.',
  });

export const esquemaUsuarioEditar = z.object({
  nombre: texto('El nombre', 120),
  rol: rolDeUsuario,
});

export const esquemaContrasenaDeOtro = z
  .object({
    contrasena: contrasenaNueva,
    confirmacion: z.string({ error: 'Confirma la contraseña.' }),
  })
  .refine((d) => d.contrasena === d.confirmacion, {
    path: ['confirmacion'],
    message: 'La confirmación no coincide con la contraseña.',
  });
