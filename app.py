from __future__ import annotations

import io
import json
import math
import os
import sqlite3
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict
import urllib.error
import urllib.request

from openpyxl import load_workbook

from flask import Flask, jsonify, request, send_file, send_from_directory
from waitress import serve
from werkzeug.utils import secure_filename

ATTACHMENT_SECTIONS = {"financial", "guarantees", "conditions"}
ALLOWED_ATTACHMENT_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}
ATTACHMENT_MIMETYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}
MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024
MAX_WORD_SIZE = 10 * 1024 * 1024
MAX_REQUEST_SIZE = 75 * 1024 * 1024
ACTA_FIELDS = {
    "clientName",
    "clientType",
    "analysisType",
    "line",
    "proposal",
    "amount",
    "risk",
    "group",
    "profile",
    "financial",
    "guarantees",
    "conditions",
    "recommendation",
    "observations",
}

app = Flask(__name__)
app.config["DATABASE_PATH"] = os.environ.get(
    "ACTAS_DATABASE_PATH",
    str(Path(app.instance_path) / "actas.sqlite3"),
)
app.config["FRONTEND_DIST"] = str(Path(app.root_path) / "frontend" / "dist")
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_SIZE
app.config["OPENAI_API_KEY"] = ""

Path(app.instance_path).mkdir(parents=True, exist_ok=True)


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(app.config["DATABASE_PATH"])
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection():
    connection = connect_db()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    database_path = Path(app.config["DATABASE_PATH"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with database_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS actas (
                id TEXT PRIMARY KEY,
                client_name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                word_filename TEXT NOT NULL,
                word_blob BLOB NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS actas_updated_at_idx
                ON actas(updated_at DESC);
            CREATE TABLE IF NOT EXISTS acta_attachments (
                id INTEGER PRIMARY KEY,
                acta_id TEXT NOT NULL REFERENCES actas(id) ON DELETE CASCADE,
                section TEXT NOT NULL CHECK(section IN ('financial', 'guarantees', 'conditions')),
                filename TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                content BLOB NOT NULL,
                UNIQUE(acta_id, section)
            );
            """
        )


init_db()


def api_error(message: str, status: int):
    return jsonify({"error": message}), status


def read_payload():
    content_type = request.content_type or ""
    raw_payload = request.form.get("data") if content_type.startswith("multipart/") else None
    if raw_payload is None:
        payload = request.get_json(silent=True)
    else:
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            return None, "El campo data debe contener JSON válido."

    if isinstance(payload, dict) and set(payload) == {"data"}:
        payload = payload["data"]
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                return None, "El campo data debe contener JSON válido."
    if not isinstance(payload, dict):
        return None, "Los datos del acta deben ser un objeto JSON."
    return payload, None


def validate_acta(data):
    if not isinstance(data, dict):
        return None, "Los datos del acta deben ser un objeto JSON."
    if set(data) != ACTA_FIELDS:
        return None, "Los campos del acta están incompletos o no son válidos."

    normalized = {}
    for field in ACTA_FIELDS:
        value = data[field]
        if field == "amount":
            if value == "":
                normalized[field] = ""
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                return None, "El monto debe ser un número válido."
            try:
                amount = float(value)
            except (TypeError, ValueError):
                return None, "El monto debe ser un número válido."
            if amount < 0 or not math.isfinite(amount):
                return None, "El monto debe ser un número no negativo."
            normalized[field] = amount
        elif isinstance(value, str) and len(value) <= 20000:
            normalized[field] = value.strip()
        else:
            return None, f"El campo {field} debe ser texto de hasta 20.000 caracteres."

    if not normalized["clientName"]:
        return None, "El nombre del cliente es obligatorio."
    return normalized, None


def read_word():
    uploaded = request.files.get("word")
    if uploaded is None or not uploaded.filename:
        return None, None, "Adjunta el documento Word generado antes de guardar."
    filename = secure_filename(uploaded.filename)
    if not filename.lower().endswith(".docx"):
        return None, None, "El documento del acta debe tener formato .docx."
    content = uploaded.read(MAX_WORD_SIZE + 1)
    if len(content) > MAX_WORD_SIZE:
        return None, None, "El documento Word supera el límite de 10 MB."
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if "[Content_Types].xml" not in archive.namelist() or "word/document.xml" not in archive.namelist():
                return None, None, "El archivo adjunto no parece ser un documento Word válido."
    except (zipfile.BadZipFile, OSError):
        return None, None, "El archivo adjunto no parece ser un documento Word válido."
    return filename, content, None


def read_attachment_uploads():
    uploads = {}
    for section in ATTACHMENT_SECTIONS:
        uploaded = request.files.get(f"attachment_{section}")
        if uploaded is None or not uploaded.filename:
            continue
        filename = uploaded.filename.replace("\\", "/").rsplit("/", 1)[-1]
        filename = "".join(character for character in filename if character.isprintable()).strip()
        extension = Path(filename).suffix.lower()
        if not filename or extension not in ALLOWED_ATTACHMENT_EXTENSIONS:
            return None, f"El anexo de {section} debe ser un archivo Excel válido."
        content = uploaded.read(MAX_ATTACHMENT_SIZE + 1)
        if len(content) > MAX_ATTACHMENT_SIZE:
            return None, "Cada anexo Excel debe ocupar como máximo 20 MB."
        uploads[section] = {
            "filename": filename,
            "mimetype": ATTACHMENT_MIMETYPES[extension],
            "content": content,
        }
    return uploads, None


def read_removed_attachments():
    raw_sections = request.form.get("remove_attachments", "[]")
    try:
        sections = json.loads(raw_sections)
    except json.JSONDecodeError:
        return None, "La lista de anexos a quitar no es válida."
    if (
        not isinstance(sections, list)
        or any(not isinstance(section, str) or section not in ATTACHMENT_SECTIONS for section in sections)
    ):
        return None, "La lista de anexos a quitar no es válida."
    return set(sections), None


def attachment_metadata(connection, acta_id):
    rows = connection.execute(
        "SELECT section, filename FROM acta_attachments WHERE acta_id = ? ORDER BY section",
        (acta_id,),
    ).fetchall()
    return {row["section"]: {"filename": row["filename"]} for row in rows}


def store_attachments(connection, acta_id, uploads, removed_sections):
    for section in removed_sections - uploads.keys():
        connection.execute(
            "DELETE FROM acta_attachments WHERE acta_id = ? AND section = ?",
            (acta_id, section),
        )
    for section, upload in uploads.items():
        connection.execute(
            """
            INSERT INTO acta_attachments (acta_id, section, filename, mimetype, content)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(acta_id, section) DO UPDATE SET
                filename = excluded.filename,
                mimetype = excluded.mimetype,
                content = excluded.content
            """,
            (acta_id, section, upload["filename"], upload["mimetype"], upload["content"]),
        )


@app.errorhandler(413)
def request_too_large(_error):
    return api_error("La solicitud supera el tamaño máximo permitido.", 413)


@app.get("/api/actas")
def list_actas():
    with database_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, client_name, created_at, updated_at
            FROM actas ORDER BY updated_at DESC, id
            """
        ).fetchall()
    return jsonify([
        {
            "id": row["id"],
            "clientName": row["client_name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ])


@app.get("/api/actas/<acta_id>")
def get_acta(acta_id):
    with database_connection() as connection:
        row = connection.execute(
            """
            SELECT id, data_json, word_filename, created_at, updated_at
            FROM actas WHERE id = ?
            """,
            (acta_id,),
        ).fetchone()
        if row is None:
            return api_error("No se encontró el acta solicitada.", 404)
        attachments = attachment_metadata(connection, acta_id)
    return jsonify({
        "id": row["id"],
        "data": json.loads(row["data_json"]),
        "wordFilename": row["word_filename"],
        "attachments": attachments,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    })


def persist_acta(acta_id=None):
    payload, error = read_payload()
    if error:
        return api_error(error, 400)
    data, error = validate_acta(payload)
    if error:
        return api_error(error, 400)
    filename, word_content, error = read_word()
    if error:
        return api_error(error, 400)
    uploads, error = read_attachment_uploads()
    if error:
        return api_error(error, 400)
    removed_sections, error = read_removed_attachments()
    if error:
        return api_error(error, 400)
    if removed_sections & uploads.keys():
        return api_error("Un anexo no puede cargarse y quitarse en la misma operación.", 400)

    timestamp = datetime.now(timezone.utc).isoformat()
    encoded_data = json.dumps(data, ensure_ascii=False)
    with database_connection() as connection:
        if acta_id is None:
            acta_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO actas
                    (id, client_name, data_json, word_filename, word_blob, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (acta_id, data["clientName"], encoded_data, filename, word_content, timestamp, timestamp),
            )
        else:
            cursor = connection.execute(
                """
                UPDATE actas SET client_name = ?, data_json = ?, word_filename = ?,
                    word_blob = ?, updated_at = ? WHERE id = ?
                """,
                (data["clientName"], encoded_data, filename, word_content, timestamp, acta_id),
            )
            if cursor.rowcount == 0:
                return api_error("No se encontró el acta que deseas actualizar.", 404)
        store_attachments(connection, acta_id, uploads, removed_sections)

    return jsonify({"id": acta_id, "createdAt": timestamp, "updatedAt": timestamp}), (
        201 if request.method == "POST" else 200
    )


@app.post("/api/actas")
def create_acta():
    return persist_acta()


@app.put("/api/actas/<acta_id>")
def update_acta(acta_id):
    return persist_acta(acta_id)


@app.get("/api/actas/<acta_id>/word")
def download_word(acta_id):
    with database_connection() as connection:
        row = connection.execute(
            "SELECT word_filename, word_blob FROM actas WHERE id = ?",
            (acta_id,),
        ).fetchone()
    if row is None:
        return api_error("No se encontró el acta solicitada.", 404)
    return send_file(
        io.BytesIO(row["word_blob"]),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=row["word_filename"],
    )


@app.get("/api/actas/<acta_id>/attachments/<section>")
def download_attachment(acta_id, section):
    if section not in ATTACHMENT_SECTIONS:
        return api_error("La sección del anexo no es válida.", 404)
    with database_connection() as connection:
        row = connection.execute(
            """
            SELECT filename, mimetype, content FROM acta_attachments
            WHERE acta_id = ? AND section = ?
            """,
            (acta_id, section),
        ).fetchone()
    if row is None:
        return api_error("No se encontró el anexo solicitado.", 404)
    return send_file(
        io.BytesIO(row["content"]),
        mimetype=row["mimetype"],
        as_attachment=True,
        download_name=row["filename"],
    )


@app.delete("/api/actas/<acta_id>")
def delete_acta(acta_id):
    with database_connection() as connection:
        cursor = connection.execute("DELETE FROM actas WHERE id = ?", (acta_id,))
        if cursor.rowcount == 0:
            return api_error("No se encontró el acta que deseas eliminar.", 404)
    return "", 204


@app.post("/api/ai/configure")
def configure_openai():
    payload = request.get_json(silent=True) or {}
    api_key = str(payload.get("apiKey") or "").strip()
    if not api_key:
        app.config["OPENAI_API_KEY"] = ""
        return jsonify({"configured": False})
    app.config["OPENAI_API_KEY"] = api_key
    return jsonify({"configured": True})


@app.get("/api/ai/status")
def openai_status():
    return jsonify({"configured": bool(app.config["OPENAI_API_KEY"])})


def extract_excel_text(uploaded_file) -> str:
    workbook = load_workbook(uploaded_file, read_only=True, data_only=True)
    rows = []
    try:
        for sheet in workbook.worksheets:
            rows.append(f"HOJA: {sheet.title}")
            for row_number, row in enumerate(sheet.iter_rows(max_row=200, max_col=40, values_only=True), start=1):
                values = [str(value).strip() for value in row if value is not None and str(value).strip()]
                if values:
                    rows.append(f"Fila {row_number}: {' | '.join(values)}")
    finally:
        workbook.close()
    return "\n".join(rows)


@app.post("/api/ai/generate")
def generate_with_openai():
    api_key = app.config["OPENAI_API_KEY"]
    if not api_key:
        return api_error("Configura primero la API key de OpenAI.", 400)

    payload = request.form.get("data")
    try:
        request_data = json.loads(payload or "{}")
    except json.JSONDecodeError:
        return api_error("Los datos del acta no tienen un formato válido.", 400)

    current_fields = request_data.get("data") or {}
    presentation_text = str(request_data.get("presentationText") or "")[:12000]
    excel_blocks = []
    for section in ATTACHMENT_SECTIONS:
        uploaded_file = request.files.get(f"attachment_{section}")
        if uploaded_file:
            if not ALLOWED_ATTACHMENT_EXTENSIONS.intersection({Path(uploaded_file.filename).suffix.lower()}):
                continue
            try:
                excel_blocks.append(
                    f"{section.upper()} - {secure_filename(uploaded_file.filename)}:\n"
                    f"{extract_excel_text(uploaded_file.stream)}"
                )
            except Exception as error:
                return api_error(f"No se pudo leer el anexo Excel {secure_filename(uploaded_file.filename)}: {error}", 400)

    system_prompt = (
        "Eres un analista de crédito senior. Analiza únicamente la información proporcionada "
        "y genera contenido para un acta profesional en español con rigor de auditoría. No inventes datos, cifras, garantías, "
        "condiciones ni hechos no acreditados. Cada campo narrativo debe ser exhaustivo y pormenorizado, con estructura clara: "
        "información disponible, análisis técnico según criterios aplicables, implicaciones sobre riesgo y capacidad de pago, "
        "elementos de soporte/mitigantes identificados, limitaciones o inconsistencias, pendientes/acciones requeridas y conclusión de la sección. "
        "Conserva viñetas cuando aporten detalle y compleméntalas con párrafos explicativos (no entregues solo viñetas). "
        "Para perfil, análisis financiero, garantías, condiciones, recomendación y observaciones vincula explícitamente los hallazgos con el monto/exposición, "
        "la capacidad de pago, el nivel de riesgo, los soportes/anexos y la coherencia de la decisión. "
        "La recomendación debe ser explícita (aprobar, aprobar con condiciones o no aprobar) y coherente con el análisis; si hay condiciones o información insuficiente, indícalo con precisión. "
        "Si no hay datos, decláralo como información no disponible o pendiente y señala el impacto y la acción requerida, sin inferir. "
        "Devuelve un JSON estricto con exactamente estas claves: clientName, clientType, analysisType, "
        "line, proposal, amount, risk, group, profile, financial, guarantees, conditions, recommendation, "
        "observations. Usa strings; amount puede ser string numérico sin símbolos. Para datos ausentes usa una cadena vacía."
    )
    user_prompt = json.dumps({
        "presentationText": presentation_text,
        "excelAttachments": "\n\n".join(excel_blocks)[:30000],
        "currentFields": current_fields,
    }, ensure_ascii=False)

    openai_request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps({
            "model": "gpt-4o-mini",
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(openai_request, timeout=60) as response:
            openai_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        return api_error(f"OpenAI rechazó la solicitud ({error.code}). {detail[:500]}", 502)
    except urllib.error.URLError as error:
        return api_error(f"No se pudo contactar OpenAI: {error.reason}", 502)

    try:
        content = openai_payload["choices"][0]["message"]["content"]
        generated = json.loads(content)
    except (KeyError, IndexError, json.JSONDecodeError):
        return api_error("OpenAI devolvió una respuesta que no pudo interpretarse.", 502)

    allowed_fields = set(ACTA_FIELDS)
    cleaned = {}
    for field in ACTA_FIELDS:
        value = generated.get(field, "")
        cleaned[field] = str(value).strip() if value is not None else ""
    cleaned = {field: value for field, value in cleaned.items() if field in allowed_fields}
    return jsonify({"data": cleaned})

CLIENT_TEMPLATES: Dict[str, Dict[str, str]] = {
    "persona natural": {
        "perfil": "Cliente con ingreso principal por su actividad laboral o negocio personal; se evalúa estabilidad de ingresos y capacidad de pago.",
        "riesgo": "Se revisa estabilidad laboral, endeudamiento y comportamiento de pagos históricos.",
    },
    "pyme": {
        "perfil": "Cliente con actividad empresarial de mediano tamaño; se revisa generación de ingresos, flujo operativo y estructura de capital.",
        "riesgo": "Se evalúa volatilidad del negocio, concentración de ingresos y capacidad de servicio de deuda.",
    },
    "corporativo": {
        "perfil": "Cliente con estructura societaria compleja; se revisa modelo de negocio, grupo económico y exposición consolidada.",
        "riesgo": "Se análisis concentración geográfica, dependencias clave y estructura de deuda corporativa.",
    },
}

ANALYSIS_TEMPLATES: Dict[str, Dict[str, str]] = {
    "crédito ordinario": {
        "resumen": "El caso se analiza bajo condiciones normales de operación y riesgo crediticio esperado.",
        "recomendacion": "Se recomienda continuar con la operación bajo condiciones de endeudamiento proporcionales al flujo esperado.",
    },
    "reestructuración": {
        "resumen": "El caso requiere ajustes de plazo, cuota o condiciones para mantener la viabilidad del crédito.",
        "recomendacion": "Se recomienda reestructurar la operación con condiciones que preserven la capacidad de pago y reduzcan el riesgo de impago.",
    },
    "riesgo concentrado": {
        "resumen": "El caso requiere una revisión especial por concentración de exposición, dependencia o variables de riesgo relevantes.",
        "recomendacion": "Se recomienda mantener la operación con límites de exposición, mitigantes y seguimiento reforzado.",
    },
}


def _acta_has_text(value: str) -> bool:
    text = (value or "").strip()
    if not text:
        return False
    lowered = text.casefold()
    return lowered not in {
        "n/a", "na", "no aplica", "ninguno", "ninguna", "sin información", "sin informacion",
        "no informado", "pendiente", "pendiente de confirmación", "pendiente de confirmacion",
    }


def _acta_decision(recommendation: str, conditions: str = "") -> str:
    import re

    combined = f"{(recommendation or '').strip()}\n{(conditions or '').strip()}".casefold()
    if not combined.strip():
        return "pendiente"

    def has(pattern: str) -> bool:
        return re.search(pattern, combined) is not None

    negative = has(r"\bno\s+(se\s+)?recomiend|\bno\s+(es\s+)?(procedente|recomendable|aconsejable|viable)|\brechaz|\bdesfavor|\bno\s+aprobar|\bno\s+proced|\bnegar|\bimproceden|\bdenegar")
    positive = has(r"\bse\s+recomiend|\brecomiend\w*\s+(aprobar|continuar|otorg|conced|mantener|proceder|autorizar)|\baprobar\b|\bfavorable\b|\bprocedente\b|\botorgar\b|\bconceder\b|\bautorizar\b")
    conditional = has(r"\bcondici|\bsujet[oa]\s+a|\bsupedit|\bsiempre\s+que|\bprevio\s+a|\bantes\s+de(l)?\b|\buna\s+vez\b|\bmitig|\bcovenant\b|\breestructur|\bajust|\bl[ií]mit|\bseguimiento|\bgarant|\bcautelar|\brestric|\breserva")
    if negative and not positive:
        return "no_aprobar"
    if negative and positive:
        return "aprobar_con_condiciones"
    if positive and conditional:
        return "aprobar_con_condiciones"
    if conditional and not negative:
        return "aprobar_con_condiciones"
    if positive:
        return "aprobar"
    if negative:
        return "no_aprobar"
    return "indeterminada"


def build_conclusion_statement(recommendation: str, conditions: str = "", client_name: str = "el cliente evaluado") -> str:
    recommendation_text = (recommendation or "").strip()
    decision = _acta_decision(recommendation, conditions)
    basis = "con base en la información y los fundamentos documentados en el perfil, el análisis financiero y capacidad de pago, las garantías, las condiciones y las observaciones"
    client = (client_name or "el cliente evaluado").strip() or "el cliente evaluado"
    if decision == "aprobar":
        return f"Se recomienda aprobar el crédito para {client}, {basis}."
    if decision == "aprobar_con_condiciones":
        return f"Se recomienda aprobar el crédito para {client} con condiciones, supeditado al cumplimiento previo y/o permanente de las condiciones, mitigantes y controles documentados, {basis}."
    if decision == "no_aprobar":
        return f"No se recomienda aprobar el crédito para {client}, {basis}."
    if recommendation_text:
        return f"La postura crediticia para {client} debe interpretarse conforme a la recomendación documentada, sin asumir una aprobación definitiva no expresada; {basis}."
    return f"No es posible emitir una conclusión crediticia definitiva para {client} sin una recomendación expresa documentada; la decisión debe adoptarse una vez sustentados y validados los elementos críticos del caso."


def generate_acta(
    client_name: str,
    client_type: str,
    analysis_type: str,
    amount: float,
    risk_level: str,
    recommendation: str,
    observations: str,
    proponente: str = "",
    linea_credito: str = "",
    grupo_economico: str = "",
    analisis_financiero: str = "",
    garantias: str = "",
    condiciones: str = "",
    analisis_financiero_attachment: str = "",
    garantias_attachment: str = "",
    condiciones_attachment: str = "",
    profile: str = "",
) -> str:
    def section_content(value: str, missing: str, attachment_name: str = "", focus: str = "", criteria: str = "") -> str:
        text = (value or "").strip()
        if text:
            preserved = "\n".join(line.rstrip() for line in text.splitlines()).strip()
            lower = preserved.casefold()
            has_pending = any(token in lower for token in ["pendiente", "por confirmar", "por definir", "no informado", "sin información", "sin informacion", "n/a", "no disponible"])
            body = f"Información registrada (fuente: formulario/anexos declarados):\n{preserved}"
            if focus:
                body += f"\n\nAnálisis y contexto: {focus}"
            if criteria:
                body += f"\nCriterios de evaluación aplicados: {criteria}"
            body += "\nImplicaciones sobre riesgo y capacidad de pago: los elementos consignados deben valorarse por su impacto en la generación de flujo, la sostenibilidad de las obligaciones, la exposición asumida y la suficiencia de mitigantes, conforme a la evidencia disponible."
            body += "\nTrazabilidad y suficiencia de soporte: la información descrita debe poder conciliarse con la documentación y anexos del expediente; no deben inferirse hechos, cifras o condiciones no acreditadas."
            if has_pending:
                body += "\nPendiente de confirmación: se identifican datos faltantes o sujetos a validación; corresponde completar, sustentar y dejar constancia de su estado antes de la decisión o como condición/seguimiento según aplique."
            else:
                body += "\nConclusión de la sección: la información registrada permite sustentar el análisis en los términos expuestos, sujeto a verificación documental y a la ausencia de inconsistencias posteriores."
        else:
            body = f"Información registrada: {missing}"
            if focus:
                body += f"\n\nAnálisis y contexto: {focus}"
            if criteria:
                body += f"\nCriterios de evaluación aplicados: {criteria}"
            body += "\nImplicaciones sobre riesgo y capacidad de pago: la ausencia de información impide concluir de forma suficiente sobre esta dimensión del caso y constituye una limitación relevante para la deliberación."
            body += "\nTrazabilidad y suficiencia de soporte: no existe evidencia registrada en esta sección; se requiere documentación verificable y trazable."
            body += "\nPendiente de confirmación: completar, validar y documentar la información aplicable con la fuente correspondiente, definiendo responsable y oportunidad de cierre."
        if attachment_name:
            body += f"\n\nSoporte documental vinculado: archivo incorporado «{attachment_name}»; su contenido debe conciliarse con lo consignado y conservarse como parte de la evidencia del expediente."
        return body

    try:
        amount_value = float(amount)
    except (TypeError, ValueError):
        amount_value = 0.0

    decision = _acta_decision(recommendation, condiciones)
    recommendation_text = (recommendation or "").strip()
    conditions_text = (condiciones or "").strip()

    profile_body = section_content(
        profile,
        "No informado: no se registró un perfil detallado del cliente.",
        "",
        "caracterización del solicitante, actividad económica, trayectoria, estructura, experiencia y factores cualitativos relevantes para el caso.",
        "consistencia del perfil con la operación solicitada, antecedentes cualitativos, capacidad operativa y relevancia de factores no financieros.",
    )
    financial_body = section_content(
        analisis_financiero,
        "No informado: no se registró información detallada del análisis financiero y capacidad de pago.",
        analisis_financiero_attachment,
        "evaluación de ingresos, obligaciones, flujos, márgenes, liquidez, endeudamiento y capacidad de atender la exposición solicitada.",
        "suficiencia y estabilidad de la fuente de repago, relación entre obligaciones y flujo disponible, sensibilidad a variaciones y consistencia de las cifras documentadas.",
    )
    guarantees_body = section_content(
        garantias,
        "No informado: no se registró información detallada de garantías y mitigantes.",
        garantias_attachment,
        "identificación de garantías, mitigantes, coberturas, condiciones de ejecutabilidad y su función como soporte secundario de repago.",
        "naturaleza, cobertura razonable, calidad/ejecutabilidad, relación con la exposición y necesidad de condiciones o verificaciones adicionales.",
    )
    conditions_body = section_content(
        condiciones,
        "No informado: no se registraron las condiciones propuestas de la operación.",
        condiciones_attachment,
        "estructura de la operación (monto, plazo, tasa, forma de pago, destino) y controles, covenants o requisitos aplicables.",
        "alineación de términos con la capacidad de pago, finalidad, nivel de riesgo, mitigantes disponibles y factibilidad de cumplimiento.",
    )
    observations_body = section_content(
        observations,
        "No informado: no se registraron observaciones adicionales.",
        "",
        "hallazgos, alertas, inconsistencias, limitaciones de información y aspectos que requieren seguimiento o gestión.",
        "materialidad de los hallazgos, impacto en la decisión, necesidad de aclaración documental y medidas de control o monitoreo.",
    )
    recommendation_body = section_content(
        recommendation,
        "Pendiente de confirmación: no se registró una recomendación expresa para el comité.",
        "",
        "postura crediticia propuesta, coherencia con el análisis integral y fundamentos que la sustentan.",
        "consistencia entre perfil, capacidad de pago, garantías, condiciones, nivel de riesgo y decisión sugerida.",
    )

    attachment_labels = {
        "financiero": analisis_financiero_attachment,
        "garantías": garantias_attachment,
        "condiciones": condiciones_attachment,
    }
    anexos = [
        f"financiero: {'sí (' + analisis_financiero_attachment + ')' if analisis_financiero_attachment else 'no'}",
        f"garantías: {'sí (' + garantias_attachment + ')' if garantias_attachment else 'no'}",
        f"condiciones: {'sí (' + condiciones_attachment + ')' if condiciones_attachment else 'no'}",
    ]

    sections_state = [
        ("Perfil del cliente", _acta_has_text(profile)),
        ("Análisis financiero y capacidad de pago", _acta_has_text(analisis_financiero)),
        ("Garantías y mitigantes", _acta_has_text(garantias)),
        ("Condiciones propuestas", _acta_has_text(condiciones)),
        ("Observaciones", _acta_has_text(observations)),
        ("Recomendación y fundamento", _acta_has_text(recommendation)),
    ]
    informed_count = sum(1 for _, ok in sections_state if ok)
    missing_sections = [name for name, ok in sections_state if not ok]

    identification = (
        f"El presente acta documenta de manera detallada y exhaustiva el análisis crediticio de {client_name}, con base en la información registrada y los soportes disponibles al momento de su emisión.\n\n"
        f"- Cliente: {client_name}\n"
        f"- Tipo de cliente: {client_type or 'No informado'}\n"
        f"- Tipo de análisis: {analysis_type or 'No informado'}\n"
        f"- Línea de crédito: {linea_credito or 'No informada'}\n"
        f"- MONTO solicitado: ${amount_value:,.2f}\n"
        f"- PROPONENTE: {proponente or 'No informado'}\n"
        f"- Grupo económico: {grupo_economico or 'No informado'}\n"
        f"- Nivel de riesgo: {risk_level or 'No informado'}\n\n"
        "Análisis y contexto: los datos de identificación delimitan al sujeto de crédito, la naturaleza del análisis, la exposición solicitada y los parámetros base para la evaluación integral."
    )

    executive_summary = (
        f"Resumen ejecutivo: se presenta el caso de {client_name} por un monto solicitado de ${amount_value:,.2f} "
        f"({linea_credito or 'línea no informada'}; tipo de análisis: {analysis_type or 'no informado'}). "
        f"Nivel de riesgo registrado: {risk_level or 'No informado'}. "
        f"Secciones con información sustantiva registrada: {informed_count} de {len(sections_state)}. "
        f"Soportes anexos declarados: {', '.join(anexos)}.\n"
        f"Postura documentada: {build_conclusion_statement(recommendation, condiciones, client_name)}"
    )
    if missing_sections:
        executive_summary += "\nLimitaciones principales de completitud: " + "; ".join(missing_sections) + "."

    methodology = (
        "Alcance y metodología: el análisis se realiza con base en la información consignada en el expediente (formulario, narrativa y anexos declarados) y se estructura en dimensiones cualitativas y cuantitativas: "
        "identificación y contexto de la operación, perfil del solicitante, análisis financiero y capacidad de pago, nivel de riesgo, garantías/mitigantes, condiciones propuestas, observaciones y recomendación. "
        "No se incorporan supuestos ni datos no acreditados; los vacíos, inconsistencias o elementos no verificables se señalan como pendientes o limitaciones. "
        "Análisis y contexto: la suficiencia del dictamen depende de la calidad, consistencia y trazabilidad de la evidencia disponible."
    )

    risk_body = (
        f"Nivel de riesgo registrado: {risk_level or 'No informado'}.\n\n"
        "Análisis y contexto: la calificación de riesgo debe interpretarse de manera integral, considerando (i) capacidad y estabilidad de la fuente de repago, (ii) estructura y sostenibilidad de obligaciones, "
        "(iii) calidad y cobertura de garantías/mitigantes, (iv) adecuación de las condiciones de la operación, (v) factores cualitativos del cliente/actividad y (vi) hallazgos u observaciones relevantes.\n"
        f"Evaluación de completitud para sustentar la calificación: información financiera {'disponible' if _acta_has_text(analisis_financiero) else 'no disponible'}, garantías {'disponibles' if _acta_has_text(garantias) else 'no disponibles'}, "
        f"condiciones {'disponibles' if _acta_has_text(condiciones) else 'no disponibles'}, observaciones {'registradas' if _acta_has_text(observations) else 'no registradas'}.\n"
        "Conclusión de la sección: la severidad del riesgo y su aceptación deben confirmarse a la luz de la evidencia documental y del cierre de los pendientes identificados en el expediente."
    )

    traceability_lines = [
        f"- Formulario del caso: información de identificación y campos narrativos {'registrados parcialmente o en su totalidad' if informed_count else 'sin contenido sustantivo registrado'}.",
        f"- Anexo financiero: {'incorporado (' + analisis_financiero_attachment + ')' if analisis_financiero_attachment else 'no incorporado'}.",
        f"- Anexo de garantías: {'incorporado (' + garantias_attachment + ')' if garantias_attachment else 'no incorporado'}.",
        f"- Anexo de condiciones: {'incorporado (' + condiciones_attachment + ')' if condiciones_attachment else 'no incorporado'}.",
        "- Criterio de trazabilidad: cada conclusión relevante debe poder vincularse a datos o documentos verificables; la ausencia de soporte se trata como limitación o pendiente.",
    ]
    traceability_body = "\n".join(traceability_lines)

    pending_items = []
    if not _acta_has_text(profile):
        pending_items.append("Completar perfil del cliente y antecedentes cualitativos relevantes.")
    if not _acta_has_text(analisis_financiero):
        pending_items.append("Incorporar y sustentar análisis financiero y capacidad de pago con información verificable.")
    if not _acta_has_text(garantias):
        pending_items.append("Definir y documentar garantías/mitigantes, cobertura y condiciones de ejecutabilidad (o dejar constancia expresa).")
    if not _acta_has_text(condiciones):
        pending_items.append("Precisar términos y condiciones de la operación (monto, plazo, tasa, forma de pago, destino y controles).")
    if not _acta_has_text(recommendation):
        pending_items.append("Emitir recomendación expresa y fundamentada para el comité.")
    if decision == "aprobar_con_condiciones" and not _acta_has_text(condiciones) and "condici" not in recommendation_text.casefold():
        pending_items.append("Detallar las condiciones o mitigantes que sustentan una recomendación condicionada.")
    if decision == "aprobar" and not _acta_has_text(analisis_financiero):
        pending_items.append("Sustentar capacidad de pago antes de una decisión favorable.")
    for label, text_value in [
        ("Perfil del cliente", profile), ("Análisis financiero y capacidad de pago", analisis_financiero),
        ("Garantías y mitigantes", garantias), ("Condiciones propuestas", condiciones),
        ("Observaciones", observations), ("Recomendación y fundamento", recommendation),
    ]:
        lower = (text_value or "").casefold()
        if any(token in lower for token in ["pendiente", "por confirmar", "por definir", "no informado", "sin información", "sin informacion", "n/a", "no disponible"]):
            pending_items.append(f"Revisar y cerrar elementos pendientes o no informados en: {label}.")
    # de-duplicate preserving order
    seen = set()
    deduped = []
    for item in pending_items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    if deduped:
        follow_up_body = "Pendientes, condiciones y seguimiento requeridos:\n" + "\n".join(f"- {item}" for item in deduped)
    else:
        follow_up_body = "Pendientes, condiciones y seguimiento requeridos:\n- No se identificaron pendientes explícitos en la información registrada; mantener verificación documental y seguimiento conforme a las políticas aplicables."

    quantitative_lines = [
        f"- Monto solicitado (MONTO): ${amount_value:,.2f}",
        f"- Nivel de riesgo registrado: {risk_level or 'No informado'}",
        f"- Secciones con información registrada: {informed_count} de {len(sections_state)}",
        f"- Soportes anexos declarados: {', '.join(anexos)}",
        f"- Anexo financiero: {'sí (' + analisis_financiero_attachment + ')' if analisis_financiero_attachment else 'no'}",
        f"- Anexo de garantías: {'sí (' + garantias_attachment + ')' if garantias_attachment else 'no'}",
        f"- Anexo de condiciones: {'sí (' + condiciones_attachment + ')' if condiciones_attachment else 'no'}",
    ]
    if not _acta_has_text(analisis_financiero):
        quantitative_lines.append("- Limitación cuantitativa: no se dispone de detalle financiero narrativo registrado para ampliar indicadores o series en esta sección.")

    conclusion_detail = build_conclusion_statement(recommendation, condiciones, client_name)
    conclusion_body = (
        f"{conclusion_detail}\n\n"
        "Fundamento integral: la decisión debe considerar de manera conjunta la identificación del caso, el perfil, la capacidad de pago, el nivel de riesgo, las garantías/mitigantes, las condiciones propuestas y las observaciones documentadas. "
        "Las conclusiones se sujetan a la veracidad, suficiencia y trazabilidad de la evidencia; cualquier información no disponible, inconsistente o pendiente debe resolverse o quedar formalmente condicionada y en seguimiento. "
        "No se deben inferir hechos, montos, garantías, coberturas u obligaciones no acreditados en el expediente."
    )

    return f"""
COMISIÓN DE CRÉDITO – COMITÉ EJECUTIVO

ACTA DE ANÁLISIS Y RESOLUCIÓN DE LA OPERACIÓN

RESUMEN EJECUTIVO

{executive_summary}

IDENTIFICACIÓN DEL CLIENTE Y NATURALEZA DE LA PRESENTACIÓN

{identification}

ALCANCE Y METODOLOGÍA

{methodology}

PERFIL DEL CLIENTE

{profile_body}

ANÁLISIS FINANCIERO Y CAPACIDAD DE PAGO

{financial_body}

NIVEL DE RIESGO

{risk_body}

GARANTÍAS Y MITIGANTES

{guarantees_body}

CONDICIONES PROPUESTAS

{conditions_body}

OBSERVACIONES

{observations_body}

RECOMENDACIÓN Y FUNDAMENTO

{recommendation_body}

TRAZABILIDAD Y SOPORTES

{traceability_body}

ANÁLISIS GRÁFICO E HISTÓRICO

{chr(10).join(quantitative_lines)}

Análisis y contexto: se resumen los datos cuantitativos y soportes disponibles en el expediente; la información gráfica, tabular o numérica detallada contenida en anexos debe revisarse y conciliarse con las secciones narrativas del acta.

{follow_up_body}

CONCLUSIÓN

{conclusion_body}
""".strip()


def frontend_file(asset_path=None):
    dist = Path(app.config["FRONTEND_DIST"])
    index_file = dist / "index.html"
    if not index_file.is_file():
        return api_error("No se encontró el frontend compilado. Ejecuta `npm run build` en frontend.", 503)
    if asset_path:
        asset_file = dist / asset_path
        if asset_file.is_file():
            return send_from_directory(dist, asset_path)
        if Path(asset_path).suffix:
            return "No encontrado", 404
    return send_from_directory(dist, "index.html")


@app.get("/")
def frontend_index():
    return frontend_file()


@app.get("/<path:asset_path>")
def frontend_asset(asset_path):
    return frontend_file(asset_path)


if __name__ == "__main__":
    serve(
        app,
        host=os.environ.get("ACTAS_HOST", "127.0.0.1"),
        port=int(os.environ.get("ACTAS_PORT", "5000")),
    )
