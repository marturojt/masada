/*
 * Cantidades en palabras para la interfaz: "1 hermano", "3 hermanos". Evita el
 * "hermano(s)", que se lee como sistema y no como persona.
 */
export const cuenta = (n: number, uno: string, varios: string): string =>
  `${n} ${n === 1 ? uno : varios}`;
