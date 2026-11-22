# Handoff – Proyecto practica_agentes

## Propósito
Aplicación local para apoyar la elaboración, gestión y generación de actas de comité de crédito. Permite capturar o importar información del caso, completar los campos del acta, generar un documento Word con estructura narrativa y conservar registros en una base SQLite local para su consulta, edición, descarga y eliminación.

El alcance implementado en el código actual se orienta a la preparación y documentación del acta (asistente de redacción y archivo local), no a la aprobación automática del comité ni a un flujo multiusuario productivo.

## Recorrido de construcción
El recorrido se reconstruye a partir del historial de Git disponible (`git log`) y del estado actual del repositorio:

1. **Inicialización (`8df48ab`, 2026-10-30, “Initial commit”)**  
   - Alta inicial del repositorio con `README.md`.

2. **Entrega base de la práctica (`a0f17a9`, 2026-11-20, “Entrega práctica”)**  
   - Incorporación masiva de la primera versión funcional/documentada del proyecto: backend Flask (`app.py`), frontend React/Vite (`frontend/`), plantillas y recursos (`templates/`, `moodboard-pichincha.*`), pruebas (`tests/`), dependencias (`requirements.txt`, `frontend/package*.json`), documentación de diseño/planes (`docs/superpowers/...`) y artefactos de apoyo (`skills-lock.json`, `.agents/skills/...`).  
   - En esta etapa se establecen los cimientos de generación de acta, interfaz web, importación/exportación y validaciones iniciales según el código y las especificaciones incluidas.

3. **Mejora de exhaustividad y exportación (`78ba7f5`, 2026-11-21, “Mejorar generación exhaustiva del acta y exportación Word”)**  
   - Cambios en `app.py`, `frontend/src/App.jsx`, `frontend/src/actaRichContent.js`, `frontend/src/excelData.js` y `tests/test_acta_generator.py`.  
   - Evidencia de evolución hacia una generación narrativa más completa y enriquecimiento del documento Word, con soporte de datos cuantitativos/Excel en frontend.

4. **Refinamiento de conclusión, validaciones y Word (`6bd158d`, 2026-11-21, “Refinar acta: conclusión, validaciones y exportación Word”)**  
   - Ajustes en `app.py`, `frontend/src/App.jsx` y `frontend/src/actaRichContent.js` orientados a la calidad del contenido generado, validaciones y salida documental.

5. **Refuerzo de rigor del acta (`131904c`, 2026-11-21, “Reforzar rigor y exhaustividad del acta crediticia”)**  
   - Nuevas modificaciones en backend y frontend (`app.py`, `frontend/src/App.jsx`, `frontend/src/actaRichContent.js`) para fortalecer la lógica y presentación del análisis crediticio.

6. **Estado más reciente registrado (`3cd6bf6`, 2026-11-22, “Guardar cambios de la aplicación”)**  
   - Cambios adicionales en `app.py`, `frontend/src/App.jsx`, `frontend/src/actaRichContent.js` y `tests/test_acta_generator.py`.  
   - Representa la versión base analizada en este handoff.

> Nota: no se dispone de evidencia adicional verificable (issues, PRs o bitácora externa) más allá del código, la documentación del repositorio y el historial de commits indicado.

## Arquitectura
### Visión general
Arquitectura web local de dos capas principales:
- **Frontend (SPA React/Vite)**: interfaz de usuario para captura, importación, revisión, generación de Word en cliente, consumo de API y descarga de artefactos.
- **Backend (Flask + Waitress)**: expone API REST para persistencia de actas/anexos/Word archivado, sirve el frontend compilado (`frontend/dist`) y ofrece endpoints opcionales de asistencia con IA. Utiliza SQLite como almacenamiento local.

### Componentes e interacción
- **UI React (`frontend/src/App.jsx`)**  
  - Orquesta el formulario del acta, listado/búsqueda de registros, apertura/edición/eliminación, importación de PowerPoint, carga de anexos Excel, generación de Word y flujo de asistente IA.
