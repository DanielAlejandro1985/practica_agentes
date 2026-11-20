import JSZip from 'jszip'

const MAX_PRESENTATION_SIZE = 20 * 1024 * 1024
const DRAWING_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const imageMimeTypes = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const fieldLabels = {
  clientName: ['Nombre del cliente', 'Razón social', 'Nombre de la empresa', 'Nombres y apellidos', 'Cliente', 'Empresa', 'Deudor'],
  clientType: ['Tipo de cliente', 'Tipo cliente', 'Naturaleza del cliente', 'Tipo persona', 'Segmento de cliente', 'Segmento'],
  analysisType: ['Tipo de análisis', 'Tipo analisis', 'Tipo de operación', 'Tipo operacion', 'Tipo de solicitud', 'Tipo de crédito', 'Modalidad', 'Análisis solicitado'],
  line: ['Línea de crédito', 'Línea', 'Producto crediticio', 'Producto', 'Subproducto'],
  proposal: ['Nombre del proponente', 'Proponente', 'Propuesto por', 'Presentado por', 'Promotor', 'Oficial de crédito', 'Ejecutivo responsable', 'Responsable del caso'],
  amount: ['Monto solicitado', 'Monto de la operación', 'Monto de crédito', 'Monto aprobado', 'Monto', 'Valor solicitado', 'Valor de la operación'],
  risk: ['Nivel de riesgo', 'Nivel riesgo', 'Clasificación de riesgo', 'Clasificación crediticia', 'Riesgo integral', 'Calificación de riesgo', 'Rating', 'Riesgo'],
  group: ['Grupo económico', 'Grupo empresarial', 'Conglomerado', 'Grupo del cliente'],
  profile: ['Perfil del cliente', 'Actividad económica', 'Descripción del cliente', 'Antecedentes del cliente'],
  financial: ['Análisis financiero', 'Analisis financiero', 'Situación financiera', 'Indicadores financieros', 'Capacidad de pago', 'Análisis de capacidad de pago'],
  guarantees: ['Garantías propuestas', 'Garantias propuestas', 'Garantías', 'Garantias', 'Garantía propuesta', 'Cobertura de garantías', 'Garantía'],
  conditions: ['Condiciones propuestas', 'Condiciones', 'Plazo y condiciones', 'Términos y condiciones', 'Condicionamientos'],
  recommendation: ['Recomendación', 'Recomendacion', 'Decisión recomendada', 'Sentido de recomendación', 'Propuesta de resolución', 'Resolución propuesta', 'Resolución'],
  observations: ['Observaciones', 'Comentarios adicionales', 'Comentarios', 'Conclusiones', 'Notas'],
}

const labelEntries = Object.entries(fieldLabels)
  .flatMap(([field, labels]) => labels.map((label) => ({ field, label })))
  .sort((left, right) => right.label.length - left.label.length)
const allLabelsPattern = labelEntries
  .map(({ label }) => accentInsensitivePattern(label))
  .join('|')
