# Diseño: gestión local de actas con SQLite y Word

## Intención

Convertir el generador actual en una aplicación local de uso real para crear, consultar, modificar y eliminar actas de comité. Cada acta guardará sus datos editables en SQLite y el archivo `.docx` exacto producido al guardarla, para poder volver a abrirla y descargar ese mismo documento.

## Contexto actual

- La interfaz principal es React/Vite y ya crea un Word descargable en el navegador, pero no conserva las actas.
- Hay un servidor Flask y un generador de texto heredado en una pantalla HTML separada; no existe persistencia SQLite ni una API para React.
- Los campos de anexos Excel conservan únicamente el nombre del archivo en estado de navegador. La importación PowerPoint/OCR es otra función existente y debe seguir disponible.
- El proyecto ya incluye React, `docx`, Flask y pruebas Python; SQLite está disponible con la biblioteca estándar de Python.

## Objetivos

- Hacer que la interfaz React sea la única interfaz de la aplicación.
- Persistir actas, archivos Word y anexos seleccionados en una base SQLite local.
- Ofrecer crear, listar/consultar, editar, descargar el Word archivado y eliminar actas.
- Ejecutar la aplicación en una sola instancia local, sin servicios externos para las operaciones CRUD.
- Mostrar errores de carga/guardado/descarga en la interfaz, confirmar eliminaciones y evitar actas de ejemplo precargadas.
- Mantener la importación PowerPoint existente; usar el modelo OCR disponible localmente para evitar una descarga externa en su uso normal.

## No objetivos y límites

- No es una aplicación multiusuario ni una instalación para exponer en una red o Internet.
- No incluye autenticación, cifrado de datos en reposo, firma, aprobación de comité ni historial de versiones.
- No interpreta el contenido de los anexos Excel: los conserva y los asocia al acta.
- Una edición reemplaza el Word archivado anterior por el documento generado con los datos editados; no mantiene versiones históricas.

## Enfoques considerados

1. **Flask + React + SQLite (seleccionado):** conservar el backend Python y la interfaz React; Flask expone la API, sirve el build de Vite y usa `sqlite3`. Reutiliza el código y las dependencias presentes y ofrece una ejecución local integrada.
2. **Node.js + SQLite:** reemplazar Flask y rehacer el backend. Añade dependencias y trabajo sin una ventaja para este producto local.
3. **Aplicación de escritorio empaquetada:** aporta una instalación más integrada, pero agrega un runtime/paquete y complejidad que no son necesarios para operar localmente.

Se selecciona el primer enfoque para reducir cambios y mantener un flujo sencillo de ejecutar y respaldar.

## Comportamiento y persistencia

- El formulario existente crea un acta; al guardar, la interfaz genera el `.docx` con la librería `docx` ya instalada y envía datos, Word y anexos al backend.
- La pantalla presenta un listado de actas guardadas con cliente y fechas, permite seleccionar una para cargar sus datos, modificarla y descargar el Word archivado.
- Guardar una edición reemplaza los datos y el Word en una operación consistente. Cada sección admite un anexo: el anexo guardado se conserva si no se carga uno nuevo y solo se elimina mediante una acción explícita. Eliminar un acta elimina también sus anexos.
- El Word mantiene el formato existente e incorpora los nombres de los anexos asociados.
- Los campos de la interfaz, incluidos los valores del caso, se almacenan en una estructura JSON validada por el backend. La tabla de actas contiene identificador, nombre de archivo Word y fechas de creación/actualización. Los bytes del Word y de cada anexo se conservan en SQLite; los anexos guardan además nombre original, tipo y sección.
- La base queda en `instance/actas.sqlite3` (o en una ruta local configurada para pruebas/uso); sus datos no se agregan al repositorio.
- Los anexos siguen limitados a Excel `.xlsx`, `.xls` y `.xlsm`, con un límite de tamaño por archivo aplicado tanto en el servidor como en el cliente.

## API y ejecución local

- `GET /api/actas`: lista resumida de actas, ordenada por última modificación.
- `GET /api/actas/<id>`: datos del acta y metadatos de anexos.
- `POST /api/actas`: crea un acta y archiva sus binarios.
- `PUT /api/actas/<id>`: actualiza los datos y binarios de un acta existente.
- `GET /api/actas/<id>/word`: descarga los bytes del Word archivado.
- `GET /api/actas/<id>/attachments/<section>`: descarga el anexo guardado.
- `DELETE /api/actas/<id>`: elimina el acta y sus anexos.

Las rutas validan entrada, identificadores y tipos/tamaños de archivos, devuelven errores HTTP explícitos y usan transacciones SQLite con borrado en cascada. El servidor escucha en `127.0.0.1`, no en todas las interfaces. En producción local, Flask sirve los archivos generados por Vite y redirige rutas de interfaz a `index.html`; en desarrollo, Vite usa un proxy hacia la API Flask. La guía de uso indicará cómo instalar dependencias, construir el frontend y arrancar la app, y cómo respaldar/restaurar la base local.

## Restricciones de implementación

- Usar `sqlite3` de la biblioteca estándar, sin agregar un servicio de base de datos.
- No cambiar la generación de contenido Word más allá de integrarla con el guardado y la descarga de la copia archivada.
- Mantener las funciones actuales de importación de presentaciones y exportación Word.
- Las operaciones CRUD no dependen de Internet; el OCR debe utilizar el modelo español local ya presente.

## Validación

- Pruebas Flask con una base temporal: alta, listado, consulta, actualización, descarga de bytes Word, eliminación, cascada de anexos y validación de errores.
- Pruebas de la interfaz/utilidades para guardar y recuperar registros y manejar fallos del API.
- Ejecutar las pruebas existentes, lint y build del frontend.
- Verificar que la base se crea localmente, que Flask sirve el frontend compilado y que el flujo CRUD funciona sin conexión de red.

## Decisiones para quien implemente

- Elegir la forma concreta de transportar formularios y binarios entre React y Flask y los tipos MIME del Word.
- Definir detalles de validación de campos y el límite de tamaño para anexos, manteniendo un máximo razonable para uso local.
- Mantener transacciones y mensajes claros al usuario; no transformar errores de persistencia en éxitos aparentes.
