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
        self.assertIn("Línea de crédito", acta)
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

    def test_generate_acta_uses_exhaustive_narrative_sections(self):
        acta = generate_acta(
            client_name="Ana López",
            client_type="pyme",
            analysis_type="crédito ordinario",
            amount=120000,
            risk_level="medio",
            recommendation="Aprobar con seguimiento mensual",
            observations="El flujo de caja requiere conciliación.",
            proponente="Maria Paredes",
            linea_credito="Crédito productivo",
            grupo_economico="Grupo de servicios",
            analisis_financiero="- Ingresos recurrentes\n- Flujo operativo cubre la cuota",
            garantias="Hipoteca de primer grado.",
            condiciones="Plazo de 36 meses.",
            profile="- Antigüedad: 10 años\n- Actividad: servicios",
        )

        self.assertIn("IDENTIFICACIÓN DEL CLIENTE", acta)
        self.assertIn("PERFIL DEL CLIENTE", acta)
        self.assertIn("ANÁLISIS FINANCIERO Y CAPACIDAD DE PAGO", acta)
        self.assertIn("RECOMENDACIÓN Y FUNDAMENTO", acta)
        self.assertIn("ANÁLISIS GRÁFICO E HISTÓRICO", acta)
        self.assertIn("Ingresos recurrentes", acta)
        self.assertIn("- Ingresos recurrentes", acta)
        self.assertIn("- Antigüedad: 10 años", acta)
        self.assertIn("Ana López", acta)
        self.assertIn("120,000.00", acta)
        self.assertIn("capacidad de pago", acta.casefold())


if __name__ == "__main__":
    unittest.main()
