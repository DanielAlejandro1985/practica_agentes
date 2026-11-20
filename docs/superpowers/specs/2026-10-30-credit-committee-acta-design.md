# Diseño: Generador de actas de comités de crédito

## 1. Intento y por qué

El objetivo es reducir el trabajo operativo de preparación de actas de comités de crédito. Hoy el proceso suele ser manual, repetitivo y dependiente del criterio del analista o secretario para estructurar el documento. Esta aplicación no reemplaza la aprobación del comité; su función es generar una acta consistente, completa y parametrizada por tipo de cliente y tipo de análisis para que los miembros del comité revisen y validen más rápido.

## 2. Usuarios

- Analista de crédito
- Secretario de comité
- Miembros del comité
- Administrador de configuración del sistema

## 3. Objetivos

- Reducir el tiempo de preparación de actas en aproximadamente 4 horas por caso.
- Generar una estructura estándar de acta según el tipo de cliente.
- Personalizar el contenido con base en el tipo de análisis y nivel de riesgo.
- Evitar omisiones y errores repetitivos en la documentación.
- Entregar un documento lista para revisión por parte del comité.

## 4. No objetivos

- Decidir la aprobación del comité.
- Sustituir el juicio de los miembros del comité.
- Gestionar la firma legal o la trazabilidad documental avanzada de la entidad como un sistema completo de firmas.
- Generar un texto completamente autónomo sin revisión humana.

## 5. Antiobjetivos

- Crear actas demasiado genéricas que oculten información crítica.
- Hacer que el sistema imponga decisiones sin control humano.
- Construir una arquitectura compleja que no soporte el flujo real del comité.
- Depender de prompts libres e inconsistentes para construir el documento final.

## 6. Restricciones

- Debe ser configurable por tipo de cliente y tipo de comité.
- Debe permitir revisión final por los participantes del comité.
- Debe producir un documento legible y exportable.
- Debe ser usable sin requerir un flujo de aprobación automatizado.
- Debe funcionar con datos estructurados del cliente y del caso crediticio.

## 7. Contexto del problema

El comité de crédito requiere un acta clara y comparable entre casos. Sin embargo, cada caso puede ser estructurado de forma distinta dependiendo del cliente, del tipo de negocio y del tipo de recomendación. La preparación manual obliga a repetir secciones e introducir información que ya existe en otros sistemas o documentos. La solución debe eliminar esa repetición y mantener la definición del documento bajo reglas claras.

## 8. Enfoques considerados

### Opción A: Generador basado en plantillas fijas

- Descripción: una plantilla base con secciones estándar, sin mucha lógica de adaptación.
- Ventajas: rápida implementación, fácil de mantener, baja complejidad.
- Trade-offs: poca flexibilidad para clientes distintos; se pierde valor en comités más complejos.

### Opción B: Generador con reglas por tipo de cliente y tipo de análisis (seleccionada)

- Descripción: el sistema adapta la estructura, el nivel de detalle y los apartados del acta según el tipo de cliente y el tipo de caso analizado.
- Ventajas: máxima utilidad para distintos perfiles de cliente, mejor consistencia y menor trabajo manual.
- Trade-offs: requiere diseño más robusto de configuración y validación de datos.

### Opción C: Generador con revisión y control de versiones

- Descripción: además de generar el documento, permite compare versiones, comentarios y estados de revisión.
- Ventajas: mejor trazabilidad y mejor control editorial.
- Trade-offs: aumenta complejidad de UX y de persistencia.

## 9. Enfoque elegido

Se selecciona la Opción B como base de producto. Esta opción ofrece el mejor equilibrio entre utilidad operativa y complejidad. La app no intentará reemplazar la deliberación del comité, sino armar la acta con la estructura correcta según la naturaleza del cliente y el caso analizado.

La Opción C se puede incorporar más adelante como extensión si el negocio lo requiere. La Opción A se considera una versión mínima, pero no la decisión final para este producto.

## 10. Alcance funcional propuesto

### 10.1 Configuración

- Definición de tipos de cliente.
- Definición de tipos de análisis o comité.
- Asociación de cada tipo con la estructura del acta.
- Plantillas reutilizables por sección.
- Campos obligatorios por tipo.

### 10.2 Generación del acta

- Carga de datos del cliente.
- Carga de información del caso de crédito.
- Selección de tipo de cliente y tipo de análisis.
- Generación automática de acta con estructura apropiada.
- Completar secciones con: resumen ejecutivo, riesgos, observaciones, condiciones, recomendación.

### 10.3 Revisión

- Vista previa del documento final.
- Edición manual de contenido generado.
- Posibilidad de dejar comentarios o ajustes antes de la validación final.
- Estado del documento: borrador, revisión, final.

### 10.4 Exportación

- Exportar a PDF o documento editable.
- Copiar al formato usual del comité interno.

## 11. Modelo de datos sugerido

### Cliente

- id
- nombre
- tipoCliente
- sector
- tamaño
- riesgo general
- datos básicos del caso

### Caso de crédito

- id
- clienteId
- tipoAnalisis
- monto
- plazo
- garantía
- condiciones principales
- observaciones
- recomendación inicial

### Acta

- id
- casoId
- version
- estado
- tipoCliente
- tipoAnalisis
- contenidoHtml o contenidoMarkdown
- fechaCreacion
- fechaActualizacion

### ConfiguracionActa

- id
- tipoCliente
- tipoAnalisis
- secciones
- camposObligatorios
- reglasDeFormato

## 12. Flujo de usuario

1. El usuario crea o selecciona un caso de crédito.
2. Define el tipo de cliente y el tipo de análisis o comité.
3. La app carga la estructura configurada para ese tipo.
4. El sistema completa la acta con datos del caso y secciones predefinidas.
5. El usuario revisa y ajusta el documento.
6. El documento queda listo para su validación por los miembros del comité.

## 13. Requisitos no funcionales

- Seguridad básica de acceso para usuarios autorizados.
- Rendimiento suficiente para generar un documento en segundos.
- Consistencia de formatos entre actas.
- Fácil mantenimiento de configuraciones por tipo.
- Trazabilidad mínima de versiones.

## 14. Decisiones que quedan para el desarrollador

- Framework de frontend y backend.
- Base de datos a usar.
- Motor de plantillas o generación de documentos.
- Estrategia para almacenamiento de actas y configuración.
- Mecanismo de exportación a PDF.

## 15. Decisión final

Se construirá una aplicación para generar actas de comités de crédito, parametrizada por tipo de cliente y tipo de análisis, con la capacidad de producir un documento estructurado, consistente y listo para validación por los miembros del comité. La aprobación humana queda fuera del alcance automatizado del sistema.
