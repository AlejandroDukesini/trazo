const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

export function relativeDate(iso: string | number | Date): string {
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'ahora';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
  return dateFmt.format(d);
}

export const formatDate = (iso: string | number | Date) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string | number | Date) => dateTimeFmt.format(new Date(iso));
export const formatShortDate = (iso: string | number | Date) => shortFmt.format(new Date(iso));

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
