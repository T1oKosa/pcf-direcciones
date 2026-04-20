/**
 * types.ts
 * Interfaces y tipos compartidos entre los módulos del control PCF.
 */

/**
 * Resultado parseado de una dirección obtenida desde Google Places.
 * Todos los campos de texto son strings vacíos si no están disponibles.
 * Latitud y longitud se almacenan como string para compatibilidad con
 * campos de texto de Dataverse (e.g., "-33.448890").
 */
export interface DireccionParseada {
  direccionCompleta: string;
  calle: string;
  numero: string;
  ciudad: string;
  region: string;
  pais: string;
  latitud: string;
  longitud: string;
}

/**
 * Sugerencia de lugar retornada por AutocompleteService.
 */
export interface SugerenciaLugar {
  placeId: string;
  /** Descripción completa, e.g. "Av. Providencia 1234, Providencia, Chile" */
  descripcion: string;
  /** Parte principal, e.g. "Av. Providencia 1234" */
  textoPrincipal: string;
  /** Parte secundaria, e.g. "Providencia, Santiago, Chile" */
  textoSecundario: string;
}

/**
 * Estado de carga de la API de Google Maps.
 * - idle: antes de que init() sea llamado
 * - loading-api: esperando que cargue el script de Google Maps
 * - ready: API cargada, control operativo
 * - error-api: falló la carga del script o la API Key es inválida
 */
export type EstadoCarga = 'idle' | 'loading-api' | 'ready' | 'error-api';

/**
 * Estado interno completo del control PCF.
 */
export interface EstadoControl {
  carga: EstadoCarga;
  /** Texto actual visible en el input */
  valorInput: string;
  /** Sugerencias actuales del dropdown */
  sugerencias: SugerenciaLugar[];
  /** Última dirección seleccionada por el usuario */
  seleccion: DireccionParseada | null;
  /** Si el dropdown de sugerencias está visible */
  dropdownVisible: boolean;
  /** Índice del item actualmente marcado por teclado (-1 = ninguno) */
  indiceMarcado: number;
  /** Mensaje de error actual, null si no hay error */
  mensajeError: string | null;
}
