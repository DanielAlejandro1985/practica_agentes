import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import {
  deleteActa,
  downloadActaAttachment,
  downloadActaWord,
  configureAi,
  generateWithAi,
  getActa,
  getAiStatus,
  listActas,
  saveActa,
} from './actasApi.js'
import { extractExcelChartData } from './excelData.js'
import {
  SECTION_DEFINITIONS,
  buildCaseQuantitativeSummary,
  buildConclusionStatement,
  buildExecutiveSummary,
  buildNarrativeBlocks,
  buildPendingItems,
  buildTraceability,
  chartToPng,
  collectValidationIssues,
  formatCurrency,
  isMeaningfulText,
  normalizeText,
} from './actaRichContent.js'
import './App.css'

const initialForm = {
  clientName: '',
  clientType: '',
  analysisType: '',
  line: '',
  proposal: '',
  amount: '',
  risk: '',
  group: '',
  profile: '',
  financial: '',
  guarantees: '',
  conditions: '',
  recommendation: '',
  observations: '',
}

const attachmentSections = [
  { key: 'financial', label: 'Análisis financiero' },
  { key: 'guarantees', label: 'Garantías' },
  { key: 'conditions', label: 'Condiciones' },
]

const formFieldLabels = {
  clientName: 'Cliente',
  clientType: 'Tipo de cliente',
  analysisType: 'Tipo de análisis',
  line: 'Línea de crédito',
  proposal: 'Proponente',
  amount: 'Monto',
  risk: 'Nivel de riesgo',
  group: 'Grupo económico',
  profile: 'Perfil del cliente',
  financial: 'Análisis financiero',
  guarantees: 'Garantías',
  conditions: 'Condiciones',
  recommendation: 'Recomendación',
  observations: 'Observaciones',
}


function formatNarrativeValue(value, missingMessage) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return text || missingMessage
}

function getWordFilename(clientName) {
  const safeName = clientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80)
  return `Acta-comite-${safeName || 'cliente'}.docx`
}

function downloadBlob(blob, filename) {
  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
}

