# practica_agentes

## Ejecutar localmente

Requisitos: Python 3.10 o posterior y Node.js 20.19+.

1. Instala las dependencias de Python: `python -m pip install -r requirements.txt`.
2. Instala las del frontend: `cd frontend && npm ci`.
3. Compila la interfaz y los recursos locales de OCR: `npm run build`.
4. Desde la raíz del proyecto, inicia el servidor local: `python app.py`.
5. Abre <http://127.0.0.1:5000>.

La aplicación guarda actas, documentos Word y anexos en `instance/actas.sqlite3`.
Para respaldar los datos, detén la aplicación y copia ese archivo a un lugar seguro.
No se requiere un servicio de base de datos ni conexión a Internet para las operaciones
de actas. El OCR de imágenes usa los recursos locales incluidos al compilar.

Durante el desarrollo, ejecuta `python app.py` en una terminal y `npm run dev` dentro
de `frontend` en otra; Vite enviará las solicitudes `/api` al servidor Flask.