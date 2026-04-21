/**
 * index.ts
 * Control principal PCF — DireccionesControl
 *
 * Field control que reemplaza un campo de texto de dirección en Dynamics 365.
 * Integra Google Places Autocomplete para sugerencias de dirección en tiempo real
 * y descompone la dirección seleccionada en sus campos individuales.
 *
 * Ciclo de vida PCF:
 *   init()           → construye DOM, inicia carga de Google Maps API
 *   updateView()     → sincroniza valor externo y estado disabled/readonly
 *   getOutputs()     → retorna todos los campos de dirección al framework
 *   destroy()        → limpia timers y event listeners
 */

import { IInputs, IOutputs } from './generated/ManifestTypes';
import { GooglePlacesService } from './GooglePlacesService';
import { DireccionParseada, EstadoControl, SugerenciaLugar } from './types';

export class DireccionesControl
  implements ComponentFramework.StandardControl<IInputs, IOutputs> {

  // ─── Estado interno ────────────────────────────────────────────────────────

  private estado!: EstadoControl;
  /** Acumulador de valores de salida; se actualiza al seleccionar una dirección */
  private outputs: Partial<DireccionParseada> = {};

  // ─── Referencias PCF ───────────────────────────────────────────────────────

  private notifyOutputChangedFn!: () => void;

  // ─── Referencias DOM ───────────────────────────────────────────────────────

  private container!: HTMLDivElement;
  private wrapperEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private loaderEl!: HTMLSpanElement;
  private dropdownEl!: HTMLUListElement;
  private errorEl!: HTMLSpanElement;
  /** Requerido por ToS de Google Maps para PlacesService */
  private attributionEl!: HTMLDivElement;

  // ─── Servicios ─────────────────────────────────────────────────────────────

  private placesService: GooglePlacesService | null = null;

  // ─── Debounce ──────────────────────────────────────────────────────────────

  private debounceTimer: number = 0;
  private readonly DEBOUNCE_MS = 300;

  // ─── Event handlers (referencias guardadas para poder hacer removeEventListener) ───

  private readonly handlerInput: (e: Event) => void;
  private readonly handlerKeydown: (e: KeyboardEvent) => void;
  private readonly handlerBlur: (e: FocusEvent) => void;

  constructor() {
    // Enlazar métodos en el constructor para mantener una referencia estable
    // que se pueda usar tanto en addEventListener como en removeEventListener
    this.handlerInput = this.manejarInput.bind(this);
    this.handlerKeydown = this.manejarKeydown.bind(this);
    this.handlerBlur = this.manejarBlur.bind(this);
  }

  // ─── Ciclo de vida PCF ─────────────────────────────────────────────────────

  /**
   * Inicializa el control.
   * Construye el DOM, lee parámetros del contexto y carga la API de Google Maps.
   */
  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement,
  ): void {
    this.notifyOutputChangedFn = notifyOutputChanged;
    this.container = container;

    this.estado = {
      carga: 'idle',
      valorInput: (context.parameters.direccionCompleta.raw as string) ?? '',
      sugerencias: [],
      seleccion: null,
      dropdownVisible: false,
      indiceMarcado: -1,
      mensajeError: null,
    };

    this.construirDOM();

    const apiKey = (context.parameters.googleApiKey.raw as string) ?? '';

    if (!apiKey) {
      this.mostrarError(
        'Configure la propiedad "Google Maps API Key" en las propiedades del control.'
      );
      return;
    }

    this.placesService = new GooglePlacesService(apiKey);
    this.estado.carga = 'ready';
    this.inputEl.disabled = context.mode.isControlDisabled;
  }

  /**
   * Llamado por el framework cuando cambia el contexto (valor externo, modo disabled, etc).
   * Sincroniza el estado interno sin pisar cambios que el usuario esté haciendo.
   */
  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const valorExterno = (context.parameters.direccionCompleta.raw as string) ?? '';

    // Solo sincronizar si el valor externo cambió y el usuario no está interactuando
    if (valorExterno !== this.estado.valorInput && !this.estado.dropdownVisible) {
      this.estado.valorInput = valorExterno;
      this.inputEl.value = valorExterno;
    }

    // Respetar el modo disabled/readonly del formulario de D365
    if (this.estado.carga === 'ready') {
      this.inputEl.disabled = context.mode.isControlDisabled;
    }
  }

  /**
   * Retorna los valores actuales de todas las propiedades bound del control.
   * El framework PCF llama este método inmediatamente después de notifyOutputChanged().
   */
  public getOutputs(): IOutputs {
    return {
      direccionCompleta: this.estado.valorInput,
      calle: this.outputs.calle ?? '',
      numero: this.outputs.numero ?? '',
      ciudad: this.outputs.ciudad ?? '',
      region: this.outputs.region ?? '',
      pais: this.outputs.pais ?? '',
      latitud: this.outputs.latitud ?? '',
      longitud: this.outputs.longitud ?? '',
    };
  }

  /**
   * Limpia recursos al destruir el control.
   * No resetea GoogleMapsLoader — el script de Google Maps debe persistir
   * en caso de que haya otros controles del mismo tipo en la página.
   */
  public destroy(): void {
    window.clearTimeout(this.debounceTimer);

    if (this.inputEl) {
      this.inputEl.removeEventListener('input', this.handlerInput);
      this.inputEl.removeEventListener('keydown', this.handlerKeydown);
      this.inputEl.removeEventListener('blur', this.handlerBlur);
    }

    this.placesService = null;
    if (this.dropdownEl?.parentNode) {
      this.dropdownEl.parentNode.removeChild(this.dropdownEl);
    }
  }

  // ─── Construcción del DOM ──────────────────────────────────────────────────

  /**
   * Construye la estructura completa de elementos HTML del control.
   * La estructura sigue el patrón Fluent UI TextField + Listbox.
   */
  private construirDOM(): void {
    this.container.innerHTML = '';
    this.container.className = 'pcf-dir-root';

    this.wrapperEl = document.createElement('div');
    this.wrapperEl.className = 'pcf-dir-wrapper';

    // ── Input wrapper (input + spinner) ──
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'pcf-dir-input-wrapper';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'pcf-dir-input';
    this.inputEl.value = this.estado.valorInput;
    this.inputEl.disabled = true;
    this.inputEl.setAttribute('autocomplete', 'off');
    this.inputEl.setAttribute('spellcheck', 'false');
    this.inputEl.setAttribute('role', 'combobox');
    this.inputEl.setAttribute('aria-expanded', 'false');
    this.inputEl.setAttribute('aria-haspopup', 'listbox');
    this.inputEl.setAttribute('aria-autocomplete', 'list');
    this.inputEl.setAttribute('aria-label', 'Buscar dirección');

    // Spinner de carga visible mientras Google Maps API carga
    this.loaderEl = document.createElement('span');
    this.loaderEl.className = 'pcf-dir-loader';
    this.loaderEl.setAttribute('aria-hidden', 'true');
    this.loaderEl.style.display = 'none';

    inputWrapper.appendChild(this.inputEl);
    inputWrapper.appendChild(this.loaderEl);

    // ── Dropdown de sugerencias ──
    this.dropdownEl = document.createElement('ul');
    this.dropdownEl.className = 'pcf-dir-dropdown';
    this.dropdownEl.setAttribute('role', 'listbox');
    this.dropdownEl.setAttribute('aria-label', 'Sugerencias de dirección');
    this.dropdownEl.style.display = 'none';

    // ── Mensaje de error ──
    this.errorEl = document.createElement('span');
    this.errorEl.className = 'pcf-dir-error';
    this.errorEl.setAttribute('role', 'alert');
    this.errorEl.setAttribute('aria-live', 'polite');

    // ── Attribution (obligatorio por ToS de Google Maps) ──
    this.attributionEl = document.createElement('div');
    this.attributionEl.className = 'pcf-dir-attribution';

    // ── Registrar event listeners ──
    this.inputEl.addEventListener('input', this.handlerInput);
    this.inputEl.addEventListener('keydown', this.handlerKeydown);
    this.inputEl.addEventListener('blur', this.handlerBlur);

    // ── Ensamblar DOM ──
    this.wrapperEl.appendChild(inputWrapper);
    this.wrapperEl.appendChild(this.errorEl);
    this.wrapperEl.appendChild(this.attributionEl);
    this.container.appendChild(this.wrapperEl);
    // El dropdown va en body para escapar overflow:hidden de D365
    document.body.appendChild(this.dropdownEl);
  }

  // ─── Renderizado del dropdown ──────────────────────────────────────────────

  /**
   * Renderiza las sugerencias en el dropdown.
   * Si el array está vacío, muestra un mensaje de "sin resultados".
   */
  private renderizarDropdown(sugerencias: SugerenciaLugar[]): void {
    this.dropdownEl.innerHTML = '';
    this.estado.indiceMarcado = -1;

    if (sugerencias.length === 0) {
      const item = document.createElement('li');
      item.className = 'pcf-dir-dropdown-empty';
      item.textContent = 'Sin resultados para esta búsqueda';
      this.dropdownEl.appendChild(item);
    } else {
      sugerencias.forEach((sug, idx) => {
        const item = document.createElement('li');
        item.className = 'pcf-dir-dropdown-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.dataset.index = idx.toString();

        const principal = document.createElement('span');
        principal.className = 'pcf-dir-item-principal';
        principal.textContent = sug.textoPrincipal;

        const secundario = document.createElement('span');
        secundario.className = 'pcf-dir-item-secundario';
        secundario.textContent = sug.textoSecundario;

        item.appendChild(principal);
        item.appendChild(secundario);

        // mousedown en lugar de click para ejecutarse ANTES del blur del input
        item.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault(); // Evita que el input pierda el foco antes de la selección
          void this.manejarSeleccion(sug);
        });

        this.dropdownEl.appendChild(item);
      });
    }

    const rect = this.inputEl.getBoundingClientRect();
    this.dropdownEl.style.top = `${rect.bottom + 2}px`;
    this.dropdownEl.style.left = `${rect.left}px`;
    this.dropdownEl.style.width = `${rect.width}px`;
    this.dropdownEl.style.display = 'block';
    this.inputEl.setAttribute('aria-expanded', 'true');
    this.estado.dropdownVisible = true;
    this.estado.sugerencias = sugerencias;
  }

  /** Cierra el dropdown y resetea su estado */
  private cerrarDropdown(): void {
    this.dropdownEl.style.display = 'none';
    this.dropdownEl.innerHTML = '';
    this.inputEl.setAttribute('aria-expanded', 'false');
    this.estado.dropdownVisible = false;
    this.estado.indiceMarcado = -1;
    this.estado.sugerencias = [];
  }

  /** Actualiza el item visualmente marcado al navegar con teclado */
  private actualizarItemMarcado(): void {
    const items = this.dropdownEl.querySelectorAll<HTMLLIElement>('.pcf-dir-dropdown-item');

    items.forEach((item, idx) => {
      const esMarcado = idx === this.estado.indiceMarcado;
      item.classList.toggle('pcf-dir-dropdown-item--marcado', esMarcado);
      item.setAttribute('aria-selected', esMarcado ? 'true' : 'false');

      if (esMarcado) {
        // Asegurar que el item sea visible dentro del scroll del dropdown
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  // ─── Manejo de errores ─────────────────────────────────────────────────────

  private mostrarError(mensaje: string): void {
    this.estado.mensajeError = mensaje;
    this.errorEl.textContent = mensaje;
    this.errorEl.style.display = 'block';
    this.inputEl.disabled = true;
    this.inputEl.placeholder = 'No disponible';
    this.inputEl.classList.add('pcf-dir-input--error');
  }

  private limpiarError(): void {
    this.estado.mensajeError = null;
    this.errorEl.textContent = '';
    this.errorEl.style.display = 'none';
    this.inputEl.classList.remove('pcf-dir-input--error');
  }

  // ─── Event handlers ────────────────────────────────────────────────────────

  /**
   * Maneja la entrada de texto del usuario.
   * Aplica debounce antes de llamar a la API de Google para evitar
   * llamadas en cada keystroke.
   */
  private manejarInput(e: Event): void {
    const texto = (e.target as HTMLInputElement).value;
    this.estado.valorInput = texto;

    window.clearTimeout(this.debounceTimer);

    // Si el campo queda vacío: limpiar outputs y notificar
    if (!texto.trim()) {
      this.outputs = {};
      this.estado.seleccion = null;
      this.cerrarDropdown();
      this.notifyOutputChangedFn();
      return;
    }

    // Textos cortos: cerrar dropdown sin llamar a la API
    if (texto.trim().length < 3) {
      this.cerrarDropdown();
      return;
    }

    // Debounce: esperar que el usuario deje de escribir
    this.debounceTimer = window.setTimeout(async () => {
      if (!this.placesService) return;

      try {
        const sugerencias = await this.placesService.getSugerencias(texto);
        console.log('[DireccionesControl] sugerencias:', sugerencias);
        this.renderizarDropdown(sugerencias);
      } catch (err) {
        console.error('[DireccionesControl] Error getSugerencias:', err);
        this.cerrarDropdown();
      }
    }, this.DEBOUNCE_MS);
  }

  /**
   * Maneja la navegación por teclado en el dropdown.
   * ArrowDown/Up: navegar entre ítems.
   * Enter: seleccionar ítem marcado.
   * Escape: cerrar dropdown.
   */
  private manejarKeydown(e: KeyboardEvent): void {
    if (!this.estado.dropdownVisible) return;

    const total = this.estado.sugerencias.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.estado.indiceMarcado = Math.min(this.estado.indiceMarcado + 1, total - 1);
        this.actualizarItemMarcado();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.estado.indiceMarcado = Math.max(this.estado.indiceMarcado - 1, -1);
        this.actualizarItemMarcado();
        break;

      case 'Enter':
        e.preventDefault();
        if (this.estado.indiceMarcado >= 0 && this.estado.indiceMarcado < total) {
          void this.manejarSeleccion(this.estado.sugerencias[this.estado.indiceMarcado]);
        }
        break;

      case 'Escape':
        this.cerrarDropdown();
        break;

      // Tab: cerrar dropdown y dejar que el foco se mueva normalmente
      case 'Tab':
        this.cerrarDropdown();
        break;
    }
  }

  /**
   * Al perder el foco, cerrar el dropdown con un delay.
   * El delay es necesario para que el mousedown en los ítems del dropdown
   * se ejecute primero (150ms > mousedown → click chain).
   */
  private manejarBlur(_e: FocusEvent): void {
    window.setTimeout(() => {
      this.cerrarDropdown();
    }, 150);
  }

  // ─── Selección de dirección ────────────────────────────────────────────────

  /**
   * Maneja la selección de una sugerencia por click o teclado.
   *
   * Flujo:
   * 1. Cierra el dropdown y muestra el texto de la sugerencia inmediatamente (UX responsivo)
   * 2. Obtiene los detalles completos con PlaceDetails
   * 3. Fallback: si PlaceDetails falla, usa Geocoder
   * 4. Actualiza outputs y notifica al framework PCF
   */
  private async manejarSeleccion(sugerencia: SugerenciaLugar): Promise<void> {
    if (!this.placesService) return;

    // Respuesta inmediata al usuario: cerrar dropdown y mostrar la descripción
    this.cerrarDropdown();
    this.inputEl.value = sugerencia.descripcion;
    this.estado.valorInput = sugerencia.descripcion;

    try {
      const detalles = await this.placesService.getDetallesLugar(sugerencia.placeId);
      this.aplicarDetalles(detalles);
    } catch (_errPlaces) {
      // Fallback: intentar obtener detalles via Geocoder
      try {
        const detallesFallback = await this.placesService.geocodificar(sugerencia.descripcion);
        this.aplicarDetalles(detallesFallback);
      } catch (_errGeocode) {
        // Sin detalles de desglose disponibles.
        // Guardar al menos la dirección completa en el campo principal.
        this.outputs = {};
        this.notifyOutputChangedFn();
      }
    }
  }

  /**
   * Aplica los detalles de una dirección al estado interno y notifica al framework.
   * Este es el punto donde los campos secundarios (calle, número, ciudad, etc.)
   * se actualizan en Dynamics 365.
   */
  private aplicarDetalles(detalles: DireccionParseada): void {
    this.estado.seleccion = detalles;
    this.estado.valorInput = detalles.direccionCompleta;
    this.inputEl.value = detalles.direccionCompleta;
    this.outputs = { ...detalles };

    const partes = [
      [detalles.calle, detalles.numero].filter(Boolean).join(' '),
      detalles.ciudad,
      detalles.region,
    ].filter(Boolean);
    const textoFormateado = partes.join(', ');
    this.inputEl.value = textoFormateado || detalles.direccionCompleta;
    this.estado.valorInput = this.inputEl.value;

    if (detalles.ciudad) {
      sessionStorage.setItem('CityAutoAddress', detalles.ciudad);
    }

    this.notifyOutputChangedFn();
  }
}