- **Cliente API (`frontend/src/actasApi.js`)**  
  - Encapsula llamadas HTTP a `/api/actas`, descarga de Word/anexos y endpoints `/api/ai/*`.
- **Generación documental en cliente (`frontend/src/actaRichContent.js`, uso de `docx` en `App.jsx`)**  
  - Construye contenido narrativo/estructurado del acta y el archivo `.docx` (incluye datos del caso, secciones, trazabilidad, resúmenes y elementos derivados de la información disponible).
- **Importación de presentación (`frontend/src/powerpoint.js`)**  
  - Lee archivos `.pptx` (no `.ppt`) con `JSZip`, extrae texto de diapositivas y, cuando aplica, texto de imágenes mediante OCR local con `tesseract.js`.
- **Análisis de anexos Excel en frontend (`frontend/src/excelData.js`)**  
  - Extrae datos/tablas/series desde archivos Excel para apoyar resúmenes cuantitativos y visualizaciones/gráficos usados en la generación del documento.
- **Preparación de recursos OCR (`frontend/scripts/prepare-local-ocr.mjs`)**  
  - Copia `worker`, núcleo (`tesseract-core-*`) y datos de idioma (`spa.traineddata`) a `frontend/public/tesseract` para uso local.
- **Backend y persistencia (`app.py`)**  
  - Inicializa y gestiona SQLite (`actas`, `acta_attachments`), valida payloads/archivos, almacena JSON del acta, binario `.docx` y anexos por sección, y sirve respuestas de error/descarga.  
  - Sirve la SPA compilada (`/` y rutas de assets desde `frontend/dist`).  
  - Mantiene en memoria la API key de OpenAI (`app.config["OPENAI_API_KEY"]`) y, si está configurada, invoca la API de chat de OpenAI para completar campos del acta.
- **Plantilla heredada (`templates/index.html`)**  
  - Interfaz HTML renderizable por Flask con formulario/generación de texto (enfoque previo). La ruta raíz actual prioriza el frontend compilado; la coexistencia de esta plantilla es verificable en el repositorio.

### Modelo de datos (SQLite)
Definido en `app.py` (`init_db`):
- **`actas`**: `id` (TEXT, PK), `client_name` (TEXT), `data_json` (TEXT con campos del acta), `word_filename` (TEXT), `word_blob` (BLOB), `created_at` (TEXT), `updated_at` (TEXT). Índice por `updated_at DESC`.
- **`acta_attachments`**: `id` (INTEGER PK), `acta_id` (FK a `actas`, `ON DELETE CASCADE`), `section` (`financial|guarantees|conditions`), `filename`, `mimetype`, `content` (BLOB), restricción `UNIQUE(acta_id, section)`.

La ruta de base por defecto es `instance/actas.sqlite3` (configurable por variable de entorno).

## Flujo funcional
1. **Inicio y carga de registros**: la SPA solicita el listado de actas (`GET /api/actas`) y permite filtrar por cliente.
2. **Creación/edición de datos**: el usuario completa campos del caso (cliente, tipo, análisis, línea, monto, proponente, grupo, riesgo, perfil, análisis financiero, garantías, condiciones, recomendación, observaciones).
3. **Importación desde PowerPoint (opcional)**: carga de `.pptx`; el frontend extrae texto y aplica OCR local a imágenes compatibles para detectar y prellenar campos reconocibles. El resultado puede requerir revisión manual.
4. **Gestión de anexos (opcional)**: carga de archivos Excel (`.xlsx/.xls/.xlsm`, hasta 20 MB por archivo) asociados a secciones `financial`, `guarantees` y `conditions`; se pueden reemplazar o marcar para eliminación al guardar.
5. **Asistente IA (opcional)**:  
   - Consulta de estado (`GET /api/ai/status`).  
   - Configuración en memoria de API key (`POST /api/ai/configure`).  
   - Solicitud de análisis/generación (`POST /api/ai/generate`) enviando datos actuales, texto de presentación y anexos Excel; el backend extrae texto de Excel y solicita a OpenAI un JSON con los campos del acta.  
   - El usuario revisa/ajusta los campos sugeridos antes de guardar.
