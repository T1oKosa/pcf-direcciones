# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos principales

```bash
npm start          # Servidor de desarrollo con hot reload (pcf-scripts start watch)
npm run build      # Compilar y generar paquete de solución
npm run rebuild    # Limpiar y volver a compilar
npm run clean      # Eliminar artefactos de compilación
```

No hay comandos de lint ni tests configurados. TypeScript en modo estricto actúa como verificación de tipos en tiempo de compilación.

Para desplegar: el build genera `Solution/Solution.zip` que se importa en Power Apps Studio.

## Arquitectura

Control PCF (Power Apps Component Framework) para Dynamics 365 / Power Apps. Reemplaza un campo de texto estándar con un input de autocompletado de direcciones integrado con Google Places API.

### Flujo de datos

1. Usuario escribe → `manejarInput()` aplica debounce (300ms) → `GooglePlacesService.getSugerencias()`
2. Google retorna predicciones → `renderizarDropdown()` muestra lista
3. Usuario selecciona → `manejarSeleccion()` llama `getDetallesLugar(placeId)`
4. Detalles parseados → actualiza objeto `outputs` interno
5. `notifyOutputChanged()` → PCF llama `getOutputs()` → escribe 8 campos en Dataverse

### Componentes clave

- **`DireccionesControl/index.ts`** — Clase principal del control. Implementa el ciclo de vida PCF: `init()` → `updateView()` → `getOutputs()` → `destroy()`. Construye el DOM manualmente (sin framework UI), maneja eventos de teclado (↑↓ Enter Escape) y llama a los servicios.

- **`DireccionesControl/GoogleMapsLoader.ts`** — Singleton que inyecta el script de Google Maps API dinámicamente. Persiste estado en `window.__googleMapsLoaderState` para sobrevivir al ciclo de vida del control en D365. Timeout de 10s.

- **`DireccionesControl/GooglePlacesService.ts`** — Wrapper de tres APIs de Google: `AutocompleteService` (sugerencias), `PlacesService` (detalles), `Geocoder` (fallback). Incluye lógica de parsing específica para LatAm (Chile/Argentina), donde las comunas pueden estar en `locality` o `sublocality_level_1`.

- **`DireccionesControl/types.ts`** — Interfaces: `DireccionParseada` (8 campos), `SugerenciaLugar`, `EstadoCarga`, `EstadoControl` (estado centralizado del control).

- **`DireccionesControl/css/DireccionesControl.css`** — Estilos con design tokens de Fluent UI 2 para consistencia visual con D365.

### Propiedades del control (ControlManifest.Input.xml)

| Propiedad | Tipo | Rol |
|-----------|------|-----|
| `direccionCompleta` | bound | Campo principal de texto en D365 |
| `calle`, `numero`, `ciudad`, `region`, `pais` | bound | Componentes de dirección parseados |
| `latitud`, `longitud` | bound | Coordenadas como string |
| `googleApiKey` | input | API Key configurada en Power Apps Studio |

### Restricciones importantes

- La API Key debe tener habilitadas **Places API** y **Geocoding API**
- El control respeta `context.mode.isControlDisabled` para estados readonly/disabled
- No tiene dependencias npm externas más allá de las herramientas de desarrollo PCF
- El contenedor de atribución de Google es requerido por los ToS
