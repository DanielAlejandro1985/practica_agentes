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
      return `Alcance del análisis: caracterización del solicitante, actividad, trayectoria, estructura y factores cualitativos relevantes para la operación${exposure}.`
    case 'financial':
      return `Alcance del análisis: evaluación de la situación financiera, flujos, obligaciones e indicadores disponibles para sustentar la capacidad de pago frente a la solicitud${exposure}.`
    case 'guarantees':
      return 'Alcance del análisis: identificación y evaluación de garantías y mitigantes, su naturaleza, cobertura, ejecutabilidad y aporte a la mitigación del riesgo.'
    case 'conditions':
      return 'Alcance del análisis: revisión de la estructura y condiciones propuestas (monto, plazo, tasa, forma de pago, destino, covenants/controles) y su coherencia con el caso.'
    case 'recommendation':
      return 'Alcance del análisis: postura crediticia documentada, fundamentos, consistencia con el análisis integral y determinación de condiciones o reservas aplicables.'
    case 'observations':
      return 'Alcance del análisis: hallazgos, alertas, limitaciones, inconsistencias y aspectos que requieren gestión, validación o seguimiento.'
    default:
      return 'Alcance del análisis: información relevante registrada para el caso.'
  }
}

function buildPendingNote(key) {
  switch (key) {
    case 'profile':
      return 'Limitaciones y pendientes: no se dispone de información suficiente del perfil. Acción requerida: incorporar actividad, antigüedad, estructura, experiencia y factores cualitativos relevantes, con fuente verificable.'
    case 'financial':
      return 'Limitaciones y pendientes: no se dispone de información financiera/capacidad de pago suficiente. Acción requerida: incorporar estados financieros, flujos, obligaciones e indicadores, sustentados documentalmente.'
    case 'guarantees':
      return 'Limitaciones y pendientes: no se dispone de detalle de garantías/mitigantes. Acción requerida: documentar naturaleza, valor, cobertura, ejecutabilidad y condiciones, o dejar constancia expresa de su inexistencia.'
    case 'conditions':
      return 'Limitaciones y pendientes: no se dispone de condiciones de la operación suficientemente definidas. Acción requerida: precisar monto, plazo, tasa, forma de pago, destino y controles/covenants aplicables.'
    case 'recommendation':
      return 'Limitaciones y pendientes: no existe recomendación expresa. Acción requerida: documentar postura crediticia (aprobar, aprobar con condiciones o no aprobar) con fundamento y, si aplica, condiciones previas/permanentes.'
    case 'observations':
      return 'No informado: no se registraron observaciones adicionales. Acción sugerida: confirmar explícitamente la ausencia de hallazgos relevantes o registrar los identificados.'
    default:
      return 'Limitaciones y pendientes: información no disponible. Acción requerida: completar y sustentar la sección con evidencia trazable.'
  }
}

function detectSectionSignals(text) {
  const value = compact(text)
  const lower = value.toLowerCase()
  return {
    hasPending: /\b(pendiente|por confirmar|por definir|sujeto a|a validar|no disponible|faltante|en proceso)\b/i.test(lower),
    hasNoInfo: /\b(no informado|sin información|sin informacion|no se informó|no se informo|n\/a|no aplica)\b/i.test(lower),
    hasConditions: /\b(condici[oó]n|sujeto a|previo a|siempre que|covenant|mitigante|seguimiento|control|garant|l[ií]mite|restric|reserva)\b/i.test(lower),
    hasNegative: /\b(no se recomienda|rechaz|desfavor|no aprobar|improceden|no procedente|no viable|no recomendable|deterioro|p[ée]rdida|incumplim)\b/i.test(lower),
    hasPositive: /\b(se recomienda aprobar|aprobar|favorable|procedente|otorgar|conceder|autorizar|fortaleza|solidez|adecuad)\b/i.test(lower),
    hasApproval: /\baprobar|aproba(?:ci[oó]n)|autorizar|otorgar|conceder\b/i.test(lower),
    hasMetrics: /(\b(ventas|ingresos|ebitda|margen|utilidad|liquidez|apalancamiento|deuda|dscr|cobertura|capital de trabajo|flujo|balance|patrimonio|ratio)\b)|(\d[\d.,]*\s*%)/i.test(lower),
    hasStrength: /\b(fortaleza|s[oó]lido|estable|adecuad|suficiente|positivo|trayectoria|experiencia|respaldo)\b/i.test(lower),
    hasWeakness: /\b(debilidad|riesgo|insuficiente|vol[aá]til|deterioro|concentraci[oó]n|dependenc|presi[oó]n|incumplim|alto)\b/i.test(lower),
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
    issues.push('La recomendación favorable coexiste con señales de debilidad o riesgo relevante en el análisis/observaciones; requiere sustento adicional o condiciones explícitas.')
  }
  if (recPos && !recNeg && !recCond && /\b(no informado|pendiente|por confirmar|sin información|sin informacion)\b/i.test(`${financial}\n${guarantees}`)) {
    issues.push('La recomendación favorable no explicita mitigantes o condiciones frente a información financiera/garantías pendiente o no informada.')
  }
  if (recNeg && recPos) {
    issues.push('La recomendación contiene señales simultáneas de aprobación y no aprobación; debe precisarse la postura final.')
  }
  return issues
}

