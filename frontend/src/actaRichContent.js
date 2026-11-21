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
  const lines = String(block || '').split('\n').map((line) => line.trimEnd())
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
      items.push({ type: 'bullet', text: (bulletMatch[2] || '').trim() || trimmed })
    } else {
      paragraphLines.push(trimmed)
    }
  }
  flushParagraph()
  return items.length ? items : [{ type: 'paragraph', text: String(block || '').replace(/\s+/g, ' ').trim() }]
}

function hasBullets(blocks) {
  return blocks.some((block) => parseBlockLines(block).some((item) => item.type === 'bullet'))
}

function caseDataFromContext(context = {}) {
  if (context && typeof context === 'object' && context.data && typeof context.data === 'object') return context.data
  return context && typeof context === 'object' ? context : {}
}

function isMeaningfulText(value) {
  const text = normalizeText(value)
  if (!text) return false
  const lower = text.toLowerCase()
  return !/^(n\/a|na|no aplica|ninguno|ninguna|sin información|sin informacion|no informado|pendiente|pendiente de confirmación|pendiente de confirmacion)$/.test(lower)
}

function compact(text) {
  return normalizeText(text).replace(/\s+/g, ' ').trim()
}

function sentence(text) {
  const value = compact(text)
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

export function formatCurrency(value) {
  if (value === '' || value === null || value === undefined) return ''
  const amount = Number(value)
  if (!Number.isFinite(amount)) return ''
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)
}

