import unittest

from app import generate_acta


class TestActaGenerator(unittest.TestCase):
    def test_generate_acta_includes_main_sections(self):
        acta = generate_acta(
            client_name="Ana López",
            client_type="persona natural",
            analysis_type="crédito ordinario",
            amount=120000,
            risk_level="medio",
            recommendation="Aprobar con condiciones",
            observations="Buena historial de pagos y estabilidad laboral.",
            proponente="Maria Paredes",
            linea_credito="Crédito productivo",
            grupo_economico="Grupo de servicios",
            analisis_financiero="Ingresos estables y liquidez adecuada.",
            garantias="Prenda sobre activos de la empresa.",
            condiciones="Plazo 24 meses con cuota mensual fija.",
        )

        self.assertIn("COMISIÓN DE CRÉDITO – COMITÉ EJECUTIVO", acta)
        self.assertIn("LÍNEA DE CRÉDITO", acta)
        self.assertIn("MONTO", acta)
        self.assertIn("PROPONENTE", acta)
        self.assertIn("ANÁLISIS FINANCIERO", acta)
        self.assertIn("GARANTÍAS", acta)
        self.assertIn("RECOMENDACIÓN", acta)
        self.assertIn("Ana López", acta)

    def test_generate_acta_includes_attachment_reference(self):
        acta = generate_acta(
            client_name="Ana López",
            client_type="persona natural",
            analysis_type="crédito ordinario",
            amount=120000,
            risk_level="medio",
            recommendation="Aprobar con condiciones",
            observations="Buena historial de pagos.",
            analisis_financiero="Estabilidad financiera confirmada.",
            garantias="Prenda sobre vehículo.",
            condiciones="Plazo 24 meses.",
            analisis_financiero_attachment="balance.jpg",
        )

        self.assertIn("balance.jpg", acta)


if __name__ == "__main__":
    unittest.main()