function sectionCriteria(key) {
  switch (key) {
    case 'profile':
      return 'Criterios de evaluación: identificación y naturaleza del solicitante, actividad y antigüedad, experiencia y capacidad operativa, estructura/relaciones relevantes, consistencia cualitativa con la operación solicitada.'
    case 'financial':
      return 'Criterios de evaluación: generación y estabilidad de ingresos/flujo, estructura de obligaciones y endeudamiento, liquidez y solvencia, capacidad de pago frente a la cuota/exposición, consistencia y suficiencia de la información financiera.'
    case 'guarantees':
      return 'Criterios de evaluación: tipo y naturaleza de garantías/mitigantes, cobertura frente a la exposición, calidad y ejecutabilidad, condiciones de constitución/actualización y rol como fuente secundaria de repago.'
    case 'conditions':
      return 'Criterios de evaluación: adecuación de monto, plazo, tasa, forma de pago y destino; alineación con capacidad de pago y finalidad; existencia de covenants, controles, condiciones previas y compromisos de seguimiento.'
    case 'recommendation':
      return 'Criterios de evaluación: coherencia entre hallazgos del análisis, postura propuesta (aprobar/aprobar con condiciones/no aprobar), fundamentación, proporcionalidad de condiciones y viabilidad de cumplimiento.'
    case 'observations':
      return 'Criterios de evaluación: materialidad de hallazgos y alertas, impacto en riesgo y capacidad de pago, limitaciones de información, acciones correctivas y necesidades de seguimiento o validación.'
    default:
      return 'Criterios de evaluación: relevancia, consistencia, soporte y trazabilidad de la información registrada.'
  }
}

function sectionImplication(key, caseData = {}, signals = {}) {
  const amount = parseAmount(caseData.amount)
  const amountText = Number.isFinite(amount) ? ` (${formatCurrency(amount)})` : ''
  switch (key) {
    case 'profile':
      return `Implicaciones para el riesgo: los factores cualitativos del perfil inciden en la previsibilidad del comportamiento crediticio y en la sostenibilidad de la relación; su debilidad o falta de sustento incrementa la incertidumbre de la operación${amountText}.`
    case 'financial':
      return `Implicaciones para riesgo y capacidad de pago: la suficiencia, estabilidad y calidad del flujo/ingresos determinan la viabilidad de atender las obligaciones${amountText}; limitaciones o señales de presión financiera elevan la probabilidad de deterioro.`
    case 'guarantees':
      return 'Implicaciones para el riesgo: las garantías y mitigantes reducen la severidad potencial de pérdida en la medida de su cobertura, calidad y ejecutabilidad, pero no sustituyen una capacidad de pago primaria adecuada.'
    case 'conditions':
      return 'Implicaciones para el riesgo: la estructura de términos y controles debe ser compatible con la capacidad de pago y la finalidad; condiciones inadecuadas o no verificables pueden incrementar el riesgo operativo y crediticio.'
    case 'recommendation':
      return 'Implicaciones para la decisión: la postura propuesta debe ser consistente con la evidencia disponible y explicitar condiciones, reservas o seguimientos necesarios para una aprobación responsable.'
    case 'observations':
      return 'Implicaciones para el riesgo y seguimiento: los hallazgos y limitaciones identificados pueden afectar la decisión o requerir acciones, controles y monitoreo con responsables y plazos definidos.'
    default:
      return 'Implicaciones para el riesgo: la información de esta sección debe valorarse en función de su impacto sobre la operación y la capacidad de repago.'
  }
}