6. **Generación del documento Word**: el frontend construye el `.docx` con la librería `docx`, incorporando la información del formulario y elementos derivados (narrativa, resúmenes, anexos/soportes y componentes gráficos según datos disponibles).
7. **Persistencia**:  
   - **Crear** (`POST /api/actas`, `multipart/form-data`): envía `data` (JSON), archivo `word` y anexos; el backend valida y almacena.  
   - **Actualizar** (`PUT /api/actas/<id>`): reemplaza datos y Word archivado; conserva anexos no removidos salvo reemplazo o eliminación explícita (`remove_attachments`).
8. **Consulta y descarga**: apertura de detalle (`GET /api/actas/<id>`), descarga del Word archivado (`GET /api/actas/<id>/word`) y de anexos (`GET /api/actas/<id>/attachments/<section>`).
9. **Eliminación**: borrado del acta (`DELETE /api/actas/<id>`) con eliminación en cascada de anexos en base de datos.

## Tecnologías e integraciones
### Backend
- **Lenguaje/runtime**: Python (README indica 3.10 o posterior).
- **Framework/servidor**: Flask 3.0.3, Waitress (`serve` en `app.py`).
- **Persistencia**: SQLite mediante `sqlite3` (biblioteca estándar).
- **Procesamiento de Excel (backend, flujo IA)**: `openpyxl` para extracción de texto/contenido de hojas.
- **Integración externa opcional**: API de OpenAI (`https://api.openai.com/v1/chat/completions`, modelo `gpt-4o-mini` en código) invocada con `urllib.request` cuando el usuario configura una API key.
- **Otras utilidades estándar**: `json`, `zipfile`, `pathlib`, validación de `.docx` como contenedor ZIP, etc.

### Frontend
- **Framework y build**: React 19, React DOM 19, Vite 8, `@vitejs/plugin-react`.
- **Generación de documentos**: `docx` (creación de `.docx` en navegador).
- **Lectura de archivos**: `jszip` (PPTX y procesamiento de archivos tipo ZIP/Excel en utilidades frontend).
- **OCR local**: `tesseract.js` v7 con recursos locales (`spa.traineddata`, worker y core wasm/js) preparados en `public/tesseract`.
- **Calidad/herramientas**: Oxlint (`npm run lint`), pruebas con `node --test` (incluye dependencias de pruebas como `@xmldom/xmldom`).

### Pruebas
- **Python**: `unittest` en `tests/test_acta_generator.py` y `tests/test_acta_api.py` (generación de acta y API/persistencia/serving de frontend y recursos OCR).
- **Frontend**: pruebas en `frontend/src/actasApi.test.js` y `frontend/test/powerpoint.test.js`.

### Integraciones y dependencias operativas
- **Red externa**: requerida únicamente para el flujo opcional de “Análisis con IA” hacia OpenAI. Las operaciones CRUD y la generación local del documento no dependen de servicios externos según el código y la documentación.
- **Recursos locales**: OCR depende de artefactos preparados en `frontend/public/tesseract` (proceso `predev`/`prebuild`).

## Funcionalidades implementadas
Funcionalidades verificables en el código actual:

- **Gestión de actas (CRUD local)**:
  - Crear, listar, consultar, actualizar y eliminar actas vía API (`/api/actas`).
  - Almacenamiento de datos del acta en JSON, metadatos y archivo Word archivado en SQLite.
  - Descarga del `.docx` archivado por acta.
- **Gestión de anexos por sección**:
  - Secciones soportadas: `financial`, `guarantees`, `conditions`.
  - Carga/actualización de anexos Excel permitidos (`.xlsx`, `.xls`, `.xlsm`) con validaciones de tipo y tamaño.
  - Conservación, reemplazo o eliminación explícita en actualización; descarga individual de anexos guardados.
  - Eliminación en cascada de anexos al borrar el acta.
