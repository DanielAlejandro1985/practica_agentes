import JSZip from 'jszip'

export const SECTION_DEFINITIONS = [
  { key: 'profile', label: 'Perfil del cliente' },
  { key: 'financial', label: 'Análisis financiero y capacidad de pago' },
  { key: 'guarantees', label: 'Garantías y mitigantes' },
  { key: 'conditions', label: 'Condiciones propuestas' },
  { key: 'recommendation', label: 'Recomendación y fundamento' },
  { key: 'observations', label: 'Observaciones' },
]

export function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim()
}

export function splitContentBlocks(value) {
  const text = normalizeText(value)
  if (!text) return []
  return text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
}

export function parseBlockLines(block) {
  const lines = block.split('\n').map((line) => line.trimEnd())
  const items = []
  let paragraphLines = []
  const flushParagraph = () => {
    const text = paragraphLines.join(' ').replace(/\s+/g, ' ').trim()
    if (text) items.push({ type: 'paragraph', text })
    paragraphLines = []
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      continue
    }
    const bulletMatch = trimmed.match(/^([\-*•▪◦–—]|\d+[.)])\s+(.*)$/)
    if (bulletMatch) {
      flushParagraph()
      items.push({ type: 'bullet', text: bulletMatch[2].trim() || trimmed })
    } else {
      paragraphLines.push(trimmed)
    }
  }
  flushParagraph()
  return items.length ? items : [{ type: 'paragraph', text: block.replace(/\s+/g, ' ').trim() }]
}

function hasBullets(blocks) {
  return blocks.some((block) => parseBlockLines(block).some((item) => item.type === 'bullet'))
}

function sectionFocus(key) {
  switch (key) {
    case 'profile':
      return 'el perfil del cliente, su actividad, antecedentes, estructura y factores relevantes para comprender su comportamiento económico'
    case 'financial':
      return 'la situación financiera, los ingresos, flujos, obligaciones y la capacidad de pago'
    case 'guarantees':
      return 'las garantías ofrecidas, su cobertura, calidad, ejecutabilidad y su función como mitigante del riesgo'
    case 'conditions':
      return 'las condiciones propuestas, su coherencia con el producto, el plazo, la forma de pago y los controles aplicables'
    case 'recommendation':
      return 'la recomendación planteada, su fundamento, los soportes que la sustentan y las condiciones o seguimientos necesarios'
    case 'observations':
      return 'las observaciones relevantes, hallazgos, alertas, limitaciones y aspectos que requieren seguimiento'
    default:
      return 'la información registrada en esta sección'
  }
}

export function buildNarrativeBlocks(key, label, value, context = {}) {
  const text = normalizeText(value)
  const blocks = splitContentBlocks(text)
  const focus = sectionFocus(key)
  const client = context.clientName || 'el cliente evaluado'
  const result = []

  if (!blocks.length) {
    result.push({ type: 'paragraph', text: `Información disponible: no se registró información detallada para ${label.toLowerCase()}.` })
    result.push({ type: 'paragraph', text: `Análisis y contexto para auditoría: ante la ausencia de información sobre ${focus}, no es posible sustentar conclusiones completas con la evidencia proporcionada. Esta limitación debe constar expresamente en la evaluación del caso de ${client}, sin realizar inferencias ni asumir hechos no acreditados.` })
    result.push({ type: 'paragraph', text: 'Puntos pendientes o limitaciones: corresponde obtener, validar y documentar la información faltante antes de la decisión, la aprobación definitiva o el desembolso, dejando evidencia del seguimiento realizado.' })
    return result
  }

  result.push({ type: 'paragraph', text: `Contexto de la sección: el presente apartado desarrolla de manera detallada ${focus} para ${client}, con base en la información disponible y con el nivel de sustento requerido para revisión de auditoría.` })

  for (const block of blocks) {
    for (const item of parseBlockLines(block)) {
      result.push(item)
    }
  }

  const bulletPresent = hasBullets(blocks)
  if (bulletPresent) {
    result.push({ type: 'paragraph', text: `Desarrollo explicativo de los puntos señalados: las viñetas anteriores se mantienen como detalle puntual de la información registrada y deben interpretarse en conjunto. Cada punto aporta elementos relevantes sobre ${focus}; su lectura integral permite comprender el alcance de lo informado, la consistencia entre los datos y su relación con el riesgo, la capacidad de pago y la decisión propuesta.` })
  }

  result.push({ type: 'paragraph', text: `Análisis detallado: la información expuesta evidencia los aspectos conocidos del caso y debe ser contrastada con los soportes, anexos y registros disponibles. En lo que respecta a ${focus}, corresponde evaluar la suficiencia, calidad y coherencia de los datos, así como su impacto concreto en la operación, identificando fortalezas, debilidades y dependencias relevantes sin omitir detalles proporcionados.` })

  const missingSignals = /no se informó|no informado|pendiente|sin información|n\/a/i.test(text)
  result.push({ type: 'paragraph', text: missingSignals
    ? 'Conclusión y puntos pendientes: se identifican aspectos no informados o sujetos a validación dentro de la información disponible. Dichos puntos deben ser aclarados, sustentados documentalmente y considerados como limitaciones relevantes antes de la aprobación o el desembolso, registrando cualquier gestión de seguimiento.'
    : 'Conclusión y control: con la información disponible se documenta el análisis de esta sección; no obstante, toda conclusión debe mantenerse condicionada a la verificación de la evidencia soporte y a la ausencia de inconsistencias posteriores. Cualquier variación relevante deberá quedar registrada para fines de auditoría y seguimiento.' })

  return result
}