function sectionSupportNote(key, signals = {}) {
  if (signals.hasStrength || signals.hasPositive) {
    return 'Elementos de soporte identificados en lo registrado: se observan aspectos favorables o de respaldo según la información consignada; su relevancia debe confirmarse frente a la evidencia documental y al conjunto del caso.'
  }
  if (signals.hasMetrics) {
    return 'Elementos de soporte identificados en lo registrado: se consignan datos/cifras o referencias cuantitativas que sirven como base de análisis, sujetas a validación y conciliación con los soportes.'
  }
  return 'Elementos de soporte identificados en lo registrado: no se identifican fortalezas adicionales explícitas más allá de lo consignado; la valoración definitiva depende de la verificación de la evidencia disponible.'
}

function sectionConclusion(key, signals = {}) {
  const pending = signals.hasPending || signals.hasNoInfo
  switch (key) {
    case 'profile':
      return pending
        ? 'Conclusión de la sección: el perfil presenta información con limitaciones; su valoración es preliminar y queda sujeta a la documentación y cierre de pendientes.'
        : 'Conclusión de la sección: el perfil registrado aporta elementos cualitativos para el análisis, sujeto a verificación documental y consistencia con el resto del expediente.'
    case 'financial':
      return pending
        ? 'Conclusión de la sección: no es posible concluir de forma suficiente sobre la capacidad de pago sin completar y sustentar la información financiera pendiente.'
        : 'Conclusión de la sección: la información financiera registrada permite un análisis en los términos expuestos, condicionado a la verificación de cifras, soportes y coherencia con la operación.'
    case 'guarantees':
      return pending
        ? 'Conclusión de la sección: la evaluación de mitigantes es incompleta mientras no se definan y sustenten las garantías o se confirme expresamente su inexistencia.'
        : 'Conclusión de la sección: las garantías/mitigantes registrados constituyen soporte del caso en los términos descritos, sujeto a validación de cobertura y ejecutabilidad.'
    case 'conditions':
      return pending
        ? 'Conclusión de la sección: las condiciones de la operación requieren definición o validación adicional para asegurar su alineación con la capacidad de pago y el riesgo.'
        : 'Conclusión de la sección: las condiciones registradas son evaluables conforme a lo documentado, sujetas a confirmación de términos, controles y viabilidad de cumplimiento.'
    case 'recommendation':
      return pending
        ? 'Conclusión de la sección: la recomendación no se encuentra suficientemente definida o sustentada; debe precisarse antes de la deliberación final.'
        : 'Conclusión de la sección: la recomendación registrada debe leerse como resultado del análisis integral y en coherencia con la evidencia, condiciones y limitaciones del expediente.'
    case 'observations':
      return pending
        ? 'Conclusión de la sección: existen observaciones o limitaciones que requieren gestión/seguimiento; su cierre o tratamiento debe quedar documentado.'
        : 'Conclusión de la sección: las observaciones registradas delimitan aspectos de atención para la decisión y, cuando corresponda, para el seguimiento posterior.'
    default:
      return 'Conclusión de la sección: análisis sujeto a la información y evidencia disponible.'
  }
}

