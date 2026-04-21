import { DireccionParseada, SugerenciaLugar } from './types';

export class GooglePlacesService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ─── Sugerencias (Places API New — REST) ─────────────────────────────────

  async getSugerencias(texto: string): Promise<SugerenciaLugar[]> {
    if (texto.trim().length < 3) return [];

    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
      },
      body: JSON.stringify({ input: texto, languageCode: 'es', includedRegionCodes: ['CL'] }),
    });

    if (!res.ok) {
      throw new Error(`Places Autocomplete HTTP ${res.status}`);
    }

    const data = await res.json();
    const suggestions: unknown[] = data.suggestions ?? [];

    return suggestions
      .filter((s: unknown) => (s as { placePrediction?: unknown }).placePrediction != null)
      .map((s: unknown) => {
        const p = (s as { placePrediction: { placeId: string; text: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }).placePrediction;
        return {
          placeId: p.placeId,
          descripcion: p.text.text,
          textoPrincipal: p.structuredFormat?.mainText?.text ?? p.text.text,
          textoSecundario: p.structuredFormat?.secondaryText?.text ?? '',
        };
      });
  }

  // ─── Detalles del lugar (Places API New — REST) ───────────────────────────

  async getDetallesLugar(placeId: string): Promise<DireccionParseada> {
    const fields = 'addressComponents,formattedAddress,location';
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=${fields}`,
      { headers: { 'X-Goog-Api-Key': this.apiKey } }
    );

    if (!res.ok) {
      throw new Error(`Place Details HTTP ${res.status}`);
    }

    const place = await res.json();
    return GooglePlacesService.parsearComponentes(
      place.addressComponents ?? [],
      place.formattedAddress ?? '',
      place.location?.latitude ?? 0,
      place.location?.longitude ?? 0,
    );
  }

  // ─── Geocoder (fallback — REST) ───────────────────────────────────────────

  async geocodificar(direccion: string): Promise<DireccionParseada> {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(direccion)}&key=${encodeURIComponent(this.apiKey)}`
    );

    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);

    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.[0]) {
      throw new Error(`Geocoder: ${data.status}`);
    }

    const r = data.results[0];
    return GooglePlacesService.parsearComponentes(
      r.address_components.map((c: { long_name: string; short_name: string; types: string[] }) => ({
        longText: c.long_name,
        shortText: c.short_name,
        types: c.types,
      })),
      r.formatted_address,
      r.geometry.location.lat,
      r.geometry.location.lng,
    );
  }

  // ─── Parser ───────────────────────────────────────────────────────────────

  private static parsearComponentes(
    components: { longText?: string; long_name?: string; types: string[] }[],
    formattedAddress: string,
    lat: number,
    lng: number,
  ): DireccionParseada {
    const get = (tipo: string): string =>
      components.find(c => c.types.indexOf(tipo) >= 0)?.longText ??
      components.find(c => c.types.indexOf(tipo) >= 0)?.long_name ?? '';

    return {
      direccionCompleta: formattedAddress,
      calle: get('route'),
      numero: get('street_number'),
      ciudad: get('locality') || get('sublocality_level_1') || get('sublocality'),
      region: get('administrative_area_level_1'),
      pais: get('country'),
      latitud: lat.toFixed(6),
      longitud: lng.toFixed(6),
    };
  }
}