- **Generación de contenido y documento**:
  - Generación de acta narrativa/estructurada en backend (`generate_acta` y utilidades asociadas en `app.py`) y generación enriquecida de Word en frontend (`docx` + `actaRichContent.js`).
  - Inclusión de campos del caso, secciones analíticas, conclusiones/seguimiento y referencias a anexos/soportes según la información disponible.
- **Interfaz web React**:
  - Formulario completo de campos del acta, listado y búsqueda de actas guardadas, indicadores de estado/cambios, manejo de errores y mensajes.
  - Acciones para nueva acta, abrir, guardar, descargar Word archivado, eliminar y gestionar anexos.
- **Importación desde PowerPoint**:
  - Lectura de `.pptx`, extracción de texto de diapositivas y OCR local de imágenes (español) con progreso y reporte de campos detectados/faltantes.
- **Asistente de IA (opcional, implementado)**:
  - Configuración de API key en memoria del servidor, consulta de estado y generación de propuestas de contenido/campos a partir de datos actuales, texto de presentación y anexos Excel.
  - Confirmación de uso y revisión manual de resultados en UI.
- **Servicio del frontend compilado**:
  - Flask sirve `frontend/dist/index.html` y assets; respuesta de error controlada si el build no está disponible.
- **Pruebas automatizadas incluidas en el repositorio**:
  - Cobertura de generación de acta (backend), API CRUD/validaciones/descargas/serving de recursos, cliente API frontend e importación/parsing PPTX (incluidos casos con OCR simulado).

## Estado actual
- **Base de código**: proyecto funcional en términos de componentes implementados (backend Flask + SPA React + persistencia SQLite + generación Word + importación PPTX/OCR local + asistente IA opcional), según inspección del código y documentación.
- **Historial reciente**: últimos cambios registrados el 2026-11-22 (`3cd6bf6`), con iteraciones previas centradas en rigor, exhaustividad y exportación del acta.
- **Datos locales presentes en el workspace**: existe `instance/actas.sqlite3` (archivo de base local) y directorios `uploads/`, `__pycache__/`, `frontend/dist/` y artefactos de entorno/pruebas (`.pytest_cache/`, `frontend/spa.traineddata` en raíz de frontend además de copia preparada en `public/` según scripts). Su contenido operativo específico más allá de lo evidente no fue auditado en detalle.
- **Verificación de ejecución/pruebas en este análisis**: no se ejecutaron suites completas de pruebas, linters ni build durante esta elaboración del handoff; por tanto, el estado de “tests/lint/build en verde” no puede afirmarse como verificado en el momento actual.
- **Comportamiento esperado por entorno**: el servidor escucha por defecto en `127.0.0.1:5000` (o `ACTAS_HOST/ACTAS_PORT`); en entornos como Codespaces puede requerir configuración de host/puerto y reenvío adecuado para acceso externo.

## Configuración y ejecución
### Requisitos (según documentación y manifiestos)
- Python 3.10 o posterior (`README.md`).
- Node.js 20.19+ (`README.md`).
- Dependencias Python: `Flask==3.0.3`, `waitress>=3.0,<4`, `openpyxl>=3.1,<4` (`requirements.txt`).
- Dependencias frontend definidas en `frontend/package.json`.

### Variables de entorno relevantes (verificadas en `app.py`)
- `ACTAS_DATABASE_PATH`: ruta del archivo SQLite (por defecto `instance/actas.sqlite3`).
- `ACTAS_HOST`: host de escucha de Waitress (por defecto `127.0.0.1`).
- `ACTAS_PORT`: puerto de escucha (por defecto `5000`).
- `OPENAI_API_KEY` no se toma del entorno en la configuración inicial del app; la clave se configura en memoria vía API (`/api/ai/configure`).

