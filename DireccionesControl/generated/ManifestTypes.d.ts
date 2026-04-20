/*
*This is auto generated from the ControlManifest.Input.xml file
*/

// Define IInputs and IOutputs Type. They should match with ControlManifest.
export interface IInputs {
    direccionCompleta: ComponentFramework.PropertyTypes.StringProperty;
    calle: ComponentFramework.PropertyTypes.StringProperty;
    numero: ComponentFramework.PropertyTypes.StringProperty;
    ciudad: ComponentFramework.PropertyTypes.StringProperty;
    region: ComponentFramework.PropertyTypes.StringProperty;
    pais: ComponentFramework.PropertyTypes.StringProperty;
    latitud: ComponentFramework.PropertyTypes.StringProperty;
    longitud: ComponentFramework.PropertyTypes.StringProperty;
    googleApiKey: ComponentFramework.PropertyTypes.StringProperty;
}
export interface IOutputs {
    direccionCompleta?: string;
    calle?: string;
    numero?: string;
    ciudad?: string;
    region?: string;
    pais?: string;
    latitud?: string;
    longitud?: string;
}