const fieldByNormalizedLabel = new Map(
  labelEntries.map(({ field, label }) => [label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es'), field]),
)

function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeLine(value) {
  return cleanText(value)
    .replace(/^[•●▪◦\-–—]+\s*/, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function accentInsensitivePattern(value) {
  const accentPatterns = {
    a: '[aáàäâ]',
    e: '[eéèëê]',
    i: '[iíìïî]',
    o: '[oóòöô]',
    u: '[uúùüû]',
    n: '[nñ]',
  }
  return Array.from(value, (character) => {
    if (/\s/.test(character)) return '\\s+'
    const normalized = character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
    return accentPatterns[normalized] || escapeRegExp(character)
  }).join('')
}

function findLabel(line) {
  const normalizedLine = normalizeLine(line)
  for (const entry of labelEntries) {
    const pattern = new RegExp(`^\\s*${accentInsensitivePattern(entry.label)}\\s*(?::|[\\-–—|]|\\t)?\\s*(.*)$`, 'i')
    const match = normalizedLine.match(pattern)
    if (match) return { ...entry, value: cleanText(match[1]) }
  }
  return null
}

function valueBeforeNextLabel(value) {
  const nextLabelPattern = new RegExp(`\\s+(?=(?:${allLabelsPattern})\\s*(?::|[\\-–—]))`, 'i')
  return cleanText(value.split(nextLabelPattern, 1)[0])
}

function extractFields(lines) {
  const fields = Object.fromEntries(Object.keys(fieldLabels).map((field) => [field, '']))
  const inlineLabelPattern = new RegExp(`(?:^|\\s)(${allLabelsPattern})\\s*(?::|[\\-–—|]|\\t)\\s*`, 'gi')
  const presentationLines = lines
    .flatMap((line) => line.split(/\t|\u00a0{2,}|[|]/).map(normalizeLine))
    .filter(Boolean)

  for (const line of presentationLines) {
    const matches = Array.from(line.matchAll(inlineLabelPattern))
    for (const [index, match] of matches.entries()) {
      const label = match[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es')
      const field = fieldByNormalizedLabel.get(label)
      const valueStart = match.index + match[0].length
      const valueEnd = matches[index + 1]?.index ?? line.length
      const value = cleanText(line.slice(valueStart, valueEnd))
      if (field && value && !fields[field]) fields[field] = value
    }
  }

  for (let index = 0; index < presentationLines.length; index += 1) {
    const match = findLabel(presentationLines[index])
    if (!match) continue

    let value = valueBeforeNextLabel(match.value)
    if (!value) {
      for (let nextIndex = index + 1; nextIndex < presentationLines.length; nextIndex += 1) {
        const nextLabel = findLabel(presentationLines[nextIndex])
        if (nextLabel) break
        value = cleanText(presentationLines[nextIndex])
        if (value) break
      }
    }
    if (value && !fields[match.field]) fields[match.field] = value
  }

  return fields
}

function parseAmount(value) {
  if (!value) return ''
  const numeric = value.replace(/[^\d.,-]/g, '')
  if (!numeric) return ''

  const lastComma = numeric.lastIndexOf(',')
  const lastDot = numeric.lastIndexOf('.')
  let normalized = numeric

  if (lastComma > lastDot) {
    normalized = /,\d{1,2}$/.test(numeric)
      ? numeric.replace(/\./g, '').replace(/,([^,]*)$/, '.$1')
      : numeric.replace(/[,.]/g, '')
  } else if (lastDot > lastComma && lastComma >= 0) {
    normalized = numeric.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(numeric) ? numeric.replace(',', '.') : numeric.replace(/,/g, '')
  } else if (lastDot >= 0 && !/\.\d{1,2}$/.test(numeric)) {
    normalized = numeric.replace(/\./g, '')
  }

  const amount = Number(normalized)
  return Number.isFinite(amount) ? String(amount) : ''
}

function matchChoice(value, choices) {
  const normalized = value.toLocaleLowerCase('es')
  return choices.find((choice) => normalized.includes(choice.toLocaleLowerCase('es'))) || ''
}

function parseXml(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length > 0) throw new Error('Una diapositiva tiene XML inválido.')
  return xml
}

function extractParagraphs(xml) {
  return Array.from(xml.getElementsByTagNameNS(DRAWING_NAMESPACE, 'p'))
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(DRAWING_NAMESPACE, 't'))
      .map((textNode) => textNode.textContent || '')
      .join(''))
    .map(cleanText)
    .filter(Boolean)
}

function resolveArchivePath(basePath, target) {
  const path = target.startsWith('/') ? target.slice(1) : `${basePath}/${target}`
  const parts = []

  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return parts.join('/')
}

async function getSlideImages(archive, slidePath, slideXml) {
  const imageIds = Array.from(slideXml.getElementsByTagNameNS(DRAWING_NAMESPACE, 'blip'))
    .map((image) => image.getAttributeNS(OFFICE_RELATIONSHIP_NAMESPACE, 'embed'))
    .filter(Boolean)
  if (imageIds.length === 0) return []

  const fileName = slidePath.split('/').pop()
  const relationshipsPath = `ppt/slides/_rels/${fileName}.rels`
  const relationshipsFile = archive.file(relationshipsPath)
  if (!relationshipsFile) return []

  const relationshipsXml = parseXml(await relationshipsFile.async('text'))
  const relationships = new Map(
    Array.from(relationshipsXml.getElementsByTagNameNS(RELATIONSHIP_NAMESPACE, 'Relationship'))
      .filter((relationship) => relationship.getAttribute('Type').endsWith('/image'))
      .map((relationship) => [relationship.getAttribute('Id'), relationship.getAttribute('Target')]),
  )
  const basePath = slidePath.slice(0, slidePath.lastIndexOf('/'))
  const images = []

  for (const imageId of new Set(imageIds)) {
    const target = relationships.get(imageId)
    if (!target) continue
    const imagePath = resolveArchivePath(basePath, target)
    const extension = imagePath.split('.').pop().toLowerCase()
    const mimeType = imageMimeTypes[extension]
    const imageFile = archive.file(imagePath)
    if (!mimeType || !imageFile) continue

    images.push({
      data: await imageFile.async('uint8array'),
      mimeType,
      path: imagePath,
    })
  }

  return images
}

async function recognizeImagesWithTesseract(images, onProgress) {
  const { createWorker } = await import('tesseract.js')
  let currentImage = 0
  const worker = await createWorker('spa', 1, {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract',
    gzip: false,
    logger: ({ status, progress = 0 }) => {
      if (status === 'recognizing text') {
        onProgress({ phase: 'ocr', stage: status, progress: (currentImage + progress) / images.length })
      } else {
        onProgress({ phase: 'ocr', stage: status, progress })
      }
    },
  })
  const recognizedText = []

  try {
    for (const [index, image] of images.entries()) {
      currentImage = index
      const { data } = await worker.recognize(new Blob([image.data], { type: image.mimeType }))
      recognizedText.push(data.text)
      onProgress({ phase: 'ocr', progress: (index + 1) / images.length })
    }
  } finally {
    await worker.terminate()
  }

  return recognizedText
}

export async function readPowerPoint(file, { onProgress = () => {}, recognizeImages = recognizeImagesWithTesseract } = {}) {
  if (!/\.pptx$/i.test(file.name)) {
    throw new Error('Selecciona una presentación PowerPoint .pptx. Los archivos .ppt antiguos no son compatibles.')
  }
  if (file.size > MAX_PRESENTATION_SIZE) {
    throw new Error('La presentación supera el límite de 20 MB.')
  }

  const archive = await JSZip.loadAsync(file)
  const slideFiles = Object.keys(archive.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => Number(left.match(/slide(\d+)/)[1]) - Number(right.match(/slide(\d+)/)[1]))

  if (slideFiles.length === 0) throw new Error('No se encontraron diapositivas en esta presentación.')

  const slideParagraphs = []
  const images = []
  for (const [index, path] of slideFiles.entries()) {
    const xmlText = await archive.file(path).async('text')
    const slideXml = parseXml(xmlText)
    slideParagraphs.push(...extractParagraphs(slideXml))
    images.push(...await getSlideImages(archive, path, slideXml))
    onProgress({ phase: 'slides', progress: (index + 1) / slideFiles.length })
  }

  let ocrWarning = ''
  if (images.length > 0) {
    onProgress({ phase: 'ocr', progress: 0 })
    try {
      const recognizedText = await recognizeImages(images, onProgress)
      slideParagraphs.push(...recognizedText.flatMap((text) => text.split(/\r?\n/).map(cleanText).filter(Boolean)))
    } catch (error) {
      ocrWarning = 'No se pudo completar el OCR. Se conservó el texto editable de las diapositivas.'
      if (slideParagraphs.length === 0) {
        throw new Error(`${ocrWarning} Revisa los recursos locales del OCR y vuelve a intentarlo.`)
      }
      console.error(error)
    }
  }

  if (slideParagraphs.length === 0) {
    throw new Error('No se encontró texto reconocible en la presentación.')
  }

  const fields = extractFields(slideParagraphs)
  fields.amount = parseAmount(fields.amount)
  fields.clientType = matchChoice(fields.clientType, ['Persona natural', 'PYME', 'Corporativo', 'Grupo económico'])
  fields.analysisType = matchChoice(fields.analysisType, ['Crédito ordinario', 'Reestructuración', 'Riesgo concentrado', 'Crédito puntual'])
  fields.risk = matchChoice(fields.risk, ['Bajo', 'Medio', 'Alto'])

  return {
    fields,
    slideCount: slideFiles.length,
    fieldCount: Object.values(fields).filter(Boolean).length,
    text: slideParagraphs.join('\n'),
    ocrImageCount: images.length,
    ocrWarning,
  }
}