export function buildNarrativeBlocks(key, label, value, context = {}) {
  const caseData = caseDataFromContext(context)
  const text = normalizeText(value)
  const result = []
  const signals = detectSectionSignals(text)

  result.push({ type: 'paragraph', text: buildSectionFocus(key, caseData) })

  if (!isMeaningfulText(text)) {
    result.push({ type: 'paragraph', text: 'Información registrada: no se consignó información sustantiva en esta sección.' })
    result.push({ type: 'paragraph', text: sectionCriteria(key) })
    result.push({ type: 'paragraph', text: sectionImplication(key, caseData, signals) })
    result.push({ type: 'paragraph', text: buildPendingNote(key) })
    result.push({ type: 'paragraph', text: sectionConclusion(key, { hasPending: true, hasNoInfo: true }) })
    return result
  }

  const blocks = splitContentBlocks(text)
  result.push({ type: 'paragraph', text: 'Información registrada (detalle consignado):' })
  for (const block of blocks) {
    for (const item of parseBlockLines(block)) {
      if (item.text) result.push(item)
    }
  }

  result.push({ type: 'paragraph', text: `Análisis técnico: ${sectionCriteria(key)}` })
  if (key === 'recommendation') {
    const contradictions = recommendationContradictions(caseData)
    if (contradictions.length) {
      result.push({ type: 'paragraph', text: `Coherencia y consistencia: ${contradictions[0]}` })
    } else {
      result.push({ type: 'paragraph', text: 'Coherencia y consistencia: la postura consignada debe contrastarse con los hallazgos financieros, las garantías/mitigantes, las condiciones y el nivel de riesgo documentado.' })
    }
  }
  result.push({ type: 'paragraph', text: sectionImplication(key, caseData, signals) })
  if (key !== 'observations') {
    result.push({ type: 'paragraph', text: sectionSupportNote(key, signals) })
  }

  const limitations = []
  if (signals.hasPending) limitations.push('Se identifican elementos pendientes o sujetos a confirmación dentro de lo registrado.')
  if (signals.hasNoInfo) limitations.push('Se registran menciones a información no disponible/no informada.')
  if (signals.hasWeakness || signals.hasNegative) limitations.push('Se observan señales de riesgo, debilidad o restricciones que requieren valoración y, de corresponder, mitigación o seguimiento.')
  if (limitations.length) {
    result.push({ type: 'paragraph', text: `Limitaciones y pendientes: ${limitations.join(' ')} Acción requerida: sustentar, validar y dejar trazabilidad documental de los puntos señalados.` })
  } else {
    result.push({ type: 'paragraph', text: 'Limitaciones y pendientes: no se identifican pendientes explícitos en el texto registrado; subsiste la necesidad de verificación documental y conciliación con los soportes del expediente.' })
  }

  if (key === 'observations') {
    result.push({ type: 'paragraph', text: 'Gestión sugerida: definir responsable, acción, evidencia esperada y fecha/condición de cierre para cada hallazgo relevante, según corresponda.' })
  }

  result.push({ type: 'paragraph', text: sectionConclusion(key, signals) })
  return result
}

export function buildConclusionStatement(recommendation, conditions = '', clientName = 'el cliente evaluado') {
  const { decision, recText } = caseDecision(recommendation, conditions)
  const client = normalizeText(clientName) || 'el cliente evaluado'
  const basis = 'con base en la información y fundamentos documentados en el perfil, el análisis financiero y capacidad de pago, las garantías, las condiciones y las observaciones, y sujeto a la verificación y trazabilidad de la evidencia del expediente'
  if (decision === 'aprobar') {
    return `Conclusión crediticia: se recomienda aprobar el crédito para ${client}, ${basis}. La decisión debe formalizarse conforme a las políticas aplicables y a la confirmación de que no existen inconsistencias materiales pendientes.`
  }
  if (decision === 'aprobar_con_condiciones') {
    return `Conclusión crediticia: se recomienda aprobar el crédito para ${client} con condiciones, ${basis}. La efectividad de la aprobación queda supeditada al cumplimiento previo y/o permanente de las condiciones, mitigantes y controles documentados, así como a su seguimiento.`
  }
  if (decision === 'no_aprobar') {
    return `Conclusión crediticia: no se recomienda aprobar el crédito para ${client}, ${basis}. Cualquier reconsideración deberá sustentarse en información adicional verificable que atienda los factores de riesgo y limitaciones identificados.`
  }
  if (recText) {
    return `Conclusión crediticia: la postura para ${client} debe interpretarse conforme a la recomendación documentada, sin asumir una aprobación definitiva no expresada, ${basis}. Se requiere precisar la decisión y sus condiciones para efectos de deliberación.`
  }
  return `Conclusión crediticia: no es posible emitir una conclusión definitiva para ${client} sin una recomendación expresa documentada, ${basis}. Corresponde completar y validar los elementos críticos del caso antes de la decisión.`
}

export function buildExecutiveSummary(form = {}) {
  const caseData = caseDataFromContext({ data: form })
  const client = normalizeText(caseData.clientName) || 'Cliente no informado'
  const amount = parseAmount(caseData.amount)
  const amountText = Number.isFinite(amount) ? formatCurrency(amount) : 'No informado'
  const { decision } = caseDecision(caseData.recommendation, caseData.conditions)
  const decisionLabel = {
    aprobar: 'Aprobación recomendada',
    aprobar_con_condiciones: 'Aprobación con condiciones recomendada',
    no_aprobar: 'No aprobación recomendada',
    indeterminada: 'Postura no concluyente',
    pendiente: 'Recomendación pendiente',
  }[decision] || 'Postura no concluyente'
  const sections = ['profile', 'financial', 'guarantees', 'conditions', 'observations', 'recommendation']
  const informed = sections.filter((key) => isMeaningfulText(caseData[key])).length
  return {
    client,
    amountText,
    decisionLabel,
    risk: normalizeText(caseData.risk) || 'No informado',
    line: normalizeText(caseData.line) || 'No informada',
    analysisType: normalizeText(caseData.analysisType) || 'No informado',
    completeness: `${informed} de ${sections.length} secciones con información sustantiva`,
  }
}

