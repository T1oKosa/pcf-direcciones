/**
 * GoogleMapsLoader.ts
 * Singleton para la carga dinámica del script de Google Maps JS API.
 *
 * El estado del loader se persiste en window.__googleMapsLoaderState para
 * sobrevivir al ciclo de vida del control PCF: D365 puede destruir y recrear
 * el control al navegar entre registros sin descargar el script ya cargado.
 *
 * Múltiples llamadas concurrentes a load() retornan la misma Promise,
 * garantizando que el script se cargue solo una vez.
 */

/** Estado interno del loader, almacenado en window para persistencia */
interface GoogleMapsLoaderState {
  promise: Promise<void> | null;
  resolve: (() => void) | null;
  reject: ((error: Error) => void) | null;
  loaded: boolean;
  loading: boolean;
}

// Extender window con las propiedades del loader
declare global {
  interface Window {
    __googleMapsLoaderState: GoogleMapsLoaderState;
    __googleMapsCallback: () => void;
  }
}

export class GoogleMapsLoader {
  /** ID del script tag para evitar duplicados */
  private static readonly SCRIPT_ID = 'pcf-google-maps-script';

  /** Tiempo máximo de espera para la carga del script (ms) */
  private static readonly TIMEOUT_MS = 10000;

  /**
   * Obtiene o inicializa el estado del loader desde window.
   * Usar window como almacén garantiza que el singleton sobreviva
   * a múltiples instancias del control PCF en la misma página.
   */
  private static getState(): GoogleMapsLoaderState {
    if (!window.__googleMapsLoaderState) {
      window.__googleMapsLoaderState = {
        promise: null,
        resolve: null,
        reject: null,
        loaded: false,
        loading: false,
      };
    }
    return window.__googleMapsLoaderState;
  }

  /**
   * Carga el script de Google Maps JS API de forma asíncrona.
   *
   * - Si ya está cargado: retorna Promise.resolve() inmediatamente.
   * - Si está en proceso de carga: retorna la misma Promise en curso.
   * - Primera llamada: crea el script tag e inicia la carga.
   *
   * @param apiKey API Key de Google Cloud con Places API y Geocoding API habilitadas
   */
  static load(apiKey: string): Promise<void> {
    const state = GoogleMapsLoader.getState();

    // Ya cargado correctamente
    if (state.loaded) {
      return Promise.resolve();
    }

    // Carga en curso — retorna la misma promesa para no duplicar el script
    if (state.loading && state.promise) {
      return state.promise;
    }

    // Primera carga
    state.loading = true;
    state.promise = new Promise<void>((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });

    // Timeout de seguridad
    const timeoutId = window.setTimeout(() => {
      if (!state.loaded && state.reject) {
        state.loading = false;
        state.reject(
          new Error(
            `Timeout: Google Maps no respondió en ${GoogleMapsLoader.TIMEOUT_MS / 1000}s. ` +
            'Verifique la conectividad de red.'
          )
        );
      }
    }, GoogleMapsLoader.TIMEOUT_MS);

    // Callback global invocado por Google Maps al terminar la carga
    window.__googleMapsCallback = () => {
      window.clearTimeout(timeoutId);
      state.loaded = true;
      state.loading = false;
      if (state.resolve) state.resolve();
    };

    // Crear e inyectar el script tag
    const script = document.createElement('script');
    script.id = GoogleMapsLoader.SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = [
      'https://maps.googleapis.com/maps/api/js',
      `?key=${encodeURIComponent(apiKey)}`,
      '&libraries=places',
      '&loading=async',
      '&callback=__googleMapsCallback',
    ].join('');

    script.onerror = () => {
      window.clearTimeout(timeoutId);
      state.loading = false;
      if (state.reject) {
        state.reject(
          new Error(
            'Error al cargar el script de Google Maps. ' +
            'Verifique la API Key y que el dominio esté autorizado en Google Cloud Console.'
          )
        );
      }
    };

    document.head.appendChild(script);

    return state.promise;
  }

  /** Retorna true si Google Maps ya está disponible en window.google */
  static isLoaded(): boolean {
    return GoogleMapsLoader.getState().loaded;
  }
}