### Ejecución local (flujo documentado)
1. Instalar dependencias Python: `python -m pip install -r requirements.txt`
2. Instalar dependencias frontend: `cd frontend && npm ci`
3. Construir frontend y preparar recursos OCR locales: `npm run build` (ejecuta `prebuild` → `scripts/prepare-local-ocr.mjs`)
4. Iniciar servidor desde la raíz: `python app.py`
5. Abrir: `http://127.0.0.1:5000`

### Desarrollo
- Ejecutar backend (`python app.py`) y frontend en modo desarrollo (`cd frontend && npm run dev`) en paralelo.
- Vite proxya solicitudes `/api` hacia `http://127.0.0.1:5000` (`frontend/vite.config.js`).

### Pruebas y calidad (comandos definidos; ejecución no verificada en este análisis)
- Backend: pruebas en `tests/` (ejecución típica con `pytest` o `python -m unittest`, según entorno; no hay script unificado documentado en raíz).
- Frontend: `npm run test`, `npm run lint`, `npm run build` dentro de `frontend/`.

### Respaldos y datos
- `README.md` indica que actas, documentos Word y anexos se guardan en `instance/actas.sqlite3`; recomienda detener la aplicación y copiar ese archivo para respaldo.

## Archivos principales
| Ruta | Responsabilidad |
|---|---|
| `app.py` | Backend Flask/Waitress: configuración, rutas API de actas/anexos/Word, endpoints IA (`/api/ai/*`), validaciones, acceso a SQLite, generación de acta textual (`generate_acta`), extracción de texto Excel para IA y servicio del frontend compilado. |
| `requirements.txt` | Dependencias Python del backend. |
| `README.md` | Instrucciones generales de instalación, ejecución local/desarrollo y respaldo de datos. |
| `frontend/package.json` | Scripts y dependencias del frontend (build, dev, lint, test, OCR prebuild). |
| `frontend/vite.config.js` | Configuración de Vite y proxy de `/api` al backend en desarrollo. |
| `frontend/scripts/prepare-local-ocr.mjs` | Copia recursos de Tesseract (worker/core/lenguaje) a `frontend/public/tesseract`. |
| `frontend/src/App.jsx` | Componente principal de la SPA: estado del formulario, CRUD UI, importación PPTX/OCR, anexos, asistente IA, generación/guardado/descarga de Word y vista previa. |
| `frontend/src/actasApi.js` | Cliente HTTP para actas, anexos, Word y endpoints de IA; normalización de errores. |
| `frontend/src/actaRichContent.js` | Utilidades de composición narrativa/rich content, validaciones, resúmenes, trazabilidad y apoyo a la generación del documento. |
| `frontend/src/powerpoint.js` | Importación de `.pptx`, extracción de texto y OCR de imágenes referenciadas en diapositivas. |
| `frontend/src/excelData.js` | Extracción y estructuración de datos numéricos/series desde Excel para análisis cuantitativo y gráficos. |
| `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/main.jsx` | Estilos y arranque de la aplicación React. |
| `frontend/public/*`, `frontend/dist/*` | Recursos estáticos y artefactos compilados servidos por la aplicación (cuando existen). |
| `templates/index.html` | Plantilla Flask heredada para generación/visualización de acta en HTML (flujo alterno histórico en el repositorio). |
| `tests/test_acta_api.py` | Pruebas de API Flask: CRUD, validaciones, manejo de archivos, descarga de Word/anexos y servicio de frontend/recursos OCR. |
| `tests/test_acta_generator.py` | Pruebas de la función de generación de acta en backend. |
| `frontend/src/actasApi.test.js` | Pruebas del cliente API frontend. |
| `frontend/test/powerpoint.test.js` | Pruebas de lectura/parsing de PPTX y mapeo de campos/OCR simulado. |
| `docs/superpowers/plans/2026-10-30-credit-committee-acta-plan.md` | Plan inicial de construcción por iteraciones. |
| `docs/superpowers/specs/2026-10-30-credit-committee-acta-design.md` | Diseño funcional inicial del generador de actas. |
| `docs/superpowers/specs/2026-10-30-local-acta-crud-design.md` | Diseño de persistencia local, CRUD, API y ejecución integrada. |
| `docs/superpowers/specs/2026-11-17-openai-acta-assistant-design.md` | Diseño del asistente IA con clave en memoria y generación asistida. |
| `instance/actas.sqlite3` | Base de datos SQLite local (si existe, contiene datos/artefactos persistidos del entorno). |
| `moodboard-pichincha.html`, `moodboard-pichincha.svg` | Recursos de referencia visual/branding presentes en el repositorio. |
| `skills-lock.json`, `.agents/skills/*` | Metadatos y contenidos de habilidades de apoyo al flujo de desarrollo/documentación incluidos en el repositorio. |

