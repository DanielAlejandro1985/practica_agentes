# Plan de construcción por rondas de 5 minutos

## Objetivo

Construir una primera versión funcional de la app para generar actas de comités de crédito, con una estructura parametrizada según tipo de cliente y tipo de análisis. La validación de la acta sigue siendo manual por parte del comité.

## Regla de trabajo

- Cada ronda dura 5 minutos.
- Al final de cada ronda, se hace un checkpoint para revisar el avance.
- Si el checkpoint está bien, se sigue con la siguiente ronda.
- Si no, se corrige antes de continuar.

## Ronda 1: base del proyecto

- Crear estructura mínima del proyecto.
- Definir configuraciones básicas por tipo de cliente y análisis.
- Preparar prueba del generador de acta.
- Checkpoint: ¿la estructura inicial es útil para construir la funcionalidad real?

## Ronda 2: formulario de entrada

- Crear pantalla con selección de tipo de cliente y tipo de análisis.
- Añadir campos clave del caso crediticio.
- Conectar la entrada con la lógica del generador.
- Checkpoint: ¿se puede ingresar un caso real y ver una acta preliminar?

## Ronda 3: generación de acta

- Definir reglas por tipo de cliente.
- Generar secciones de acta según el tipo analizado.
- Incluir resumen ejecutivo, riesgos, recomendación y observaciones.
- Checkpoint: ¿la acta generada tiene sentido financiero y operativo?

## Ronda 4: revisión y ajuste

- Permitir edición manual del texto generado.
- Ajustar formato, orden y validaciones.
- Mejorar legibilidad y exportación.
- Checkpoint: ¿el documento final es útil para el comité?

## Ronda 5: polish y cierre

- Mejorar estilo visual.
- Revisar flujo general.
- Preparar documentación mínima de uso.
- Checkpoint final: ¿está lista para un siguiente ciclo de refinamiento?

## Criterio de aprobación por ronda

Se sigue solo si la versión actual:
- funciona,
- es comprensible,
- tiene valor para el usuario,
- y se puede demostrar en una vista rápida.

## Línea de producto para esta primera fase

La app genera una acta base, parametrizada por tipo de cliente y tipo de análisis, y deja la validación final en manos del comité.
