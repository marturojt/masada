const dateFmt = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
});

const shortDateFmt = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatLongDate(date: Date): string {
  return dateFmt.format(date);
}

export function formatShortDate(date: Date): string {
  return shortDateFmt.format(date);
}

export function formatTime(date: Date): string {
  return timeFmt.format(date);
}

export function formatEventDate(start: Date, end?: Date): string {
  const day = formatLongDate(start);
  const startTime = formatTime(start);
  if (!end) return `${day} · ${startTime}`;
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) return `${day} · ${startTime} – ${formatTime(end)}`;
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

export function isUpcoming(date: Date): boolean {
  return date.getTime() >= Date.now() - 1000 * 60 * 60 * 6;
}

/** Convierte una etiqueta en un slug apto para URL (sin acentos ni símbolos). */
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