function parseAmount(value) {
  if (value === '' || value === null || value === undefined) return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function buildSectionFocus(key, caseData = {}) {
  const amount = parseAmount(caseData.amount)
  const exposure = Number.isFinite(amount) ? ` para la exposición solicitada de ${formatCurrency(amount)}` : ''
  switch (key) {
    case 'profile':
      return `Caracterización del solicitante y de los factores cualitativos relevantes para la operación${exposure}.`
    case 'financial':
      return `Evaluación de la información financiera disponible, la estructura de ingresos/obligaciones y la capacidad de pago frente a la solicitud${exposure}.`
    case 'guarantees':
      return `Identificación de garantías y mitigantes documentados, su alcance y su aporte a la mitigación del riesgo.`
    case 'conditions':
      return `Revisión de las condiciones y estructura de la operación documentadas, incluyendo términos, controles y compromisos aplicables.`
    case 'recommendation':
      return 'Postura crediticia documentada y fundamentos que la sustentan con base en la evidencia disponible.'
    case 'observations':
      return 'Hallazgos, alertas, pendientes y aspectos de seguimiento que inciden en la decisión o en la administración del caso.'
    default:
      return 'Información relevante para el análisis del caso.'
  }
}

function buildPendingNote(key) {
  switch (key) {
    case 'profile':
      return 'Pendiente de confirmación: incorporar información del cliente (actividad, antigüedad, estructura, experiencia o factores relevantes) que permita sustentar el análisis cualitativo.'
    case 'financial':
      return 'Pendiente de confirmación: incorporar estados financieros, flujos, obligaciones y/o indicadores que permitan evaluar capacidad de pago y riesgo financiero.'
    case 'guarantees':
      return 'Pendiente de confirmación: detallar naturaleza, valor, cobertura y condiciones de las garantías o mitigantes, o confirmar su inexistencia.'
    case 'conditions':
      return 'Pendiente de confirmación: definir o documentar monto, plazo, tasa, forma de pago, destino y condiciones/controles aplicables a la operación.'
    case 'recommendation':
      return 'Pendiente de confirmación: registrar una recomendación expresa (aprobar, aprobar con condiciones o no aprobar) con su fundamento.'
    case 'observations':
      return 'No informado: no se registraron observaciones adicionales en la información disponible.'
    default:
      return 'Pendiente de confirmación: completar la información de esta sección.'
  }
}

function detectSectionSignals(text) {
  const value = compact(text)
  const lower = value.toLowerCase()
  return {
    hasPending: /\b(pendiente|por confirmar|por definir|sujeto a|a validar|no disponible|faltante)\b/i.test(lower),
    hasNoInfo: /\b(no informado|sin información|sin informacion|no se informó|no se informo|n\/a)\b/i.test(lower),
    hasConditions: /\b(condici[oó]n|sujeto a|previo a|siempre que|covenant|mitigante|seguimiento|control|garant|l[ií]mite|restric)\b/i.test(lower),
    hasNegative: /\b(no se recomienda|rechaz|desfavor|no aprobar|improceden|no procedente|no viable|no recomendable)\b/i.test(lower),
    hasPositive: /\b(se recomienda aprobar|aprobar|favorable|procedente|otorgar|conceder|autorizar)\b/i.test(lower),
    hasApproval: /\baprobar|aproba(?:ci[oó]n)|autorizar|otorgar|conceder\b/i.test(lower),
    hasMetrics: /(\b(ventas|ingresos|ebitda|margen|utilidad|liquidez|apalancamiento|deuda|dscr|cobertura|capital de trabajo|flujo|balance|patrimonio)\b)|(\d[\d.,]*\s*%)/i.test(lower),
  }
}

function caseDecision(recommendation, conditions = '') {
  const recText = normalizeText(recommendation)
  const condText = normalizeText(conditions)
  const combined = `${recText}\n${condText}`.toLowerCase()
  if (!combined.trim()) return { decision: 'pendiente', recText, condText }
  const has = (re) => re.test(combined)
  const negative = has(/\bno\s+(se\s+)?recomiend|\bno\s+(es\s+)?(procedente|recomendable|aconsejable|viable)|\brechaz|\bdesfavor|\bno\s+aprobar|\bno\s+proced|\bnegar|\bimproceden|\bdenegar/)
  const positive = has(/\bse\s+recomiend|\brecomiend\w*\s+(aprobar|continuar|otorg|conced|mantener|proceder|autorizar)|\baprobar\b|\bfavorable\b|\bprocedente\b|\botorgar\b|\bconceder\b|\bautorizar\b/)
  const conditional = has(/\bcondici|\bsujet[oa]\s+a|\bsupedit|\bsiempre\s+que|\bprevio\s+a|\bantes\s+de(l)?\b|\buna\s+vez\b|\bmitig|\bcovenant\b|\breestructur|\bajust|\bl[ií]mit|\bseguimiento|\bgarant|\bcautelar|\brestric|\breserva/)
  let decision = 'indeterminada'
  if (negative && !positive) decision = 'no_aprobar'
  else if (negative && positive) decision = 'aprobar_con_condiciones'
  else if (positive && conditional) decision = 'aprobar_con_condiciones'
  else if (conditional && !negative) decision = 'aprobar_con_condiciones'
  else if (positive) decision = 'aprobar'
  else if (negative) decision = 'no_aprobar'
  return { decision, recText, condText }
}

function recommendationContradictions(caseData = {}) {
  const rec = normalizeText(caseData.recommendation)
  const cond = normalizeText(caseData.conditions)
  const financial = normalizeText(caseData.financial)
  const guarantees = normalizeText(caseData.guarantees)
  const observations = normalizeText(caseData.observations)
  if (!rec) return []
  const issues = []
  const recNeg = /\b(no se recomienda|rechaz|desfavor|no aprobar|improceden|no procedente)\b/i.test(rec)
  const recPos = /\b(se recomienda|aprobar|favorable|procedente|otorgar|conceder|autorizar)\b/i.test(rec)
  const recCond = /\b(condici|sujeto a|previo a|siempre que|covenant|mitigante|seguimiento|garant)\b/i.test(rec) || /\b(condici|sujeto a|previo a|siempre que|covenant|mitigante|seguimiento|garant)\b/i.test(cond)
  if (recPos && !recNeg && !recCond && /\b(insuficiente|deterioro|p[ée]rdida|incumplim|il[ií]quidez|alto riesgo|deficiente|no sostenible)\b/i.test(`${financial}\n${observations}`)) {
    issues.push('La recomendación documentada es favorable, pero el análisis u observaciones registran señales de debilidad o riesgo relevante que requieren sustento o condiciones explícitas.')
  }
  if (recPos && !recNeg && !recCond && /\b(no informado|pendiente|por confirmar|sin información|sin informacion)\b/i.test(`${financial}\n${guarantees}`)) {
    issues.push('La recomendación favorable no explicita condiciones frente a información financiera o de garantías no informada/pendiente en el expediente.')
  }
  if (recNeg && recPos) {
    issues.push('La recomendación contiene señales simultáneas de aprobación y no aprobación; debe precisarse la postura final.')
  }
  return issues
}

function sectionSpecificInsight(key, text, caseData = {}) {
  const signals = detectSectionSignals(text)
  const amount = parseAmount(caseData.amount)
  const amountText = Number.isFinite(amount) ? formatCurrency(amount) : ''
  switch (key) {
    case 'profile':
      return amountText
        ? `La caracterización del cliente se analiza en relación con la solicitud de ${amountText} y con la consistencia del negocio o fuente de repago documentada.`
        : 'La caracterización del cliente se analiza en función de la consistencia del negocio o fuente de repago documentada.'
    case 'financial':
      if (signals.hasMetrics) {
        return 'Los indicadores y cifras consignados deben leerse en función de su impacto en la capacidad de pago, la generación de flujo y la sostenibilidad de las obligaciones asociadas a la operación.'
      }
      return amountText
        ? `La información financiera disponible se valora por su suficiencia para sustentar la capacidad de pago frente a la exposición solicitada de ${amountText}.`
        : 'La información financiera disponible se valora por su suficiencia para sustentar la capacidad de pago frente a la exposición solicitada.'
    case 'guarantees':
      return 'La cobertura y ejecutabilidad de las garantías/mitigantes se consideran como soporte de segunda fuente de repago, complementarias a la capacidad de pago primaria.'
    case 'conditions':
      return 'La estructura documentada se evalúa por su alineación con la finalidad de la operación, la capacidad de pago disponible y los mitigantes del caso.'
    case 'recommendation': {
      const contradictions = recommendationContradictions(caseData)
      if (contradictions.length) return `Coherencia del caso: ${contradictions[0]}`
      return 'La postura consignada debe ser consistente con los hallazgos financieros, las garantías disponibles y las condiciones documentadas.'
    }
    case 'observations':
      return 'Los puntos señalados deben gestionarse con responsables, soporte y estado, según corresponda, antes de la decisión final o como compromisos de seguimiento.'
    default:
      return ''
  }
}

export function buildNarrativeBlocks(key, label, value, context = {}) {
  const caseData = caseDataFromContext(context)
  const client = normalizeText(context.clientName || caseData.clientName) || 'el cliente evaluado'
  const text = normalizeText(value)
  const result = []

  if (!isMeaningfulText(text)) {
    result.push({ type: 'paragraph', text: buildSectionFocus(key, caseData) })
    result.push({ type: 'paragraph', text: buildPendingNote(key) })
    return result
  }

  const blocks = splitContentBlocks(text)
  result.push({ type: 'paragraph', text: buildSectionFocus(key, caseData) })
  for (const block of blocks) {
    for (const item of parseBlockLines(block)) {
      if (item.text) result.push(item)
    }
  }

  const signals = detectSectionSignals(text)
  const insight = sectionSpecificInsight(key, text, caseData)
  if (insight) result.push({ type: 'paragraph', text: insight })
  if (signals.hasPending || signals.hasNoInfo) {
    result.push({ type: 'paragraph', text: 'Se identifican elementos pendientes o no informados dentro de la información registrada; su definición y respaldo documental deben quedar trazables en el expediente.' })
  }

  return result
}

export function buildConclusionStatement(recommendation, conditions = '', clientName = 'el cliente evaluado') {
  const { decision, recText } = caseDecision(recommendation, conditions)
  const client = normalizeText(clientName) || 'el cliente evaluado'
  const basis = 'con base en la información y fundamentos documentados en el presente análisis (perfil, análisis financiero y capacidad de pago, garantías, condiciones y observaciones).'
  if (decision === 'aprobar') {
    return `Se recomienda aprobar el crédito para ${client}, ${basis}`
  }
  if (decision === 'aprobar_con_condiciones') {
    return `Se recomienda aprobar el crédito para ${client} con condiciones, supeditado al cumplimiento previo y/o permanente de las condiciones, mitigantes y controles documentados, ${basis}`
  }
  if (decision === 'no_aprobar') {
    return `No se recomienda aprobar el crédito para ${client}, ${basis}`
  }
  if (recText) {
    return `La postura crediticia para ${client} debe interpretarse conforme a la recomendación documentada en el acta, sin asumir una aprobación definitiva no expresada; ${basis}`
  }
  return `No es posible emitir una conclusión crediticia definitiva para ${client} sin una recomendación expresa documentada; la decisión debe adoptarse una vez sustentados y validados los elementos críticos del caso.`
}

function metricFromField(caseData, key, label, extractor) {
  const value = extractor ? extractor(caseData[key]) : normalizeText(caseData[key])
  if (!value) return null
  return { label, value }
}

function extractMention(text, patterns) {
  const source = normalizeText(text)
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match) return compact(match[0])
  }
  return ''
}

