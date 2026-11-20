import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOMParser } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { readPowerPoint } from '../src/powerpoint.js'

globalThis.DOMParser = DOMParser

function slideXml(paragraphs) {
  const content = paragraphs.map((paragraph) => `<a:p><a:r><a:t>${paragraph}</a:t></a:r></a:p>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${content}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
}

test('reads labeled customer fields from editable PPTX slide text', async () => {
  const archive = new JSZip()
  archive.file('ppt/slides/slide1.xml', slideXml([
    'Cliente: Industrias Andinas',
    'Tipo de cliente: PYME',
    'Monto solicitado: USD 1,250,000',
    'Análisis financiero: Flujo operativo estable durante el último año.',
    'Garantías: Hipoteca de primer grado.',
    'Condiciones: Plazo de 24 meses.',
  ]))
  archive.file('ppt/slides/slide2.xml', slideXml(['Recomendación: Aprobar con seguimiento trimestral.']))
  const contents = await archive.generateAsync({ type: 'nodebuffer' })
  const file = new Blob([contents])
  Object.defineProperty(file, 'name', { value: 'caso-comite.pptx' })

  const result = await readPowerPoint(file)

  assert.equal(result.slideCount, 2)
  assert.equal(result.fields.clientName, 'Industrias Andinas')
  assert.equal(result.fields.clientType, 'PYME')
  assert.equal(result.fields.amount, '1250000')
  assert.equal(result.fields.financial, 'Flujo operativo estable durante el último año.')
  assert.equal(result.fields.guarantees, 'Hipoteca de primer grado.')
  assert.equal(result.fields.conditions, 'Plazo de 24 meses.')
  assert.equal(result.fields.recommendation, 'Aprobar con seguimiento trimestral.')
  assert.equal(result.fields.risk, '')
})

test('extracts every credit acta field from one PowerPoint with common label variants', async () => {
  const archive = new JSZip()
  archive.file('ppt/slides/slide1.xml', slideXml([
    'RAZON SOCIAL: Industrias Andinas',
    'TIPO DE CLIENTE: Corporativo',
    'TIPO DE OPERACION: Crédito ordinario',
    'PRODUCTO CREDITICIO: Línea productiva',
    'PROPONENTE: Juan Pérez',
    'MONTO DE LA OPERACIÓN: USD 1.250.000',
    'Nivel riesgo: Alto',
    'GRUPO EMPRESARIAL: Grupo Andino',
    'ACTIVIDAD ECONÓMICA: Producción agrícola',
    'CAPACIDAD DE PAGO: Flujo operativo estable.',
    'GARANTIAS: Hipoteca de primer grado.',
    'PLAZO Y CONDICIONES: 24 meses con revisión anual.',
    'RECOMENDACION: Aprobar con seguimiento.',
    'COMENTARIOS: Documentación revisada.',
  ]))
  const contents = await archive.generateAsync({ type: 'nodebuffer' })
  const file = new Blob([contents])
  Object.defineProperty(file, 'name', { value: 'acta-completa.pptx' })

  const result = await readPowerPoint(file)

  assert.equal(result.fieldCount, 14)
  assert.deepEqual(result.fields, {
    clientName: 'Industrias Andinas',
    clientType: 'Corporativo',
    analysisType: 'Crédito ordinario',
    line: 'Línea productiva',
    proposal: 'Juan Pérez',
    amount: '1250000',
    risk: 'Alto',
    group: 'Grupo Andino',
    profile: 'Producción agrícola',
    financial: 'Flujo operativo estable.',
    guarantees: 'Hipoteca de primer grado.',
    conditions: '24 meses con revisión anual.',
    recommendation: 'Aprobar con seguimiento.',
    observations: 'Documentación revisada.',
  })
})

test('extracts multiple labeled fields placed on the same PowerPoint line', async () => {
  const archive = new JSZip()
  archive.file('ppt/slides/slide1.xml', slideXml([
    'Cliente: Industrias Andinas Monto: USD 75.000 Proponente: Ana López Nivel de riesgo: Medio',
  ]))
  const contents = await archive.generateAsync({ type: 'nodebuffer' })
  const file = new Blob([contents])
  Object.defineProperty(file, 'name', { value: 'acta-en-linea.pptx' })

  const result = await readPowerPoint(file)

  assert.equal(result.fields.clientName, 'Industrias Andinas')
  assert.equal(result.fields.amount, '75000')
  assert.equal(result.fields.proposal, 'Ana López')
  assert.equal(result.fields.risk, 'Medio')
})

test('extracts table, bullet and alternate Spanish label variants', async () => {
  const archive = new JSZip()
  archive.file('ppt/slides/slide1.xml', slideXml([
    '• Naturaleza del cliente: PYME',
    'Tipo de operación  Crédito ordinario',
    'Presentado por: Ana López',
    'Monto solicitado | USD 75.000',
    'Rating | Medio',
    'Conglomerado: Grupo Andino',
    'Condicionamientos:',
    'Plazo de 24 meses',
    'Sentido de recomendación: Aprobar',
    'Notas: Documentación revisada',
  ]))
  const contents = await archive.generateAsync({ type: 'nodebuffer' })
  const file = new Blob([contents])
  Object.defineProperty(file, 'name', { value: 'acta-variantes.pptx' })

  const result = await readPowerPoint(file)

  assert.equal(result.fields.clientType, 'PYME')
  assert.equal(result.fields.analysisType, 'Crédito ordinario')
  assert.equal(result.fields.proposal, 'Ana López')
  assert.equal(result.fields.amount, '75000')
  assert.equal(result.fields.risk, 'Medio')
  assert.equal(result.fields.group, 'Grupo Andino')
  assert.equal(result.fields.conditions, 'Plazo de 24 meses')
  assert.equal(result.fields.recommendation, 'Aprobar')
  assert.equal(result.fields.observations, 'Documentación revisada')
})

test('rejects legacy PowerPoint files with a clear message', async () => {
  const file = new Blob([])
  Object.defineProperty(file, 'name', { value: 'caso-comite.ppt' })

  await assert.rejects(readPowerPoint(file), /\.pptx/)
})

test('maps OCR text from images referenced by a slide', async () => {
  const archive = new JSZip()
  const slide = `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rIdImage" /></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`
  const relationships = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png" /></Relationships>`
  archive.file('ppt/slides/slide1.xml', slide)
  archive.file('ppt/slides/_rels/slide1.xml.rels', relationships)
  archive.file('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71]))
  const contents = await archive.generateAsync({ type: 'nodebuffer' })
  const file = new Blob([contents])
  Object.defineProperty(file, 'name', { value: 'caso-con-imagen.pptx' })

  const result = await readPowerPoint(file, {
    recognizeImages: async (images) => {
      assert.equal(images.length, 1)
      assert.equal(images[0].mimeType, 'image/png')
      return ['Monto solicitado: USD 750,000', 'Garantías: Hipoteca detectada por OCR']
    },
  })

  assert.equal(result.ocrImageCount, 1)
  assert.equal(result.fields.amount, '750000')
  assert.equal(result.fields.guarantees, 'Hipoteca detectada por OCR')
})
