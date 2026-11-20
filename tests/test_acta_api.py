import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from app import app, init_db


def make_docx(content):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", content)
    buffer.seek(0)
    return buffer


class TestActaApi(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_database_path = app.config["DATABASE_PATH"]
        self.original_frontend_dist = app.config["FRONTEND_DIST"]
        app.config["DATABASE_PATH"] = f"{self.temp_dir.name}/actas.sqlite3"
        app.config["TESTING"] = True
        init_db()
        self.client = app.test_client()

    def tearDown(self):
        app.config["DATABASE_PATH"] = self.original_database_path
        app.config["FRONTEND_DIST"] = self.original_frontend_dist
        app.config["TESTING"] = False
        self.temp_dir.cleanup()

    def acta_data(self, **overrides):
        data = {
            "clientName": "Ana López",
            "clientType": "PYME",
            "analysisType": "Crédito ordinario",
            "line": "Crédito productivo",
            "proposal": "María Paredes",
            "amount": 120000,
            "risk": "Medio",
            "group": "Grupo de servicios",
            "profile": "Perfil empresarial",
            "financial": "Flujo estable",
            "guarantees": "Prenda sobre activos",
            "conditions": "Plazo de 24 meses",
            "recommendation": "Aprobar con condiciones",
            "observations": "Revisión favorable",
        }
        data.update(overrides)
        return data

    def submit_acta(self, method="post", acta_id=None, data=None, word=None, **extra_fields):
        form_data = {
            "data": json.dumps(data or self.acta_data()),
            "remove_attachments": "[]",
            "word": (make_docx(word or "Acta guardada"), "Acta-comite.docx"),
        }
        form_data.update(extra_fields)
        route = "/api/actas" if acta_id is None else f"/api/actas/{acta_id}"
        return getattr(self.client, method)(route, data=form_data, content_type="multipart/form-data")

    def test_create_list_update_download_and_delete_acta_with_attachment(self):
        create = self.submit_acta(
            attachment_financial=(io.BytesIO(b"excel original"), "balance.xlsx")
        )
        self.assertEqual(create.status_code, 201)
        acta_id = create.json["id"]

        listing = self.client.get("/api/actas")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json[0]["clientName"], "Ana López")

        detail = self.client.get(f"/api/actas/{acta_id}")
        self.assertEqual(detail.json["attachments"]["financial"]["filename"], "balance.xlsx")

        word = self.client.get(f"/api/actas/{acta_id}/word")
        self.assertEqual(word.status_code, 200)
        self.assertEqual(word.data, make_docx("Acta guardada").getvalue())

        attachment = self.client.get(f"/api/actas/{acta_id}/attachments/financial")
        self.assertEqual(attachment.data, b"excel original")

        update = self.submit_acta(
            method="put",
            acta_id=acta_id,
            data=self.acta_data(clientName="Ana López Actualizada"),
            word="Acta actualizada",
        )
        self.assertEqual(update.status_code, 200)
        detail = self.client.get(f"/api/actas/{acta_id}")
        self.assertEqual(detail.json["data"]["clientName"], "Ana López Actualizada")
        self.assertEqual(detail.json["attachments"]["financial"]["filename"], "balance.xlsx")
        self.assertEqual(
            self.client.get(f"/api/actas/{acta_id}/word").data,
            make_docx("Acta actualizada").getvalue(),
        )

        remove_attachment = self.submit_acta(
            method="put",
            acta_id=acta_id,
            data=self.acta_data(clientName="Ana López Actualizada"),
            remove_attachments=json.dumps(["financial"]),
        )
        self.assertEqual(remove_attachment.status_code, 200)
        self.assertNotIn(
            "financial",
            self.client.get(f"/api/actas/{acta_id}").json["attachments"],
        )
        self.assertEqual(self.client.delete(f"/api/actas/{acta_id}").status_code, 204)
        self.assertEqual(self.client.get("/api/actas").json, [])
        self.assertEqual(self.client.get(f"/api/actas/{acta_id}").status_code, 404)

    def test_rejects_invalid_fields_and_invalid_word_files(self):
        invalid_data = self.submit_acta(data={"clientName": ""})
        self.assertEqual(invalid_data.status_code, 400)
        self.assertIn("error", invalid_data.json)
        invalid_amount = self.submit_acta(data=self.acta_data(amount=-1))
        self.assertEqual(invalid_amount.status_code, 400)

        invalid_word = self.client.post(
            "/api/actas",
            data={
                "data": json.dumps(self.acta_data()),
                "word": (io.BytesIO(b"not a zip"), "acta.docx"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(invalid_word.status_code, 400)

    def test_missing_record_and_invalid_attachment_section_return_404(self):
        self.assertEqual(self.client.get("/api/actas/inexistente").status_code, 404)
        self.assertEqual(
            self.client.get("/api/actas/inexistente/attachments/unknown").status_code,
            404,
        )
        self.assertEqual(self.client.delete("/api/actas/inexistente").status_code, 404)

    def test_serves_compiled_frontend_and_ocr_resources(self):
        app.config["FRONTEND_DIST"] = str(Path(app.root_path) / "frontend" / "dist")
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Generador de actas de comité", page.get_data(as_text=True))
        page.close()
        for resource in (
            "/tesseract/worker.min.js",
            "/tesseract/spa.traineddata",
            "/tesseract/core/tesseract-core-lstm.wasm",
        ):
            with self.subTest(resource=resource):
                response = self.client.get(resource)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_empty_amount_can_be_saved_without_demo_values(self):
        response = self.submit_acta(data=self.acta_data(amount=""))
        self.assertEqual(response.status_code, 201)
        acta = self.client.get(f"/api/actas/{response.json['id']}")
        self.assertEqual(acta.json["data"]["amount"], "")

    def test_create_accepts_acta_data_wrapped_in_data_field(self):
        response = self.submit_acta(data={"data": self.acta_data()})
        self.assertEqual(response.status_code, 201)
        acta = self.client.get(f"/api/actas/{response.json['id']}")
        self.assertEqual(acta.json["data"]["clientName"], "Ana López")


if __name__ == "__main__":
    unittest.main()