function buildKeyMetrics(caseData = {}, attachmentDatasets = []) {
  const metrics = []
  const amount = parseAmount(caseData.amount)
  if (Number.isFinite(amount)) metrics.push({ label: 'Monto solicitado', value: formatCurrency(amount), numeric: amount, unit: 'USD' })
  if (normalizeText(caseData.risk)) metrics.push({ label: 'Nivel de riesgo', value: normalizeText(caseData.risk) })
  if (normalizeText(caseData.line)) metrics.push({ label: 'Línea / producto', value: normalizeText(caseData.line) })

  const fin = normalizeText(caseData.financial)
  const guarantees = normalizeText(caseData.guarantees)
  const finIndicator = extractMention(fin, [/\b(DSCR|EBITDA|liquidez corriente|prueba ácida|apalancamiento|deuda\s*\/\s*EBITDA|cobertura de intereses|capital de trabajo)\b[^\n.;]{0,60}/i, /\b(ventas|ingresos|utilidad(?: neta)?|margen(?:es)?)\b[^\n.;]{0,60}/i])
  if (finIndicator) metrics.push({ label: 'Indicador/variable financiera referida', value: finIndicator })
  const guaranteeIndicator = extractMention(guarantees, [/\b(cobertura|valor(?: comercial| de realización| de avalúo)?|ltv|garant[ií]a)\b[^\n.;]{0,70}/i])
  if (guaranteeIndicator) metrics.push({ label: 'Garantía/cobertura referida', value: guaranteeIndicator })

  const attachmentCount = attachmentDatasets.filter((entry) => entry && (entry.name || entry.blob || (entry.chartData?.datasets || entry.datasets || []).length || (entry.chartData?.summary || entry.summary || []).length)).length
  if (attachmentCount > 0) metrics.push({ label: 'Soportes anexos considerados', value: String(attachmentCount), numeric: attachmentCount })

  return metrics
}

