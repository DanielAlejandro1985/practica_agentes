from __future__ import annotations

import io
import json
import math
import os
import re
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
        "Eres un analista de crédito senior. Debes analizar al sujeto de crédito y sus números a partir de la información proporcionada "
        "(campos del formulario, texto de presentación y contenido extraído de los archivos/anexos incluidos), y redactar ese análisis y sus conclusiones. "
        "No inventes datos, cifras, garantías, condiciones ni hechos no acreditados. No describas de qué trata cada sección ni su metodología: analiza concretamente el caso. "
        "Redacta cada campo narrativo en párrafos bien estructurados, claros y coherentes, centrados en el sujeto, el monto o exposición solicitada y las cifras e indicadores disponibles. "
        "En 'profile' analiza al solicitante (actividad, trayectoria, fortalezas o debilidades cualitativas) y su consistencia con la operación. "
        "En 'financial' analiza ingresos, flujos, obligaciones, márgenes, liquidez, endeudamiento y capacidad de pago frente al monto solicitado, sustentándote en las cifras y datos provistos o extraídos de los archivos. "
        "En 'guarantees' analiza las garantías o mitigantes, su cobertura y ejecutabilidad frente a la exposición. "
        "En 'conditions' analiza la adecuación de plazo, tasa, forma de pago, destino y controles respecto de la capacidad de pago y el riesgo. "
        "En 'recommendation' emite una postura explícita (aprobar, aprobar con condiciones o no aprobar) fundamentada en el análisis del sujeto y sus números, indicando condiciones si corresponden. "
        "En 'observations' señala hallazgos, riesgos, inconsistencias o limitaciones relevantes del caso. "
        "Si falta información o cifras, indícalo con precisión y explica cómo esa carencia limita el análisis del sujeto y de su capacidad de pago, sin inferir. "
        "Evita listas, viñetas o etiquetas internas. "
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
    def normalize(text: str) -> str:
        return "\n".join(line.rstrip() for line in (text or "").replace("\r\n", "\n").splitlines()).strip()

    def ensure_sentence(text: str) -> str:
        value = " ".join((text or "").split()).strip()
        if not value:
            return ""
        return value if value[-1] in ".!?" else f"{value}."

    def join_paragraphs(*parts: str) -> str:
        return "\n\n".join(" ".join(part.split()).strip() for part in parts if part and part.strip())

    try:
        amount_value = float(amount)
    except (TypeError, ValueError):
        amount_value = 0.0

    decision = _acta_decision(recommendation, condiciones)
    recommendation_text = (recommendation or "").strip()
    client_label = client_name or "el sujeto de crédito evaluado"
    amount_text = f"${amount_value:,.2f}"
    risk_label = risk_level or "no informado"

    def section_analysis(value: str, subject_focus: str, missing_impact: str, attachment_name: str = "") -> str:
        text = normalize(value)
        lower = text.casefold()
        pending = (not text) or any(
            token in lower
            for token in ["pendiente", "por confirmar", "por definir", "no informado", "sin información", "sin informacion", "n/a", "no disponible"]
        )
        negative = any(token in lower for token in ["insuficiente", "deterioro", "pérdida", "perdida", "incumplim", "ilíqu", "iliqu", "débil", "debil", "alto riesgo", "deficiente"])
        positive = any(token in lower for token in ["suficiente", "adecuad", "estable", "favorable", "sólid", "solid", "fortaleza", "respaldo", "cumple", "cubre"])
        has_numbers = bool(re.search(r"(\d[\d.,]*\s*%)|\b(usd|monto|cuota|ingres|venta|flujo|ebitda|margen|utilidad|liquidez|deuda|apalancamiento|dscr|cobertura|plazo|tasa|balance|patrimonio)\b", lower)) if text else False

        if text:
            paragraphs = [
                f"Respecto de {client_label}, con una exposición solicitada de {amount_text} y un nivel de riesgo {risk_label}, el análisis de {subject_focus} se sustenta en la información registrada: {text}"
            ]
            if has_numbers:
                implications = "Las cifras y referencias cuantitativas consignadas deben contrastarse con la exposición solicitada y con los soportes del expediente para confirmar la capacidad de atender las obligaciones y la consistencia de los supuestos."
            elif positive and not negative:
                implications = "La información disponible muestra elementos favorables para el sujeto de crédito, aunque su alcance y vigencia deben confirmarse con evidencia verificable y en coherencia con el resto del caso."
            elif negative and not positive:
                implications = "Los elementos registrados evidencian debilidades o presiones relevantes que inciden en la capacidad de repago y en el nivel de riesgo asumido frente al monto solicitado, por lo que requieren mitigación o condiciones proporcionales."
            else:
                implications = "De la información disponible se desprenden elementos que deben valorarse por su impacto directo en la capacidad de repago, la exposición asumida y la consistencia del caso, sin asumir datos no acreditados."
            if pending:
                implications += " La presencia de datos pendientes o no informados limita la conclusividad del análisis y debe resolverse o condicionarse según corresponda."
            paragraphs.append(implications)
            if attachment_name:
                paragraphs.append(f"Se deja constancia del soporte incorporado «{attachment_name}», cuyo contenido debe conciliarse con lo consignado y conservarse como evidencia del análisis.")
            return join_paragraphs(*paragraphs)

        missing = (
            f"Para {client_label}, con una exposición solicitada de {amount_text} y riesgo {risk_label}, no se cuenta con información suficiente para analizar {subject_focus}. "
            f"{missing_impact}"
        )
        return join_paragraphs(missing)

    profile_body = section_analysis(
        profile,
        "su perfil, actividad, trayectoria y factores cualitativos relevantes para la operación",
        "Esta carencia impide evaluar con sustento la solidez cualitativa del sujeto y su consistencia con la operación solicitada.",
    )
    financial_body = section_analysis(
        analisis_financiero,
        "su situación financiera, ingresos, obligaciones, flujos e indicadores, así como su capacidad de pago frente al monto solicitado",
        "Sin cifras y soportes financieros verificables no es posible determinar la holgura o presión para atender la deuda ni la viabilidad de repago de la exposición.",
        analisis_financiero_attachment,
    )
    guarantees_body = section_analysis(
        garantias,
        "las garantías y mitigantes disponibles, su cobertura, calidad y ejecutabilidad frente a la exposición",
        "La ausencia de información impide valorar el respaldo secundario de repago y su efecto sobre la severidad potencial de pérdida.",
        garantias_attachment,
    )
    conditions_body = section_analysis(
        condiciones,
        "los términos y condiciones propuestos de la operación (monto, plazo, tasa, forma de pago, destino y controles)",
        "Sin condiciones definidas no es posible contrastar su adecuación con la capacidad de pago del sujeto, el monto solicitado y el nivel de riesgo.",
        condiciones_attachment,
    )
    observations_body = section_analysis(
        observations,
        "los hallazgos, alertas, inconsistencias y aspectos que requieren gestión o seguimiento en el caso",
        "No se registraron observaciones adicionales; se recomienda confirmar expresamente la ausencia de alertas o dejar constancia de cualquier limitación identificada en la revisión del expediente.",
    )
    recommendation_body = section_analysis(
        recommendation,
        "la recomendación crediticia propuesta y su coherencia con la evidencia del caso",
        "En ausencia de una postura expresa y fundamentada no es posible concluir la decisión sobre la operación solicitada.",
    )

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

    identification = (
        f"El análisis crediticio corresponde a {client_label}, sujeto de crédito de tipo {client_type or 'no informado'}, evaluado en el marco de un análisis {analysis_type or 'no informado'}. "
        f"La operación se vincula a la Línea de crédito {linea_credito or 'no informada'} por un MONTO solicitado de {amount_text}, presentada por el PROPONENTE {proponente or 'no informado'}"
        f"{', perteneciente al grupo económico ' + grupo_economico if grupo_economico else ', sin grupo económico informado'}, con un nivel de riesgo registrado de {risk_label}. "
        f"Estos elementos identifican al sujeto evaluado, la exposición requerida y el marco de la solicitud sobre los cuales se desarrolla el análisis."
    )

    decision_sentence = build_conclusion_statement(recommendation, condiciones, client_name)
    executive_summary = (
        f"El caso de {client_label} considera una exposición solicitada de {amount_text} en la Línea de crédito {linea_credito or 'no informada'} (análisis {analysis_type or 'no informado'}), con un nivel de riesgo {risk_label}. "
        f"Del análisis realizado, {informed_count} de {len(sections_state)} componentes cuentan con información sustantiva y los soportes anexos registrados son: {', '.join(anexos)}. "
        f"{decision_sentence}"
    )

    evidence_limitations = []
    if not _acta_has_text(analisis_financiero):
        evidence_limitations.append("la ausencia de información financiera verificable impide cuantificar con certeza la capacidad de pago")
    if not _acta_has_text(garantias):
        evidence_limitations.append("no se puede medir la cobertura de respaldos sobre la exposición")
    if not _acta_has_text(condiciones):
        evidence_limitations.append("no es posible contrastar la adecuación de los términos de la operación")
    methodology = (
        f"El análisis de {client_label} se sustenta en la información consignada en el formulario, la narrativa de las secciones y los anexos incorporados al expediente, contrastando el perfil del sujeto, su capacidad de pago frente al MONTO de {amount_text}, el nivel de riesgo {risk_label}, los mitigantes, las condiciones y los hallazgos documentados. "
        "Las conclusiones se formulan únicamente con base en datos y evidencias disponibles; no se infieren cifras, hechos o coberturas no acreditadas."
    )
    if evidence_limitations:
        methodology += " Como limitaciones relevantes para este caso, " + "; ".join(evidence_limitations) + "."

    has_fin = _acta_has_text(analisis_financiero)
    has_gua = _acta_has_text(garantias)
    has_con = _acta_has_text(condiciones)
    risk_body_parts = [
        f"Para {client_label}, el nivel de riesgo registrado es {risk_label} frente a una exposición de {amount_text}; esta lectura debe sustentarse en la capacidad de pago del sujeto, la estabilidad de su fuente de repago, la calidad de los mitigantes y la coherencia de los términos propuestos."
    ]
    if has_fin:
        risk_body_parts.append("La información financiera consignada permite analizar la relación entre ingresos o flujos, obligaciones y la cuota o carga asociada a la operación, aunque sus cifras deben conciliarse con soportes.")
    else:
        risk_body_parts.append("Al no disponerse de información financiera verificable, no es posible acreditar que los ingresos o flujos del sujeto cubran con holgura la exposición solicitada, lo que incrementa la incertidumbre del riesgo.")
    if has_gua:
        risk_body_parts.append("Las garantías o mitigantes registrados aportan un respaldo secundario cuya eficacia depende de su cobertura real y ejecutabilidad frente al monto solicitado.")
    else:
        risk_body_parts.append("No se identifican garantías o mitigantes documentados que reduzcan la severidad de una eventual pérdida sobre la exposición.")
    if has_con:
        risk_body_parts.append("Las condiciones propuestas deben evaluarse por su compatibilidad con la capacidad de pago demostrada y con el nivel de riesgo del caso.")
    else:
        risk_body_parts.append("La ausencia de condiciones definidas impide valorar si la estructura de la operación es adecuada para el perfil de riesgo y la capacidad de pago del sujeto.")
    risk_body = " ".join(risk_body_parts)

    traceability_parts = [
        "la identificación y los campos narrativos del expediente se encuentran registrados de forma parcial o total",
        f"el anexo financiero se encuentra {'incorporado (' + analisis_financiero_attachment + ')' if analisis_financiero_attachment else 'no incorporado'}",
        f"el anexo de garantías se encuentra {'incorporado (' + garantias_attachment + ')' if garantias_attachment else 'no incorporado'}",
        f"el anexo de condiciones se encuentra {'incorporado (' + condiciones_attachment + ')' if condiciones_attachment else 'no incorporado'}",
    ]
    traceability_body = (
        f"Para sustentar el análisis de {client_label}, " + "; ".join(traceability_parts) + ". "
        "Cada conclusión sobre el sujeto, sus cifras y los respaldos debe poder vincularse a datos o documentos verificables; la falta de soporte suficiente se considera una limitación del expediente."
    )

    pending_items = []
    if not _acta_has_text(profile):
        pending_items.append("documentar el perfil, actividad y antecedentes cualitativos del sujeto para sustentar el análisis")
    if not _acta_has_text(analisis_financiero):
        pending_items.append("incorporar y sustentar con cifras y soportes la capacidad de pago del sujeto frente al monto solicitado")
    if not _acta_has_text(garantias):
        pending_items.append("definir garantías o mitigantes, su cobertura y ejecutabilidad, o dejar constancia expresa de su inexistencia")
    if not _acta_has_text(condiciones):
        pending_items.append("precisar los términos de la operación (monto, plazo, tasa, forma de pago, destino y controles)")
    if not _acta_has_text(recommendation):
        pending_items.append("emitir una recomendación crediticia expresa y fundamentada")
    if decision == "aprobar_con_condiciones" and not _acta_has_text(condiciones) and "condici" not in recommendation_text.casefold():
        pending_items.append("detallar las condiciones o mitigantes que sustentan una recomendación condicionada")
    if decision == "aprobar" and not _acta_has_text(analisis_financiero):
        pending_items.append("acreditar la capacidad de pago del sujeto antes de una decisión favorable")
    for label, text_value in [
        ("Perfil del cliente", profile), ("Análisis financiero y capacidad de pago", analisis_financiero),
        ("Garantías y mitigantes", garantias), ("Condiciones propuestas", condiciones),
        ("Observaciones", observations), ("Recomendación y fundamento", recommendation),
    ]:
        lower = (text_value or "").casefold()
        if any(token in lower for token in ["pendiente", "por confirmar", "por definir", "no informado", "sin información", "sin informacion", "n/a", "no disponible"]):
            pending_items.append(f"completar y sustentar los elementos pendientes o no informados en «{label}»")
    seen = set()
    deduped = []
    for item in pending_items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    if deduped:
        follow_up_body = (
            f"Para fortalecer el análisis de {client_label} y la sustentación de la decisión, deben atenderse los siguientes aspectos: "
            + "; ".join(deduped)
            + ". Su cierre oportuno es necesario para respaldar con evidencia la evaluación del sujeto y sus números."
        )
    else:
        follow_up_body = (
            f"No se identifican pendientes explícitos en la información registrada para {client_label}; aun así, corresponde verificar la documentación soporte, la vigencia de las cifras y el cumplimiento de las condiciones aplicables."
        )

    quantitative_parts = [
        f"exposición solicitada (MONTO): {amount_text}",
        f"nivel de riesgo registrado: {risk_label}",
        f"componentes con información sustantiva: {informed_count} de {len(sections_state)}",
        f"soportes anexos: {', '.join(anexos)}",
    ]
    quantitative_body = (
        f"Los datos cuantitativos y de soporte disponibles para el análisis de {client_label} son: " + "; ".join(quantitative_parts) + ". "
        "Las cifras, tablas o gráficos contenidos en los anexos y en la información financiera deben conciliarse con el análisis narrativo para evaluar la capacidad de pago frente a la exposición y la consistencia del caso."
    )
    if not _acta_has_text(analisis_financiero):
        quantitative_body += " Al no existir un detalle financiero narrativo, no es posible en esta acta derivar ni analizar indicadores, flujos o series numéricas del sujeto más allá de los datos de identificación registrados."

    conclusion_detail = build_conclusion_statement(recommendation, condiciones, client_name)
    conclusion_body = (
        f"{conclusion_detail}\n\n"
        f"La conclusión sobre {client_label} se fundamenta en la consistencia entre su perfil, la capacidad de pago frente al MONTO solicitado ({amount_text}), el nivel de riesgo ({risk_label}), los mitigantes, las condiciones y los hallazgos documentados. "
        "Cualquier dato no disponible, inconsistente o pendiente debe resolverse, condicionarse o mantenerse en seguimiento, sin inferir cifras, garantías u obligaciones no acreditadas."
    )

    return join_paragraphs(
        "COMISIÓN DE CRÉDITO – COMITÉ EJECUTIVO",
        "ACTA DE ANÁLISIS Y RESOLUCIÓN DE LA OPERACIÓN",
        "RESUMEN EJECUTIVO\n\n" + executive_summary,
        "IDENTIFICACIÓN DEL CLIENTE Y NATURALEZA DE LA PRESENTACIÓN\n\n" + identification,
        "ALCANCE Y BASE DE EVIDENCIA\n\n" + methodology,
        "PERFIL DEL CLIENTE\n\n" + profile_body,
        "ANÁLISIS FINANCIERO Y CAPACIDAD DE PAGO\n\n" + financial_body,
        "NIVEL DE RIESGO\n\n" + risk_body,
        "GARANTÍAS Y MITIGANTES\n\n" + guarantees_body,
        "CONDICIONES PROPUESTAS\n\n" + conditions_body,
        "OBSERVACIONES\n\n" + observations_body,
        "RECOMENDACIÓN Y FUNDAMENTO\n\n" + recommendation_body,
        "TRAZABILIDAD Y SOPORTES\n\n" + traceability_body,
        "ANÁLISIS GRÁFICO E HISTÓRICO\n\n" + quantitative_body,
        "PENDIENTES, CONDICIONES Y SEGUIMIENTO\n\n" + follow_up_body,
        "CONCLUSIÓN\n\n" + conclusion_body,
    )



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