export function buildPendingItems(form = {}, attachmentEntries = []) {
  const issues = collectValidationIssues(form, attachmentEntries)
  return issues.map((issue) => ({
    area: issue.field,
    source: issue.source,
    detail: issue.detail,
    action: issue.action,
  }))
}

export function buildTraceability(form = {}, attachmentEntries = []) {
  const rows = []
  const sections = [
    ['Perfil del cliente', form.profile],
    ['Análisis financiero y capacidad de pago', form.financial],
    ['Garantías y mitigantes', form.guarantees],
    ['Condiciones propuestas', form.conditions],
    ['Observaciones', form.observations],
    ['Recomendación y fundamento', form.recommendation],
  ]
  sections.forEach(([label, value]) => {
    rows.push({ element: label, source: 'Formulario', status: isMeaningfulText(value) ? 'Información registrada' : 'No informado / pendiente', detail: isMeaningfulText(value) ? 'Contenido narrativo disponible para análisis.' : 'Sin información sustantiva registrada.' })
  })
  attachmentEntries.forEach((entry) => {
    const name = entry?.name || entry?.filename || ''
    if (!name) return
    const hasData = (entry?.chartData?.datasets || entry?.datasets || []).length || (entry?.chartData?.summary || entry?.summary || []).length
    rows.push({ element: `Anexo - ${entry?.label || 'Soporte'}`, source: name, status: 'Incorporado', detail: hasData ? 'Se identificaron datos/estructuras para análisis cuantitativo o resumen.' : 'Adjunto disponible; requiere revisión/consolidación de su contenido.' })
  })
  return rows
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
  if (Number.isFinite(amount)) metrics.push({ label: 'Monto solicitado (exposición)', value: formatCurrency(amount), numeric: amount, unit: 'USD' })
  metrics.push({ label: 'Nivel de riesgo registrado', value: normalizeText(caseData.risk) || 'No informado' })
  metrics.push({ label: 'Línea / producto', value: normalizeText(caseData.line) || 'No informada' })
  metrics.push({ label: 'Tipo de análisis', value: normalizeText(caseData.analysisType) || 'No informado' })

  const sections = ['profile', 'financial', 'guarantees', 'conditions', 'observations', 'recommendation']
  const informed = sections.filter((key) => isMeaningfulText(caseData[key])).length
  metrics.push({ label: 'Completitud narrativa', value: `${informed} de ${sections.length} secciones con información sustantiva`, numeric: informed })

  const fin = normalizeText(caseData.financial)
  const guarantees = normalizeText(caseData.guarantees)
  const finIndicator = extractMention(fin, [/\b(DSCR|EBITDA|liquidez corriente|prueba ácida|apalancamiento|deuda\s*\/\s*EBITDA|cobertura de intereses|capital de trabajo)\b[^\n.;]{0,60}/i, /\b(ventas|ingresos|utilidad(?: neta)?|margen(?:es)?)\b[^\n.;]{0,60}/i])
  if (finIndicator) metrics.push({ label: 'Indicador/variable financiera referida', value: finIndicator })
  const guaranteeIndicator = extractMention(guarantees, [/\b(cobertura|valor(?: comercial| de realización| de avalúo)?|ltv|garant[ií]a)\b[^\n.;]{0,70}/i])
  if (guaranteeIndicator) metrics.push({ label: 'Garantía/cobertura referida', value: guaranteeIndicator })

  const attachmentEntries = Array.isArray(attachmentDatasets) ? attachmentDatasets : []
  const presentAttachments = attachmentEntries.filter((entry) => entry && (entry.name || entry.filename || entry.blob)).length
  const datasetsCount = attachmentEntries.reduce((sum, entry) => sum + ((entry.chartData?.datasets || entry.datasets || []).length || 0), 0)
  const numericSummaries = attachmentEntries.reduce((sum, entry) => sum + ((entry.chartData?.summary || entry.summary || []).length || 0), 0)
  metrics.push({ label: 'Soportes anexos incorporados', value: String(presentAttachments), numeric: presentAttachments })
  if (datasetsCount || numericSummaries) {
    metrics.push({ label: 'Series/tablas numéricas identificadas en anexos', value: String(datasetsCount || numericSummaries), numeric: datasetsCount || numericSummaries })
  }

  const { decision } = caseDecision(caseData.recommendation, caseData.conditions)
  const decisionLabel = {
    aprobar: 'Aprobación',
    aprobar_con_condiciones: 'Aprobación con condiciones',
    no_aprobar: 'No aprobación',
    indeterminada: 'No concluyente',
    pendiente: 'Pendiente',
  }[decision] || 'No concluyente'
  metrics.push({ label: 'Postura crediticia documentada', value: decisionLabel })

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
  } else if (!Number.isFinite(amount)) {
    add('Monto solicitado', 'Formulario', 'No se registró el monto solicitado.', 'Definir el monto/exposición a evaluar para sustentar el análisis de capacidad de pago y riesgo.')
  }

  if (!normalizeText(form.clientName)) {
    add('Cliente', 'Formulario', 'No se registró el nombre del cliente.', 'Completar la identificación del cliente antes de emitir el acta.')
  }
  if (!normalizeText(form.clientType)) {
    add('Tipo de cliente', 'Formulario', 'No se registró el tipo de cliente.', 'Definir la naturaleza del solicitante para contextualizar el análisis y los criterios aplicables.')
  }
  if (!normalizeText(form.analysisType)) {
    add('Tipo de análisis', 'Formulario', 'No se registró el tipo de análisis.', 'Indicar el tipo de análisis/operación para delimitar el alcance y los criterios de evaluación.')
  }
  if (!normalizeText(form.line)) {
    add('Línea / producto', 'Formulario', 'No se registró la línea o producto de crédito.', 'Especificar la línea/producto para evaluar coherencia de condiciones y finalidad.')
  }
  if (!normalizeText(form.risk)) {
    add('Nivel de riesgo', 'Formulario', 'No se registró el nivel de riesgo.', 'Asignar y sustentar el nivel de riesgo conforme al análisis integral del caso.')
  }
  if (!normalizeText(form.proposal)) {
    add('Proponente', 'Formulario', 'No se registró el proponente/área solicitante.', 'Identificar el proponente para la trazabilidad de la solicitud.')
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
  if ((decision === 'aprobar' || decision === 'aprobar_con_condiciones') && !isMeaningfulText(form.conditions)) {
    add('Condiciones propuestas', 'Formulario', 'No se registran condiciones/términos de la operación pese a existir una postura de aprobación.', 'Definir monto, plazo, tasa, forma de pago, destino y controles/condiciones aplicables.')
  }

  if (decision === 'aprobar_con_condiciones' && !isMeaningfulText(form.conditions) && !/\b(condici|sujeto a|previo a|covenant|mitigante|seguimiento|garant)\b/i.test(recText)) {
    add('Condiciones', 'Formulario / Recomendación', 'Se identifica una recomendación condicionada sin detalle suficiente de condiciones.', 'Especificar las condiciones, controles o mitigantes que sustentan la recomendación condicionada.')
  }

  if (decision === 'aprobar' && /\b(alto|cr[ií]tico|elevado)\b/i.test(normalizeText(form.risk)) && !/\b(condici|mitig|seguimiento|garant|covenant)\b/i.test(`${recText}\n${normalizeText(form.conditions)}`)) {
    add('Riesgo / coherencia', 'Análisis documentado', 'Se registra un nivel de riesgo alto con recomendación favorable sin mitigantes o condiciones explícitas en el texto disponible.', 'Revisar la coherencia de la postura y explicitar mitigantes, condiciones o seguimiento proporcionales al riesgo.')
  }

  ;['profile', 'financial', 'guarantees', 'conditions', 'recommendation', 'observations'].forEach((key) => {
    const label = SECTION_DEFINITIONS.find((section) => section.key === key)?.label || key
    const value = form[key]
    const text = normalizeText(value)
    if (!text) {
      add(label, 'Formulario', 'No se registró información en esta sección.', 'Completar la sección o dejar constancia formal de la inexistencia de información y su impacto en el análisis.')
      return
    }
    if (!isMeaningfulText(text)) {
      add(label, 'Contenido de la sección', 'El contenido registrado no aporta información sustantiva (no informado/pendiente).', 'Sustituir por información concreta o documentar el pendiente con fuente y gestión requerida.')
      return
    }
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