## Pendientes
Pendientes y aspectos no cerrados verificables a partir del código, pruebas y documentación:

- **Validación operacional no acreditada en este análisis**: no se verificó la ejecución actual de pruebas backend/frontend, lint ni build; confirmar estado en el entorno objetivo.
- **Pruebas automáticas de endpoints IA ausentes en `tests/`**: el backend implementa `/api/ai/status`, `/api/ai/configure` y `/api/ai/generate`, pero no se identificaron pruebas específicas para estos endpoints en los archivos de pruebas revisados.
- **Dependencia externa en flujo IA**: la generación asistida requiere conectividad y credenciales válidas de OpenAI, y usa un modelo fijo en código (`gpt-4o-mini`); la disponibilidad/calidad del resultado depende del servicio externo.
- **Seguridad y alcance de despliegue**: no hay autenticación/autorización, cifrado en reposo ni controles multiusuario; el diseño y configuración están orientados a uso local.
- **Persistencia y versionado documental**: cada actualización reemplaza el Word archivado y no se conserva historial de versiones; los datos residen en SQLite local sin mecanismo de sincronización.
- **Coexistencia de componentes heredados**: existe `templates/index.html` y lógica/estructuras históricas en el repositorio; conviene confirmar y, si aplica, delimitar o retirar rutas/artefactos no utilizados en el flujo principal.
- **Calidad de extracción/importación**: el reconocimiento desde PPTX/OCR y la extracción desde Excel dependen del formato y calidad de los archivos fuente; la revisión manual de campos sigue siendo necesaria (comportamiento reflejado en UI/código).

## Instrucciones para continuar
1. **Preparar entorno y compilar frontend**
   - Instalar dependencias (`python -m pip install -r requirements.txt`, `cd frontend && npm ci`).
   - Ejecutar `npm run build` en `frontend` para generar `frontend/dist` y recursos OCR locales.
2. **Ejecutar y validar el flujo principal**
   - Iniciar con `python app.py` y acceder a la URL configurada.
   - Verificar CRUD de actas, carga/descarga de anexos, generación y archivado de Word, importación PPTX y (si aplica) flujo IA con una clave válida.
3. **Ejecutar verificaciones automatizadas**
   - Backend: correr pruebas en `tests/` (`test_acta_api.py`, `test_acta_generator.py`).
   - Frontend: en `frontend/` ejecutar `npm run test`, `npm run lint` y `npm run build`.
   - Registrar resultados y corregir regresiones antes de cambios mayores.
4. **Revisar puntos de extensión con mayor impacto**
   - **IA**: agregar pruebas de contrato/error para `/api/ai/*`, manejo de timeouts/errores y parametrización del modelo si se requiere.
   - **Documento**: ajustar reglas en `actaRichContent.js`/`app.py` manteniendo coherencia entre vista previa, Word generado y persistencia.
   - **Importación de datos**: mejorar heurísticas de `powerpoint.js` y `excelData.js` con casos reales representativos.
5. **Buenas prácticas para cambios futuros**
   - Mantener compatibilidad del esquema SQLite o incorporar migraciones explícitas si se modifica.
   - No versionar datos sensibles/locales (`instance/actas.sqlite3`) salvo necesidad controlada.
   - Actualizar documentación (`README.md`, specs y este `handoff.md`) cuando cambien APIs, configuración o flujos.