export function buildCaseQuantitativeSummary(form, attachmentDatasets = []) {
  const caseData = caseDataFromContext({ data: form })
  return buildKeyMetrics(caseData, attachmentDatasets)
}

export function collectValidationIssues(form = {}, attachmentEntries = []) {
  const issues = []
  const add = (field, source, detail, action) => issues.push({ field, source, detail, action })

  const amount = parseAmount(form.amount)
  if (form.amount !== '' && form.amount !== null && form.amount !== undefined && !Number.isFinite(amount)) {
    add('Monto solicitado', 'Formulario', 'El monto registrado no es numérico o no es interpretable.', 'Corregir el monto con una cifra válida y su unidad implícita en USD.')
  } else if (Number.isFinite(amount) && amount < 0) {
    add('Monto solicitado', 'Formulario', 'El monto registrado es negativo.', 'Validar y corregir el valor del monto solicitado.')
  }

  if (!normalizeText(form.clientName)) {
    add('Cliente', 'Formulario', 'No se registró el nombre del cliente.', 'Completar la identificación del cliente antes de emitir el acta.')
  }

  const recText = normalizeText(form.recommendation)
  const { decision } = caseDecision(form.recommendation, form.conditions)
  if (!recText) {
    add('Recomendación', 'Formulario', 'No se registró una recomendación expresa.', 'Documentar la postura crediticia (aprobar, aprobar con condiciones o no aprobar) y su fundamento.')
  } else if (decision === 'indeterminada') {
    add('Recomendación', 'Formulario', 'La recomendación registrada no permite identificar con claridad la postura de aprobación, aprobación con condiciones o no aprobación.', 'Redactar explícitamente la postura crediticia y, si aplica, las condiciones determinantes.')
  }

  const contradictions = recommendationContradictions(form)
  contradictions.forEach((detail) => add('Recomendación / consistencia', 'Análisis documentado', detail, 'Conciliar la recomendación con los hallazgos, condiciones y mitigantes, o ajustar la postura según la evidencia.'))

  if ((decision === 'aprobar' || decision === 'aprobar_con_condiciones') && !isMeaningfulText(form.financial)) {
    add('Análisis financiero', 'Formulario', 'La postura de recomendación no cuenta con información financiera/capacidad de pago documentada.', 'Incorporar y sustentar el análisis financiero y de capacidad de pago, o condicionar/ajustar la recomendación.')
  }

  if (decision === 'aprobar_con_condiciones' && !isMeaningfulText(form.conditions) && !/\b(condici|sujeto a|previo a|covenant|mitigante|seguimiento|garant)\b/i.test(recText)) {
    add('Condiciones', 'Formulario / Recomendación', 'Se identifica una recomendación condicionada sin detalle suficiente de condiciones.', 'Especificar las condiciones, controles o mitigantes que sustentan la recomendación condicionada.')
  }

  ;['profile', 'financial', 'guarantees', 'conditions', 'recommendation', 'observations'].forEach((key) => {
    const label = SECTION_DEFINITIONS.find((section) => section.key === key)?.label || key
    const text = normalizeText(form[key])
    if (!text) return
    const signals = detectSectionSignals(text)
    if (signals.hasNoInfo) add(label, 'Contenido de la sección', 'Se registró un estado de información no disponible/no informada.', 'Completar el dato o dejar constancia del pendiente con la fuente/gestión requerida.')
    if (signals.hasPending) add(label, 'Contenido de la sección', 'Se identificaron elementos pendientes o sujetos a confirmación.', 'Definir, validar y documentar el pendiente antes de la decisión o establecer su seguimiento.')
  })

  attachmentEntries.forEach((entry) => {
    const name = entry?.name || entry?.filename || ''
    const datasets = entry?.chartData?.datasets || entry?.datasets || []
    const summary = entry?.chartData?.summary || entry?.summary || []
    if (name && !datasets.length && !summary.length && !/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name)) {
      add(`Anexo: ${entry?.label || name}`, name, 'No se pudieron extraer tablas o series numéricas estructuradas del anexo.', 'Revisar el archivo fuente y verificar que contenga datos legibles/estructurados relevantes para el análisis.')
    }
  })

  const seen = new Set()
  return issues.filter((issue) => {
    const key = `${issue.field}|${issue.source}|${issue.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function colorFor(index) {
  const palette = ['#0F265C', '#1E88E5', '#2E7D32', '#C62828', '#6A1B9A', '#00838F', '#F9A825']
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

function formatAxisValue(value) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function wrapLabel(text, max = 14) {
  const value = String(text || '')
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export async function chartToPng({ title, labels = [], series = [], kind = 'bar', width = 960, height = 440, unit = '' }) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  if (!canvas) return null
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#0F265C'
  ctx.font = 'bold 22px Arial'
  ctx.fillText(String(title || 'Gráfico').slice(0, 80), 24, 34)
  if (unit) {
    ctx.fillStyle = '#5f6368'
    ctx.font = '14px Arial'
    ctx.fillText(`Unidad/referencia: ${String(unit).slice(0, 60)}`, 24, 54)
  }

  const paddingLeft = 70
  const paddingBottom = 80
  const paddingTop = unit ? 70 : 52
  const paddingRight = 260
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom
  drawAxes(ctx, width - (paddingRight - 60), height, paddingLeft)

  const allValues = series.flatMap((entry) => (entry.values || []).filter((value) => value !== null && Number.isFinite(Number(value))).map(Number))
  const maxValue = Math.max(1, ...allValues.map((value) => Math.abs(value)))
  const labelCount = Math.max(labels.length, 1)
  const groupWidth = chartWidth / labelCount

  ctx.strokeStyle = '#e0e0e0'
  ctx.fillStyle = '#5f6368'
  ctx.font = '12px Arial'
  for (let i = 0; i <= 4; i += 1) {
    const y = paddingTop + (chartHeight * i) / 4
    const val = maxValue * (1 - i / 4)
    ctx.beginPath()
    ctx.moveTo(paddingLeft, y)
    ctx.lineTo(paddingLeft + chartWidth, y)
    ctx.stroke()
    ctx.fillText(formatAxisValue(val), 8, y + 4)
  }

  if (kind === 'line') {
    series.forEach((entry, seriesIndex) => {
      const values = (entry.values || []).map((v) => (v === null || v === undefined ? null : Number(v)))
      ctx.strokeStyle = colorFor(seriesIndex)
      ctx.lineWidth = 3
      ctx.beginPath()
      let started = false
      values.forEach((value, index) => {
        if (!Number.isFinite(value)) { started = false; return }
        const x = paddingLeft + groupWidth * index + groupWidth / 2
        const y = paddingTop + chartHeight - (Math.abs(value) / maxValue) * chartHeight
        if (!started) { ctx.moveTo(x, y); started = true } else { ctx.lineTo(x, y) }
      })
      ctx.stroke()
      values.forEach((value, index) => {
        if (!Number.isFinite(value)) return
        const x = paddingLeft + groupWidth * index + groupWidth / 2
        const y = paddingTop + chartHeight - (Math.abs(value) / maxValue) * chartHeight
        ctx.fillStyle = colorFor(seriesIndex)
        ctx.beginPath()
        ctx.arc(x, y, 3.5, 0, Math.PI * 2)
        ctx.fill()
      })
    })
  } else {
    const barSeries = series.slice(0, 4)
    const barWidth = Math.max(8, (groupWidth * 0.72) / Math.max(barSeries.length, 1))
    barSeries.forEach((entry, seriesIndex) => {
      ctx.fillStyle = colorFor(seriesIndex)
      ;(entry.values || []).forEach((raw, index) => {
        const value = raw === null || raw === undefined ? null : Number(raw)
        if (!Number.isFinite(value)) return
        const x = paddingLeft + groupWidth * index + groupWidth * 0.14 + barWidth * seriesIndex
        const barHeight = (Math.abs(value) / maxValue) * chartHeight
        const y = paddingTop + chartHeight - barHeight
        ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight)
      })
    })
  }

  ctx.fillStyle = '#2C2C30'
  ctx.font = '12px Arial'
  labels.slice(0, 20).forEach((label, index) => {
    const x = paddingLeft + groupWidth * index + 2
    ctx.save()
    ctx.translate(x, paddingTop + chartHeight + 16)
    ctx.rotate(-Math.PI / 12)
    ctx.fillText(wrapLabel(label, 16), 0, 0)
    ctx.restore()
  })

  let legendY = unit ? 76 : 58
  ctx.font = '13px Arial'
  series.slice(0, 6).forEach((entry, index) => {
    ctx.fillStyle = colorFor(index)
    ctx.fillRect(width - 245, legendY - 11, 12, 12)
    ctx.fillStyle = '#2C2C30'
    ctx.fillText(wrapLabel(entry.name || `Serie ${index + 1}`, 28), width - 228, legendY)
    legendY += 20
  })

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}