export function formatCurrency(value) {
  if (value === '' || value === null || value === undefined) return 'No especificado'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 'No especificado'
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)
}

export function buildCaseQuantitativeSummary(form, attachmentDatasets = []) {
  const rows = []
  const amount = Number(form.amount)
  if (Number.isFinite(amount)) rows.push({ label: 'Monto solicitado', value: formatCurrency(amount), numeric: amount })
  const narrativeKeys = ['profile', 'financial', 'guarantees', 'conditions', 'recommendation', 'observations']
  const filled = narrativeKeys.filter((key) => normalizeText(form[key])).length
  rows.push({ label: 'Secciones narrativas con información', value: `${filled} de ${narrativeKeys.length}`, numeric: filled })
  rows.push({ label: 'Anexos con datos analizados', value: String(attachmentDatasets.length), numeric: attachmentDatasets.length })
  const numericPoints = attachmentDatasets.reduce((sum, entry) => sum + entry.datasets.reduce((inner, dataset) => inner + dataset.series.reduce((count, series) => count + series.values.filter((v) => v !== null).length, 0), 0), 0)
  rows.push({ label: 'Valores numéricos detectados en anexos', value: String(numericPoints), numeric: numericPoints })
  return rows
}

function colorFor(index) {
  const palette = ['#0F265C', '#FFD100', '#2E7D32', '#C62828', '#6A1B9A', '#00838F']
  return palette[index % palette.length]
}

function drawAxes(ctx, width, height, padding) {
  ctx.strokeStyle = '#8a8a8f'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding, padding / 2)
  ctx.lineTo(padding, height - padding)
  ctx.lineTo(width - padding / 2, height - padding)
  ctx.stroke()
}

export async function chartToPng({ title, labels, series, kind = 'bar', width = 900, height = 420 }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#0F265C'
  ctx.font = 'bold 24px Arial'
  ctx.fillText(title.slice(0, 70), 24, 36)

  const padding = 70
  const chartWidth = width - padding * 1.5
  const chartHeight = height - padding * 1.6
  drawAxes(ctx, width, height, padding)

  const allValues = series.flatMap((entry) => entry.values.filter((value) => value !== null))
  const maxValue = Math.max(1, ...allValues.map((value) => Math.abs(value)))
  const labelCount = Math.max(labels.length, 1)
  const groupWidth = chartWidth / labelCount

  if (kind === 'line') {
    series.forEach((entry, seriesIndex) => {
      ctx.strokeStyle = colorFor(seriesIndex)
      ctx.lineWidth = 3
      ctx.beginPath()
      entry.values.forEach((value, index) => {
        if (value === null) return
        const x = padding + groupWidth * index + groupWidth / 2
        const y = height - padding - (Math.abs(value) / maxValue) * chartHeight
        if (index === 0 || entry.values[index - 1] === null) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        ctx.fillStyle = colorFor(seriesIndex)
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.stroke()
    })
  } else {
    const barSeries = series.slice(0, 4)
    const barWidth = Math.max(8, (groupWidth * 0.7) / Math.max(barSeries.length, 1))
    barSeries.forEach((entry, seriesIndex) => {
      ctx.fillStyle = colorFor(seriesIndex)
      entry.values.forEach((value, index) => {
        if (value === null) return
        const x = padding + groupWidth * index + groupWidth * 0.15 + barWidth * seriesIndex
        const barHeight = (Math.abs(value) / maxValue) * chartHeight
        const y = height - padding - barHeight
        ctx.fillRect(x, y, barWidth, barHeight)
      })
    })
  }

  ctx.fillStyle = '#2C2C30'
  ctx.font = '14px Arial'
  labels.slice(0, 12).forEach((label, index) => {
    const x = padding + groupWidth * index + 4
    ctx.fillText(String(label).slice(0, 12), x, height - padding + 20)
  })

  let legendY = 58
  series.slice(0, 5).forEach((entry, index) => {
    ctx.fillStyle = colorFor(index)
    ctx.fillRect(width - 260, legendY - 12, 14, 14)
    ctx.fillStyle = '#2C2C30'
    ctx.fillText(String(entry.name).slice(0, 24), width - 238, legendY)
    legendY += 22
  })

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}
