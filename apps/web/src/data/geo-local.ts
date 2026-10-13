export interface Place {
  name: string;
  label: string;
  lat: number;
  lng: number;
}

/**
 * Búsqueda de lugares (geocodificación) con el servicio público y gratuito de Photon (Komoot),
 * llamado directamente desde el navegador. No requiere clave ni servidor propio.
 */
export async function searchPlaces(query: string, center?: { lat: number; lng: number }): Promise<Place[]> {
  const url = new URL('https://photon.komoot.io/api');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'es');
  if (center) {
    url.searchParams.set('lat', String(center.lat));
    url.searchParams.set('lon', String(center.lng));
  }
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('No se pudo buscar el lugar.');
  const data = (await res.json()) as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> };
  return (data.features ?? []).map((f) => {
    const p = f.properties ?? {};
    const parts = [p.name, p.city ?? p.town ?? p.village, p.state, p.country].filter(Boolean);
    return { name: p.name ?? parts[0] ?? '', label: parts.join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
  });
}