async function loadLogoPng() {
  const image = new Image()
  image.src = '/pichincha-logo.svg'
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('No se pudo cargar el logo para generar el acta.'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar el logo para el acta.')
  context.drawImage(image, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo preparar el logo para el acta.')
  return new Uint8Array(await blob.arrayBuffer())
}

function App() {
  const [form, setForm] = useState(initialForm)
  const [savedForm, setSavedForm] = useState(initialForm)
  const [attachedFiles, setAttachedFiles] = useState({})
  const [savedAttachments, setSavedAttachments] = useState({})
  const [removedAttachments, setRemovedAttachments] = useState([])
  const [uploadErrors, setUploadErrors] = useState({})
  const [actas, setActas] = useState([])
  const [selectedActaId, setSelectedActaId] = useState('')
  const [filter, setFilter] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [loadingActa, setLoadingActa] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [apiError, setApiError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [readingPresentation, setReadingPresentation] = useState(false)
  const [presentationProgress, setPresentationProgress] = useState(0)
  const [presentationPhase, setPresentationPhase] = useState('')
  const [presentationError, setPresentationError] = useState('')
  const [presentationResult, setPresentationResult] = useState(null)
  const [aiKey, setAiKey] = useState('')
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiStatusLoading, setAiStatusLoading] = useState(true)
  const [aiSetupOpen, setAiSetupOpen] = useState(false)
  const [aiSavingKey, setAiSavingKey] = useState(false)
  const [generatingWithAi, setGeneratingWithAi] = useState(false)
  const [aiError, setAiError] = useState('')

  useEffect(() => {
    getAiStatus()
      .then(({ configured }) => setAiConfigured(configured))
      .catch((error) => {
        setAiError(error instanceof Error ? error.message : 'No se pudo consultar la configuración de OpenAI.')
      })
      .finally(() => setAiStatusLoading(false))
  }, [])

  const refreshActas = useCallback(async () => {
    setListLoading(true)
    setApiError('')
    try {
      setActas(await listActas())
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudieron cargar las actas.')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    listActas()
      .then((items) => {
        if (active) setActas(items)
      })
      .catch((error) => {
        if (active) setApiError(error instanceof Error ? error.message : 'No se pudieron cargar las actas.')
      })
      .finally(() => {
        if (active) setListLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const filteredActas = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase('es')
    return actas.filter((acta) => acta.clientName.toLocaleLowerCase('es').includes(query))
  }, [actas, filter])

  const hasUnsavedChanges = useMemo(() => {
    const formChanged = Object.keys(initialForm).some(
      (field) => String(form[field] ?? '') !== String(savedForm[field] ?? ''),
    )
    return formChanged || Object.keys(attachedFiles).length > 0 || removedAttachments.length > 0
  }, [form, savedForm, attachedFiles, removedAttachments])

  const summary = useMemo(() => {
    return {
      title: 'Comisión de Crédito – Comité Ejecutivo',
      client: form.clientName,
      line: form.line,
      amount: formatCurrency(form.amount),
      risk: form.risk,
      recommendation: form.recommendation,
    }
  }, [form])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const handleConfigureAi = async () => {
    setAiSavingKey(true)
    setAiError('')
    try {
      const result = await configureAi(aiKey)
      setAiConfigured(result.configured)
      setAiKey('')
      setAiSetupOpen(false)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No se pudo configurar OpenAI.')
    } finally {
      setAiSavingKey(false)
    }
  }

  const handleGenerateWithAi = async () => {
    if (!aiConfigured) {
      setAiSetupOpen(true)
      setAiError('')
      return
    }
    if (!window.confirm('¿Quieres usar IA para analizar la presentación y los anexos, y completar el acta?')) return

    setGeneratingWithAi(true)
    setAiError('')
    try {
      const attachments = Object.fromEntries(
        Object.entries(attachedFiles).map(([section, attachment]) => [section, attachment.file]),
      )
      const result = await generateWithAi({
        data: form,
        presentationText: presentationResult?.text || '',
        attachments,
      })
      setForm((current) => ({ ...current, ...result.data }))
      setSuccessMessage('La IA completó el acta. Revisa todos los campos antes de guardar.')
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No se pudo generar el acta con IA.')
    } finally {
      setGeneratingWithAi(false)
    }
  }

  const handleFile = (event, section) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      event.target.value = ''
      setUploadErrors((current) => ({
        ...current,
        [section]: 'Selecciona un archivo Excel (.xlsx, .xls o .xlsm).',
      }))
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      event.target.value = ''
      setUploadErrors((current) => ({
        ...current,
        [section]: 'Cada anexo puede ocupar como máximo 20 MB.',
      }))
      return
    }

    setAttachedFiles((current) => ({
      ...current,
      [section]: {
        name: file.name,
        file,
      },
    }))
    event.target.value = ''
    setRemovedAttachments((current) => current.filter((item) => item !== section))
    setUploadErrors((current) => ({ ...current, [section]: '' }))
  }

  const resetActaForm = ({ confirmDiscard = true } = {}) => {
    if (confirmDiscard && hasUnsavedChanges && !window.confirm('¿Descartar los cambios que aún no se han guardado?')) {
      return
    }
    setForm({ ...initialForm })
    setSavedForm({ ...initialForm })
    setSelectedActaId('')
    setAttachedFiles({})
    setSavedAttachments({})
    setRemovedAttachments([])
    setUploadErrors({})
    setExportError('')
    setApiError('')
    setSuccessMessage('')
    setPresentationResult(null)
  }

  const openActa = async (id) => {
    if (id === selectedActaId) return
    if (hasUnsavedChanges && !window.confirm('Descartar los cambios que aún no se han guardado?')) return

    setLoadingActa(true)
    setApiError('')
    setSuccessMessage('')
    try {
      const acta = await getActa(id)
      setForm(acta.data)
      setSavedForm(acta.data)
      setSelectedActaId(acta.id)
      setSavedAttachments(acta.attachments)
      setAttachedFiles({})
      setRemovedAttachments([])
      setUploadErrors({})
      setExportError('')
      setPresentationResult(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudo abrir el acta.')
    } finally {
      setLoadingActa(false)
    }
  }

  const handlePresentation = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setReadingPresentation(true)
    setPresentationProgress(0)
    setPresentationPhase('Preparando lectura...')
    setPresentationError('')
    setPresentationResult(null)

    try {
      const { readPowerPoint } = await import('./powerpoint.js')
      const result = await readPowerPoint(file, {
        onProgress: ({ phase, stage, progress }) => {
          const phaseLabel = phase === 'ocr'
            ? stage === 'loading language traineddata'
              ? 'Cargando el modelo OCR local en español...'
              : stage === 'recognizing text'
                ? 'Reconociendo texto en imágenes...'
                : 'Preparando el motor OCR...'
            : 'Leyendo diapositivas...'
          setPresentationPhase(phaseLabel)
          setPresentationProgress(Math.round(progress * 100))
        },
      })
      const emptyForm = Object.fromEntries(Object.keys(initialForm).map((field) => [field, '']))
      setForm({ ...emptyForm, ...result.fields })
      setPresentationResult({
        name: file.name,
        slideCount: result.slideCount,
        fieldCount: result.fieldCount,
        missingFields: Object.keys(initialForm).filter((field) => !result.fields[field]),
        ocrImageCount: result.ocrImageCount,
        ocrWarning: result.ocrWarning,
        text: result.text.slice(0, 8000),
        textTruncated: result.text.length > 8000,
      })
    } catch (error) {
      setPresentationError(error instanceof Error ? error.message : 'No se pudo leer la presentación.')
    } finally {
      setReadingPresentation(false)
      event.target.value = ''
    }
  }

  const buildWord = async (data = form) => {
    const logoPng = await loadLogoPng()
    const clientName = formatNarrativeValue(data.clientName, 'Cliente no informado')
    const context = { clientName, amount: data.amount, data }

    const blocksToParagraphs = (blocks, { justify = true, spacingAfter = 140 } = {}) => (blocks || []).flatMap((block) => {
      if (block.type === 'bullet') {
        return [new Paragraph({
          text: block.text,
          bullet: { level: 0 },
          alignment: justify ? AlignmentType.JUSTIFIED : undefined,
          spacing: { after: 60 },
        })]
      }
      return [new Paragraph({
        children: [new TextRun({ text: block.text })],
        alignment: justify ? AlignmentType.JUSTIFIED : undefined,
        spacing: { after: spacingAfter },
      })]
    })

    const justifiedParagraph = (text, { spacing = { after: 140 }, bold = false } = {}) => new Paragraph({
      children: [new TextRun({ text, bold })],
      alignment: AlignmentType.JUSTIFIED,
      spacing,
    })

    const metricLabel = (value) => {
      const text = normalizeText(value)
      if (!text) return 'No informado'
      return text
    }

    const attachmentEntries = await Promise.all(attachmentSections.map(async ({ key, label }) => {
      const newFile = attachedFiles[key]?.file || null
      const saved = !removedAttachments.includes(key) ? savedAttachments[key] : null
      let blob = newFile
      if (!blob && saved && selectedActaId) {
        try {
          blob = await downloadActaAttachment(selectedActaId, key)
        } catch {
          blob = null
        }
      }
      const name = newFile?.name || saved?.filename || ''
      let chartData = { datasets: [], summary: [] }
      if (blob) {
        try {
          chartData = await extractExcelChartData(blob, label)
        } catch {
          chartData = { datasets: [], summary: [] }
        }
      }
      return { key, label, name, blob: Boolean(blob), chartData }
    }))

    const validationIssues = collectValidationIssues(data, attachmentEntries)
    const pendingItems = buildPendingItems(data, attachmentEntries)
    const traceability = buildTraceability(data, attachmentEntries)
    const exec = buildExecutiveSummary(data)
    const caseSummary = buildCaseQuantitativeSummary(data, attachmentEntries)
    const allChartDatasets = attachmentEntries.flatMap((entry) => (entry.chartData.datasets || []).map((dataset) => ({ ...dataset, source: entry.label })))

    const identificationRows = [
      ['Cliente', clientName],
      ['Tipo de cliente', metricLabel(data.clientType)],
      ['Tipo de análisis', metricLabel(data.analysisType)],
      ['Línea / producto', metricLabel(data.line)],
      ['Monto solicitado', formatCurrency(data.amount) || 'No informado'],
      ['Proponente', metricLabel(data.proposal)],
      ['Grupo económico', metricLabel(data.group)],
      ['Nivel de riesgo', metricLabel(data.risk)],
    ]
    const identificationTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: identificationRows.map(([label, value]) => new TableRow({
        children: [
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })], spacing: { after: 40 } })],
          }),
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: String(value || 'No informado') })], spacing: { after: 40 } })],
          }),
        ],
      })),
    })

    const executiveRows = [
      ['Cliente', exec.client],
      ['Exposición / monto solicitado', exec.amountText],
      ['Línea / producto', exec.line],
      ['Tipo de análisis', exec.analysisType],
      ['Nivel de riesgo registrado', exec.risk],
      ['Completitud del expediente', exec.completeness],
      ['Postura crediticia documentada', exec.decisionLabel],
    ]
    const executiveTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: executiveRows.map(([label, value]) => new TableRow({
        children: [
          new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })], spacing: { after: 40 } })] }),
          new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: String(value || 'No informado') })], spacing: { after: 40 } })] }),
        ],
      })),
    })

    const children = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ data: logoPng, transformation: { width: 288, height: 24 }, type: 'png' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'ACTA DE ANÁLISIS CREDITICIO', bold: true, size: 32, color: '0F265C' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: summary.title, color: '6E6E73', size: 22 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 320 },
        children: [new TextRun({ text: `Cliente: ${clientName}`, size: 24, bold: true })],
      }),
      new Paragraph({ children: [new TextRun({ text: `Fecha de emisión: ${new Date().toLocaleDateString('es-EC')}`, bold: true })], spacing: { after: 240 } }),

      new Paragraph({ text: 'Resumen ejecutivo', heading: HeadingLevel.HEADING_1 }),
      justifiedParagraph('Síntesis integral del caso con base en la información registrada y los soportes disponibles, destinada a facilitar la deliberación del comité y la trazabilidad de la decisión.'),
      executiveTable,
      new Paragraph({ text: '', spacing: { after: 120 } }),
      justifiedParagraph(buildConclusionStatement(data.recommendation, data.conditions, clientName)),

      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ text: 'Tabla de contenido', heading: HeadingLevel.HEADING_1 }),
      new TableOfContents('Tabla de contenido', { hyperlink: true, headingStyleRange: '1-3' }),
      new Paragraph({ children: [new PageBreak()] }),

      new Paragraph({ text: 'Identificación del cliente y naturaleza de la presentación', heading: HeadingLevel.HEADING_1 }),
      justifiedParagraph(`Se presenta el análisis crediticio de ${clientName} con base en la información registrada y los soportes incorporados al expediente, a fin de sustentar la evaluación del caso y la decisión correspondiente.`),
      identificationTable,
      new Paragraph({ text: '', spacing: { after: 120 } }),

      new Paragraph({ text: 'Alcance y base de evidencia del análisis', heading: HeadingLevel.HEADING_1 }),
      ...(() => {
        const amountText = formatCurrency(data.amount) || 'un monto no informado'
        const riskText = metricLabel(data.risk)
        const sectionKeys = ['profile', 'financial', 'guarantees', 'conditions', 'observations', 'recommendation']
        const informed = sectionKeys.filter((key) => isMeaningfulText(data[key])).length
        const attachedCount = attachmentEntries.filter((entry) => entry?.name || entry?.blob).length
        const missing = sectionKeys
          .filter((key) => !isMeaningfulText(data[key]))
          .map((key) => SECTION_DEFINITIONS.find((s) => s.key === key)?.label || key)
        return [
          justifiedParagraph(`El análisis se realiza sobre ${clientName}, para una exposición solicitada de ${amountText} y un nivel de riesgo registrado de ${riskText}, con base en la información documentada en el expediente: ${informed} de ${sectionKeys.length} secciones cuentan con información sustantiva y se registran ${attachedCount} soporte(s) anexo(s) incorporado(s).`),
          justifiedParagraph('Las conclusiones sobre la capacidad de pago, el riesgo y la viabilidad de la operación se sustentan únicamente en los datos, cifras y evidencias disponibles; los vacíos de información limitan la certidumbre del dictamen y se reflejan en el análisis de cada componente del caso.'),
          justifiedParagraph(missing.length
            ? `La evaluación presenta limitaciones por falta de información sustantiva en: ${missing.join(', ')}; estos componentes deben completarse y respaldarse con evidencia verificable para fortalecer el análisis del sujeto y de sus números.`
            : 'El expediente cuenta con información registrada en los componentes principales; aun así, las cifras y afirmaciones relevantes deben conciliarse con los soportes para confirmar su consistencia y vigencia.'),
        ]
      })(),
    ]

    for (const section of SECTION_DEFINITIONS) {
      const blocks = buildNarrativeBlocks(section.key, section.label, data[section.key], context)
      children.push(new Paragraph({ text: section.label, heading: HeadingLevel.HEADING_1 }))
      children.push(...blocksToParagraphs(blocks))
    }

    children.push(new Paragraph({ text: 'Evaluación integral del riesgo y capacidad de pago', heading: HeadingLevel.HEADING_1 }))
    {
      const amountText = formatCurrency(data.amount) || 'un monto no informado'
      const riskText = metricLabel(data.risk)
      const hasFinancial = isMeaningfulText(data.financial)
      const hasGuarantees = isMeaningfulText(data.guarantees)
      const hasConditions = isMeaningfulText(data.conditions)
      const rec = normalizeText(data.recommendation)
      const recPositive = /\b(se recomienda|aprobar|favorable|procedente|otorgar|conceder|autorizar)\b/i.test(rec)
      const recNegative = /\b(no se recomienda|rechaz|desfavor|no aprobar|improceden|no procedente)\b/i.test(rec)
      const highRisk = /\b(alto|cr[ií]tico|elevado)\b/i.test(normalizeText(data.risk))
      const financialPara = hasFinancial
        ? `La capacidad de pago de ${clientName} frente a la exposición solicitada de ${amountText} debe sustentarse en los ingresos, flujos, obligaciones e indicadores consignados en el análisis financiero; la viabilidad de la operación depende de que dichas cifras evidencien holgura suficiente y estable para atender la deuda.`
        : `No es posible determinar con sustento la capacidad de pago de ${clientName} frente a ${amountText}, al no contarse con información financiera verificable (ingresos, flujos, obligaciones e indicadores), lo que constituye una limitación crítica para evaluar la viabilidad de repago.`
      const mitigantsPara = `En cuanto a la estructura de respaldo y términos, ${hasGuarantees ? 'se registran garantías o mitigantes cuya cobertura y ejecutabilidad deben contrastarse con la exposición' : 'no se identifican garantías o mitigantes documentados que reduzcan la severidad de la pérdida'} y ${hasConditions ? 'se han propuesto condiciones que deben ser coherentes con la capacidad de pago y el riesgo' : 'no se han definido condiciones suficientes para encuadrar la operación'}; el riesgo registrado (${riskText}) ${highRisk ? 'exige mitigantes, controles y condiciones proporcionales y verificables' : 'debe ponderarse junto con la solidez del flujo y de los respaldos'}.`
      let coherencePara = 'La postura crediticia debe resultar coherente con la evidencia disponible sobre perfil, capacidad de pago, mitigantes y términos de la operación.'
      if (recPositive && !recNegative && !hasFinancial) coherencePara = 'La postura de recomendación registrada resulta inconsistente o insuficientemente sustentada mientras no se acredite la capacidad de pago del sujeto frente al monto solicitado.'
      else if (recPositive && !recNegative && highRisk && !hasGuarantees && !hasConditions) coherencePara = 'Una postura favorable, ante un nivel de riesgo elevado y sin mitigantes ni condiciones claramente definidos, requiere sustento adicional y la explicitación de controles para ser consistente con el análisis del caso.'
      else if (rec) coherencePara = 'La recomendación consignada debe interpretarse en función de la coherencia entre los números del caso, la capacidad de pago demostrada, los mitigantes disponibles y las condiciones exigibles.'
      ;[financialPara, mitigantsPara, coherencePara].forEach((text) => children.push(justifiedParagraph(text)))
    }

    const availableAttachments = attachmentEntries.filter((entry) => entry.name)
    children.push(new Paragraph({ text: 'Trazabilidad y soportes del expediente', heading: HeadingLevel.HEADING_1 }))
    if (traceability.length) {
      const traceRows = [
        new TableRow({
          children: ['Elemento', 'Fuente / referencia', 'Estado', 'Detalle'].map((heading) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: heading, bold: true })], spacing: { after: 40 } })],
          })),
        }),
        ...traceability.map((row) => new TableRow({
          children: [row.element, row.source, row.status, row.detail].map((value) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: String(value || '') })], spacing: { after: 40 }, alignment: AlignmentType.JUSTIFIED })],
          })),
        })),
      ]
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: traceRows }))
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    }
    if (availableAttachments.length) {
      for (const entry of availableAttachments) {
        children.push(new Paragraph({ text: `Detalle de soporte: ${entry.label} (${entry.name})`, heading: HeadingLevel.HEADING_2 }))
        children.push(justifiedParagraph('El archivo forma parte de la evidencia del caso; su contenido debe conciliarse con la información consignada y las conclusiones del acta.'))
        if ((entry.chartData.summary || []).length) {
          const sheetBullets = entry.chartData.summary.slice(0, 12).map((item) => ({
            type: 'bullet',
            text: `Hoja ${item.sheetName}: ${item.count} valores numéricos identificados${Number.isFinite(item.total) ? ` (suma referencial: ${item.total.toLocaleString('es-EC')})` : ''}.`,
          }))
          children.push(...blocksToParagraphs(sheetBullets, { spacingAfter: 120 }))
        } else {
          children.push(justifiedParagraph('No se identificaron tablas o series numéricas estructuradas para extracción automática; corresponde revisión directa del anexo.'))
        }
      }
    } else {
      children.push(justifiedParagraph('No se registraron anexos incorporados al expediente en las secciones de soporte definidas.'))
    }

    if (caseSummary.length || allChartDatasets.length) {
      children.push(new Paragraph({ text: 'Información cuantitativa y evidencia gráfica', heading: HeadingLevel.HEADING_1 }))
      if (caseSummary.length) {
        children.push(justifiedParagraph('Indicadores y datos cuantitativos disponibles del caso:'))
        const summaryRows = [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Indicador / dato', bold: true })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Valor', bold: true })] })] }),
            ],
          }),
          ...caseSummary.map((item) => new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(item.label || '') })], spacing: { after: 40 } })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(item.value || 'No informado') })], spacing: { after: 40 } })] }),
            ],
          })),
        ]
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: summaryRows }))
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
      }

      for (const dataset of allChartDatasets) {
        if (!dataset || !(dataset.series || []).length || !(dataset.labels || []).length) continue
        const image = await chartToPng({
          title: dataset.title || `${dataset.source || 'Anexo'}: datos cuantitativos`,
          labels: dataset.labels,
          series: dataset.series,
          kind: dataset.kind || 'bar',
          unit: dataset.unit || '',
        })
        if (!image) continue
        children.push(new Paragraph({ text: dataset.title || 'Gráfico de soporte', heading: HeadingLevel.HEADING_2 }))
        children.push(new Paragraph({
          children: [new ImageRun({ data: image, transformation: { width: 620, height: 290 }, type: 'png' })],
          spacing: { before: 60, after: 100 },
        }))
        const seriesDetail = (dataset.series || []).map((series) => {
          const values = (series.values || []).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map((value) => Number(value).toLocaleString('es-EC'))
          return `${series.name || 'Serie'}: ${values.length ? values.join(', ') : 'sin valores numéricos representados'}`
        }).join(' | ')
        const unitNote = dataset.unit ? ` Unidad/referencia: ${dataset.unit}.` : ''
        const periodNote = dataset.labels?.length ? ` Periodos/categorías: ${dataset.labels.join(', ')}.` : ''
        children.push(justifiedParagraph(`Fuente: ${dataset.source || 'anexo'}.${unitNote}${periodNote} Series: ${seriesDetail}. La interpretación debe considerar tendencia/composición, consistencia con el expediente y su impacto en capacidad de pago, exposición y mitigantes.`))
      }
    } else {
      children.push(new Paragraph({ text: 'Información cuantitativa y evidencia gráfica', heading: HeadingLevel.HEADING_1 }))
      children.push(justifiedParagraph('No se identificaron datos cuantitativos estructurados o series gráficas extraíbles de los anexos disponibles. La evaluación cuantitativa queda supeditada a la información consignada en las secciones narrativas y a la revisión directa de los soportes.'))
    }

    children.push(new Paragraph({ text: 'Pendientes, condiciones y plan de seguimiento', heading: HeadingLevel.HEADING_1 }))
    if (pendingItems.length) {
      justifiedParagraph('A continuación se detallan las observaciones, pendientes y condiciones que requieren gestión para asegurar la suficiencia, consistencia y trazabilidad del expediente:')
      children.push(justifiedParagraph('A continuación se detallan las observaciones, pendientes y condiciones que requieren gestión para asegurar la suficiencia, consistencia y trazabilidad del expediente:'))
      const pendingRows = [
        new TableRow({
          children: ['Área / dato afectado', 'Fuente', 'Hallazgo o pendiente', 'Acción requerida / seguimiento'].map((heading) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: heading, bold: true })], spacing: { after: 40 } })],
          })),
        }),
        ...pendingItems.map((item) => new TableRow({
          children: [item.area, item.source, item.detail, item.action].map((value) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: String(value || '') })], spacing: { after: 40 }, alignment: AlignmentType.JUSTIFIED })],
          })),
        })),
      ]
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pendingRows }))
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    } else {
      children.push(justifiedParagraph('No se identificaron pendientes o inconsistencias explícitas a partir de las validaciones automáticas y la información registrada. Subsiste la obligación de verificar la documentación soporte, la vigencia de la información y el cumplimiento de políticas y condiciones aplicables.'))
    }

    children.push(new Paragraph({ text: 'Conclusión y recomendación crediticia', heading: HeadingLevel.HEADING_1 }))
    children.push(justifiedParagraph(buildConclusionStatement(data.recommendation, data.conditions, clientName)))
    children.push(justifiedParagraph('La presente conclusión se emite con base en la evidencia disponible y documentada. Su validez está condicionada a la exactitud, integridad y trazabilidad de la información, al cierre o gestión de los pendientes identificados y a la verificación de que no existan hechos o datos relevantes adicionales no considerados en este acta.'))

    const documentFile = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22, color: '2C2C30' },
            paragraph: { spacing: { after: 140 } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children,
      }],
    })
    return {
      blob: await Packer.toBlob(documentFile),
      filename: getWordFilename(data.clientName),
    }
  }
  const exportActa = async () => {
    if (!form.clientName.trim()) {
      setExportError('Ingresa el nombre del cliente para generar el acta.')
      return
    }

    setExporting(true)
    setExportError('')
    try {
      const { blob, filename } = await buildWord()
      downloadBlob(blob, filename)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo generar el acta.')
      console.error(error)
    } finally {
      setExporting(false)
    }
  }

  const handleSaveActa = async () => {
    if (!form.clientName.trim()) {
      setApiError('Ingresa el nombre del cliente para guardar el acta.')
      return
    }

    setSaving(true)
    setApiError('')
    setSuccessMessage('')
    try {
      const normalizedForm = Object.fromEntries(
        Object.entries(form).map(([field, value]) => [field, typeof value === 'string' ? value.trim() : value]),
      )

      let blob
      let filename
      try {
        ;({ blob, filename } = await buildWord(normalizedForm))
      } catch (error) {
        throw new Error(error instanceof Error ? `No se pudo generar el documento Word: ${error.message}` : 'No se pudo generar el documento Word para guardar el acta.')
      }

      const wordFile = typeof File === 'function'
        ? new File([blob], filename, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
        : Object.assign(blob, { name: filename })
      const uploads = Object.fromEntries(
        Object.entries(attachedFiles)
          .map(([section, attachment]) => [section, attachment?.file])
          .filter(([, file]) => file),
      )
      const result = await saveActa({
        id: selectedActaId,
        data: normalizedForm,
        word: wordFile,
        attachments: uploads,
        removedAttachments,
      })
      const nextSavedAttachments = { ...savedAttachments }
      for (const section of removedAttachments) delete nextSavedAttachments[section]
      for (const [section, file] of Object.entries(uploads)) {
        nextSavedAttachments[section] = { filename: file.name }
      }
      setSelectedActaId(result.id)
      setForm(normalizedForm)
      setSavedForm(normalizedForm)
      setSavedAttachments(nextSavedAttachments)
      setAttachedFiles({})
      setRemovedAttachments([])
      await refreshActas()
      setSuccessMessage('Acta guardada en la base local.')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudo guardar el acta.')
      console.error('Error al guardar acta:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteActa = async (acta) => {
    const discardsChanges = selectedActaId === acta.id && hasUnsavedChanges
    const warning = discardsChanges
      ? `¿Eliminar el acta de ${acta.clientName} y descartar los cambios sin guardar? Esta acción no se puede deshacer.`
      : `¿Eliminar el acta de ${acta.clientName}? Esta acción no se puede deshacer.`
    if (!window.confirm(warning)) return

    setDeletingId(acta.id)
    setApiError('')
    setSuccessMessage('')
    try {
      await deleteActa(acta.id)
      setActas((current) => current.filter((item) => item.id !== acta.id))
      if (selectedActaId === acta.id) resetActaForm({ confirmDiscard: false })
      setSuccessMessage('Acta eliminada.')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudo eliminar el acta.')
    } finally {
      setDeletingId('')
    }
  }

  const handleDownloadArchivedWord = async (acta) => {
    setApiError('')
    try {
      const blob = await downloadActaWord(acta.id)
      downloadBlob(blob, getWordFilename(acta.clientName))
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudo descargar el Word archivado.')
    }
  }

  const handleDownloadAttachment = async (section) => {
    setApiError('')
    try {
      const blob = await downloadActaAttachment(selectedActaId, section)
      downloadBlob(blob, savedAttachments[section].filename)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'No se pudo descargar el anexo.')
    }
  }

  const handleRemoveAttachment = (section) => {
    if (attachedFiles[section]) {
      setAttachedFiles((current) => {
        const next = { ...current }
        delete next[section]
        return next
      })
    } else if (savedAttachments[section]) {
      setRemovedAttachments((current) => [...new Set([...current, section])])
    }
    setUploadErrors((current) => ({ ...current, [section]: '' }))
  }

  const renderNarrativeBlocks = (blocks, keyPrefix) => {
    const elements = []
    let bulletBuffer = []
    const flushBullets = (index) => {
      if (!bulletBuffer.length) return
      elements.push(
        <ul key={`${keyPrefix}-ul-${index}`}>
          {bulletBuffer.map((item, itemIndex) => <li key={`${keyPrefix}-li-${index}-${itemIndex}`}>{item}</li>)}
        </ul>,
      )
      bulletBuffer = []
    }
    blocks.forEach((block, index) => {
      if (block.type === 'bullet') {
        bulletBuffer.push(block.text)
      } else {
        flushBullets(index)
        elements.push(<p key={`${keyPrefix}-p-${index}`}>{block.text}</p>)
      }
    })
    flushBullets(blocks.length)
    return elements
  }

  const previewContext = { clientName: form.clientName || 'Cliente', amount: form.amount, data: form }
  const quantitativePreview = buildCaseQuantitativeSummary(form, attachmentSections.map(({ key, label }) => {
    const file = attachedFiles[key]?.file
    return { label, summary: file ? [{ sheetName: 'Anexo cargado', count: 0, total: 0 }] : [] }
  }))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-logo" src="/pichincha-logo.svg" alt="Banco Pichincha" />
        </div>
        <span className="status-pill">SQLite local</span>
      </header>

      <main className="layout">
        <section className="panel records-panel" aria-labelledby="records-title">
          <div className="records-header">
            <div>
              <div className="section-tag">Archivo local</div>
              <h2 id="records-title">Actas guardadas <span>{actas.length}</span></h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => resetActaForm()}
              disabled={saving || loadingActa}
            >
              Nueva acta
            </button>
          </div>
          <label className="record-filter">
            <span>Buscar por cliente</span>
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Nombre del cliente"
            />
          </label>
          {apiError && <p className="export-error" role="alert">{apiError}</p>}
          {successMessage && <p className="success-message" role="status">{successMessage}</p>}
          <div className="acta-list" aria-live="polite">
            {listLoading && <p className="small-note">Cargando actas…</p>}
            {!listLoading && !apiError && actas.length === 0 && (
              <p className="small-note">Aún no hay actas guardadas. Completa el formulario y guarda la primera.</p>
            )}
            {!listLoading && actas.length > 0 && filteredActas.length === 0 && (
              <p className="small-note">No hay actas que coincidan con la búsqueda.</p>
            )}
            {filteredActas.map((acta) => (
              <article
                className={`acta-row${selectedActaId === acta.id ? ' selected' : ''}`}
                key={acta.id}
              >
                <button
                  type="button"
                  className="acta-select"
                  onClick={() => openActa(acta.id)}
                  disabled={loadingActa || saving}
                >
                  <strong>{acta.clientName}</strong>
                  <span>Actualizada {new Date(acta.updatedAt).toLocaleString('es-EC')}</span>
                </button>
                <div className="acta-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => handleDownloadArchivedWord(acta)}
                  >
                    Descargar Word
                  </button>
                  <button
                    type="button"
                    className="text-button danger-button"
                    onClick={() => handleDeleteActa(acta)}
                    disabled={deletingId === acta.id || saving}
                  >
                    {deletingId === acta.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel form-panel">
          <div className="section-tag">Generación</div>
          <h1>{selectedActaId ? 'Editar acta guardada' : 'Datos del caso'}</h1>
          {hasUnsavedChanges && <p className="small-note" role="status">Cambios sin guardar</p>}
          {loadingActa && <p className="small-note" role="status">Cargando acta…</p>}

          <section className="presentation-import" aria-labelledby="presentation-title">
            <div className="presentation-import-copy">
              <h2 id="presentation-title">Crear desde PowerPoint</h2>
              <p>Lee texto editable y texto en imágenes comunes con OCR en español. El modelo se usa localmente; la presentación permanece en el navegador. No admite archivos .ppt antiguos.</p>
            </div>
            <label className="presentation-picker">
              <span>{readingPresentation ? 'Leyendo presentación...' : 'Cargar la presentación'}</span>
              <input
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={handlePresentation}
                disabled={readingPresentation}
              />
            </label>
            {readingPresentation && (
              <div className="presentation-progress" role="status">
                <span>{presentationPhase}</span>
                <progress max="100" value={presentationProgress} />
                <small>{presentationProgress}%</small>
              </div>
            )}
            {presentationError && <p className="field-error" role="alert">{presentationError}</p>}
            {presentationResult && (
              <div className="presentation-result" role="status">
                <strong>{presentationResult.name}</strong>
                <span>{presentationResult.slideCount} diapositivas · {presentationResult.fieldCount} de 14 campos detectados · {presentationResult.ocrImageCount} imágenes procesadas con OCR</span>
                {presentationResult.missingFields.length > 0 && (
                  <small className="field-error">
                    No reconocí automáticamente: {presentationResult.missingFields.map((field) => formFieldLabels[field]).join(', ')}.
                  </small>
                )}
                {presentationResult.ocrWarning && <small className="field-error">{presentationResult.ocrWarning}</small>}
                <details>
                  <summary>Revisar texto extraído (incluye OCR)</summary>
                  <pre>{presentationResult.text}</pre>
                  {presentationResult.textTruncated && <small>Vista limitada a los primeros 8.000 caracteres.</small>}
                </details>
              </div>
            )}
          </section>

          <section className="ai-assistant" aria-labelledby="ai-assistant-title">
            <div>
              <h2 id="ai-assistant-title">Asistente de IA</h2>
              <p>Analiza la presentación, los anexos Excel y los datos actuales para completar el acta.</p>
            </div>
            <button
              type="button"
              className="save-button"
              onClick={handleGenerateWithAi}
              disabled={generatingWithAi || loadingActa || saving || aiStatusLoading}
            >
              {generatingWithAi ? 'Analizando…' : 'Análisis con IA'}
            </button>
            {aiSetupOpen && (
              <div className="ai-config" aria-label="Configuración de OpenAI">
                <label>
                  <span>API key de OpenAI</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={aiKey}
                    onChange={(event) => setAiKey(event.target.value)}
                    placeholder="Ingresa tu API key"
                  />
                </label>
                <div className="ai-config-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={handleConfigureAi}
                    disabled={aiSavingKey || !aiKey.trim()}
                  >
                    {aiSavingKey ? 'Guardando…' : 'Guardar clave'}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setAiSetupOpen(false)
                      setAiKey('')
                      setAiError('')
                    }}
                    disabled={aiSavingKey}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {aiConfigured && !aiSetupOpen && (
              <button
                type="button"
                className="text-button ai-change-key"
                onClick={() => setAiSetupOpen(true)}
              >
                Cambiar API key
              </button>
            )}
            <span className={`ai-status${aiConfigured ? ' configured' : ''}`}>
              {aiStatusLoading ? 'Verificando…' : aiConfigured ? 'IA configurada' : 'IA no configurada'}
            </span>
            {aiError && <p className="field-error" role="alert">{aiError}</p>}
          </section>

          <fieldset className="acta-fields" disabled={saving || loadingActa}>
          <div className="field-grid">
            <label>
              <span>Cliente</span>
              <input name="clientName" value={form.clientName} onChange={handleChange} required maxLength={20000} />
            </label>

            <label>
              <span>Tipo de cliente</span>
              <select name="clientType" value={form.clientType} onChange={handleChange}>
                <option value="">No identificado</option>
                <option>Persona natural</option>
                <option>PYME</option>
                <option>Corporativo</option>
                <option>Grupo económico</option>
              </select>
            </label>

            <label>
              <span>Tipo de análisis</span>
              <select name="analysisType" value={form.analysisType} onChange={handleChange}>
                <option value="">No identificado</option>
                <option>Crédito ordinario</option>
                <option>Reestructuración</option>
                <option>Riesgo concentrado</option>
                <option>Crédito puntual</option>
              </select>
            </label>

            <label>
              <span>Línea</span>
              <input name="line" value={form.line} onChange={handleChange} />
            </label>

            <label>
              <span>Monto</span>
              <input
                type="number"
                name="amount"
                value={form.amount}
                min="0"
                step="any"
                onChange={handleChange}
              />
            </label>

            <label>
              <span>Proponente</span>
              <input name="proposal" value={form.proposal} onChange={handleChange} />
            </label>

            <label className="span-2">
              <span>Grupo económico</span>
              <input name="group" value={form.group} onChange={handleChange} />
            </label>

            <label>
              <span>Nivel de riesgo</span>
              <select name="risk" value={form.risk} onChange={handleChange}>
                <option value="">No identificado</option>
                <option>Bajo</option>
                <option>Medio</option>
                <option>Alto</option>
              </select>
            </label>

            <label className="span-2">
              <span>Perfil del cliente</span>
              <textarea name="profile" value={form.profile} onChange={handleChange} />
            </label>

            {attachmentSections.map(({ key, label }) => {
              const savedAttachment = savedAttachments[key]
              const attachmentName = attachedFiles[key]?.name
                || (!removedAttachments.includes(key) && savedAttachment?.filename)
              return (
                <label className="span-2" key={key}>
                  <span>{label}</span>
                  <textarea name={key} value={form[key]} onChange={handleChange} maxLength={20000} />
                  <input
                    key={`${selectedActaId}-${attachedFiles[key]?.name || ''}-${savedAttachment?.filename || ''}-${removedAttachments.includes(key)}`}
                    type="file"
                    accept=".xlsx,.xls,.xlsm"
                    aria-label={`Anexo Excel para ${label}`}
                    onChange={(event) => handleFile(event, key)}
                  />
                  {attachmentName && <small>Anexo: {attachmentName}</small>}
                  {uploadErrors[key] && <small className="field-error">{uploadErrors[key]}</small>}
                  {(attachedFiles[key] || savedAttachment) && (
                    <div className="attachment-actions">
                      {savedAttachment && !removedAttachments.includes(key) && selectedActaId && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => handleDownloadAttachment(key)}
                        >
                          Descargar anexo guardado
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button danger-button"
                        onClick={() => handleRemoveAttachment(key)}
                      >
                        {attachedFiles[key] ? 'Cancelar archivo nuevo' : 'Quitar anexo'}
                      </button>
                    </div>
                  )}
                  {removedAttachments.includes(key) && (
                    <small className="field-error">El anexo se quitará al guardar.</small>
                  )}
                </label>
              )
            })}

            <label className="span-2">
              <span>Recomendación</span>
              <input name="recommendation" value={form.recommendation} onChange={handleChange} />
            </label>

            <label className="span-2">
              <span>Observaciones</span>
              <textarea name="observations" value={form.observations} onChange={handleChange} />
            </label>
          </div>
          </fieldset>
        </section>

        <aside className="panel preview-panel">
          <div className="preview-header">
            <div>
              <strong>Vista previa</strong>
              <span>Documento para comité</span>
            </div>
            <div className="preview-actions">
              <button
                type="button"
                className="save-button"
                onClick={handleSaveActa}
                disabled={saving || exporting || loadingActa || Boolean(deletingId)}
              >
                {saving ? 'Guardando…' : selectedActaId ? 'Guardar cambios' : 'Guardar acta'}
              </button>
              <button type="button" className="export-button" onClick={exportActa} disabled={exporting || saving}>
                {exporting ? 'Generando acta…' : 'Generar acta'}
              </button>
            </div>
          </div>
          {exportError && <p className="export-error" role="alert">{exportError}</p>}

          <div className="preview-card">
            <div className="preview-kicker">{summary.title}</div>
            <h2>{summary.client || 'Cliente sin nombre'}</h2>

            <div className="meta-grid">
              <div>
                <span>Línea</span>
                <strong>{formatNarrativeValue(form.line, 'No informada')}</strong>
              </div>
              <div>
                <span>Monto</span>
                <strong>{formatCurrency(form.amount) || 'No informado'}</strong>
              </div>
              <div>
                <span>Riesgo</span>
                <strong>{formatNarrativeValue(form.risk, 'No informado')}</strong>
              </div>
            </div>

            {(() => {
              const exec = buildExecutiveSummary(form)
              return (
                <section className="summary-block">
                  <h3>Resumen ejecutivo</h3>
                  <ul>
                    <li><strong>Cliente:</strong> {exec.client}</li>
                    <li><strong>Exposición / monto solicitado:</strong> {exec.amountText}</li>
                    <li><strong>Línea / producto:</strong> {exec.line}</li>
                    <li><strong>Tipo de análisis:</strong> {exec.analysisType}</li>
                    <li><strong>Nivel de riesgo registrado:</strong> {exec.risk}</li>
                    <li><strong>Completitud del expediente:</strong> {exec.completeness}</li>
                    <li><strong>Postura crediticia documentada:</strong> {exec.decisionLabel}</li>
                  </ul>
                  <p>{buildConclusionStatement(form.recommendation, form.conditions, form.clientName || 'el cliente evaluado')}</p>
                </section>
              )
            })()}

            <section className="summary-block">
              <h3>Identificación y naturaleza de la presentación</h3>
              <ul>
                <li><strong>Cliente:</strong> {formatNarrativeValue(form.clientName, 'No informado')}</li>
                <li><strong>Tipo de cliente:</strong> {formatNarrativeValue(form.clientType, 'No informado')}</li>
                <li><strong>Tipo de análisis:</strong> {formatNarrativeValue(form.analysisType, 'No informado')}</li>
                <li><strong>Línea / producto:</strong> {formatNarrativeValue(form.line, 'No informado')}</li>
                <li><strong>Monto solicitado:</strong> {formatCurrency(form.amount) || 'No informado'}</li>
                <li><strong>Proponente:</strong> {formatNarrativeValue(form.proposal, 'No informado')}</li>
                <li><strong>Grupo económico:</strong> {formatNarrativeValue(form.group, 'No informado')}</li>
                <li><strong>Nivel de riesgo:</strong> {formatNarrativeValue(form.risk, 'No informado')}</li>
              </ul>
            </section>

            <section className="summary-block">
              <h3>Alcance y base de evidencia del análisis</h3>
              {(() => {
                const client = formatNarrativeValue(form.clientName, 'el sujeto de crédito evaluado')
                const amountText = formatCurrency(form.amount) || 'un monto no informado'
                const riskText = formatNarrativeValue(form.risk, 'no informado')
                const sectionKeys = ['profile', 'financial', 'guarantees', 'conditions', 'observations', 'recommendation']
                const informed = sectionKeys.filter((key) => isMeaningfulText(form[key])).length
                const attachedCount = attachmentSections.filter(({ key }) => attachedFiles[key]?.name || (!removedAttachments.includes(key) && savedAttachments[key]?.filename)).length
                const missing = sectionKeys.filter((key) => !isMeaningfulText(form[key])).map((key) => SECTION_DEFINITIONS.find((s) => s.key === key)?.label || key)
                return (
                  <>
                    <p>El análisis se realiza sobre {client}, para una exposición solicitada de {amountText} y un nivel de riesgo registrado de {riskText}, con base en la información documentada en el expediente: {informed} de {sectionKeys.length} secciones cuentan con información sustantiva y se registran {attachedCount} soporte(s) anexo(s) incorporado(s).</p>
                    <p>Las conclusiones sobre la capacidad de pago, el riesgo y la viabilidad de la operación se sustentan únicamente en los datos, cifras y evidencias disponibles; los vacíos de información limitan la certidumbre del dictamen y se reflejan en el análisis de cada componente del caso.</p>
                    {missing.length
                      ? <p>La evaluación presenta limitaciones por falta de información sustantiva en: {missing.join(', ')}; estos componentes deben completarse y respaldarse con evidencia verificable para fortalecer el análisis del sujeto y de sus números.</p>
                      : <p>El expediente cuenta con información registrada en los componentes principales; aun así, las cifras y afirmaciones relevantes deben conciliarse con los soportes para confirmar su consistencia y vigencia.</p>}
                  </>
                )
              })()}
            </section>

            {SECTION_DEFINITIONS.map((section) => (
              <section className="summary-block" key={section.key}>
                <h3>{section.label}</h3>
                {renderNarrativeBlocks(buildNarrativeBlocks(section.key, section.label, form[section.key], previewContext), section.key)}
              </section>
            ))}

            <section className="summary-block">
              <h3>Evaluación integral del riesgo y capacidad de pago</h3>
              {(() => {
                const client = formatNarrativeValue(form.clientName, 'el sujeto de crédito evaluado')
                const amountText = formatCurrency(form.amount) || 'un monto no informado'
                const riskText = formatNarrativeValue(form.risk, 'no informado')
                const hasFinancial = isMeaningfulText(form.financial)
                const hasGuarantees = isMeaningfulText(form.guarantees)
                const hasConditions = isMeaningfulText(form.conditions)
                const rec = normalizeText(form.recommendation)
                const recPositive = /\b(se recomienda|aprobar|favorable|procedente|otorgar|conceder|autorizar)\b/i.test(rec)
                const recNegative = /\b(no se recomienda|rechaz|desfavor|no aprobar|improceden|no procedente)\b/i.test(rec)
                const highRisk = /\b(alto|cr[ií]tico|elevado)\b/i.test(normalizeText(form.risk))
                const financialPara = hasFinancial
                  ? `La capacidad de pago de ${client} frente a la exposición solicitada de ${amountText} debe sustentarse en los ingresos, flujos, obligaciones e indicadores consignados en el análisis financiero; la viabilidad de la operación depende de que dichas cifras evidencien holgura suficiente y estable para atender la deuda.`
                  : `No es posible determinar con sustento la capacidad de pago de ${client} frente a ${amountText}, al no contarse con información financiera verificable (ingresos, flujos, obligaciones e indicadores), lo que constituye una limitación crítica para evaluar la viabilidad de repago.`
                const mitigantsPara = `En cuanto a la estructura de respaldo y términos, ${hasGuarantees ? 'se registran garantías o mitigantes cuya cobertura y ejecutabilidad deben contrastarse con la exposición' : 'no se identifican garantías o mitigantes documentados que reduzcan la severidad de la pérdida'} y ${hasConditions ? 'se han propuesto condiciones que deben ser coherentes con la capacidad de pago y el riesgo' : 'no se han definido condiciones suficientes para encuadrar la operación'}; el riesgo registrado (${riskText}) ${highRisk ? 'exige mitigantes, controles y condiciones proporcionales y verificables' : 'debe ponderarse junto con la solidez del flujo y de los respaldos'}.`
                let coherencePara = 'La postura crediticia debe resultar coherente con la evidencia disponible sobre perfil, capacidad de pago, mitigantes y términos de la operación.'
                if (recPositive && !recNegative && !hasFinancial) coherencePara = 'La postura de recomendación registrada resulta inconsistente o insuficientemente sustentada mientras no se acredite la capacidad de pago del sujeto frente al monto solicitado.'
                else if (recPositive && !recNegative && highRisk && !hasGuarantees && !hasConditions) coherencePara = 'Una postura favorable, ante un nivel de riesgo elevado y sin mitigantes ni condiciones claramente definidos, requiere sustento adicional y la explicitación de controles para ser consistente con el análisis del caso.'
                else if (rec) coherencePara = 'La recomendación consignada debe interpretarse en función de la coherencia entre los números del caso, la capacidad de pago demostrada, los mitigantes disponibles y las condiciones exigibles.'
                return (
                  <>
                    <p>{financialPara}</p>
                    <p>{mitigantsPara}</p>
                    <p>{coherencePara}</p>
                  </>
                )
              })()}
            </section>

            {(() => {
              const previewAttachments = attachmentSections.map(({ key, label }) => {
                const name = attachedFiles[key]?.name || (!removedAttachments.includes(key) && savedAttachments[key]?.filename) || ''
                return { key, label, name, filename: name, blob: Boolean(attachedFiles[key]?.file || (!removedAttachments.includes(key) && savedAttachments[key])), chartData: { datasets: [], summary: [] } }
              })
              const traceability = buildTraceability(form, previewAttachments)
              const available = previewAttachments.filter((entry) => entry.name)
              return (
                <section className="summary-block">
                  <h3>Trazabilidad y soportes del expediente</h3>
                  <ul>
                    {traceability.map((row, index) => (
                      <li key={`t-${index}`}><strong>{row.element}</strong> — {row.source} [{row.status}]: {row.detail}</li>
                    ))}
                  </ul>
                  {available.length ? (
                    <ul>
                      {available.map((entry) => (
                        <li key={`a-${entry.key}`}><strong>Soporte incorporado:</strong> {entry.label} — {entry.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No se registraron anexos incorporados al expediente en las secciones de soporte definidas.</p>
                  )}
                </section>
              )
            })()}

            {(() => {
              const previewAttachments = attachmentSections.map(({ key, label }) => {
                const name = attachedFiles[key]?.name || (!removedAttachments.includes(key) && savedAttachments[key]?.filename) || ''
                return { key, label, name, filename: name, blob: Boolean(attachedFiles[key]?.file || (!removedAttachments.includes(key) && savedAttachments[key])), chartData: { datasets: [], summary: [] } }
              })
              const metrics = buildCaseQuantitativeSummary(form, previewAttachments)
              return (
                <section className="summary-block">
                  <h3>Información cuantitativa y evidencia disponible</h3>
                  {metrics.length ? (
                    <ul>
                      {metrics.map((item, index) => (
                        <li key={`q-${index}`}><strong>{item.label}:</strong> {item.value}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No se dispone de indicadores cuantitativos registrados.</p>
                  )}
                  <p>La evidencia gráfica y el detalle de series extraíbles de anexos se incluyen en el documento Word cuando corresponda; en la vista previa se presenta la síntesis disponible.</p>
                </section>
              )
            })()}

            {(() => {
              const previewAttachmentEntries = attachmentSections.map(({ key, label }) => ({
                key,
                label,
                name: attachedFiles[key]?.name || (!removedAttachments.includes(key) && savedAttachments[key]?.filename) || '',
                chartData: { datasets: [], summary: [] },
              }))
              const pending = buildPendingItems(form, previewAttachmentEntries)
              return (
                <section className="summary-block">
                  <h3>Pendientes, condiciones y plan de seguimiento</h3>
                  {pending.length ? (
                    <ul>
                      {pending.map((item, index) => (
                        <li key={`p-${index}`}><strong>{item.area}</strong> ({item.source}): {item.detail} <em>Acción requerida/seguimiento:</em> {item.action}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No se identificaron pendientes o inconsistencias explícitas a partir de las validaciones automáticas y la información registrada. Subsiste la obligación de verificar la documentación soporte, la vigencia de la información y el cumplimiento de políticas y condiciones aplicables.</p>
                  )}
                </section>
              )
            })()}

            <section className="summary-block">
              <h3>Conclusión y recomendación crediticia</h3>
              <p>{buildConclusionStatement(form.recommendation, form.conditions, form.clientName || 'el cliente evaluado')}</p>
              <p>La presente conclusión se emite con base en la evidencia disponible y documentada. Su validez está condicionada a la exactitud, integridad y trazabilidad de la información, al cierre o gestión de los pendientes identificados y a la verificación de que no existan hechos o datos relevantes adicionales no considerados en este acta.</p>
            </section>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
