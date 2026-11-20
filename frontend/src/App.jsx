import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
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

function formatCurrency(value) {
  if (value === '' || value === null || value === undefined) return 'No especificado'
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0)
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
    image.onerror = reject
  })

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar el logo para Word.')
  context.drawImage(image, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo preparar el logo para Word.')
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
    const details = [
      ['Cliente', data.clientName],
      ['Tipo de cliente', data.clientType],
      ['Tipo de análisis', data.analysisType],
      ['Línea', data.line],
      ['Monto solicitado', formatCurrency(data.amount)],
      ['Proponente', data.proposal],
      ['Grupo económico', data.group],
      ['Nivel de riesgo', data.risk],
    ]
    const sections = [
      ['Perfil del cliente', data.profile, null],
      ['Análisis financiero', data.financial, 'financial'],
      ['Garantías', data.guarantees, 'guarantees'],
      ['Condiciones', data.conditions, 'conditions'],
      ['Recomendación', data.recommendation, null],
      ['Observaciones', data.observations, null],
    ]
    const children = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: logoPng,
            transformation: { width: 288, height: 24 },
            type: 'png',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: 'ACTA DE REUNIÓN', bold: true, size: 32, color: '0F265C' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: summary.title, color: '6E6E73', size: 22 })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `Fecha de generación: ${new Date().toLocaleDateString('es-EC')}` })],
      }),
      new Paragraph({ text: 'Datos del caso', heading: HeadingLevel.HEADING_1 }),
      ...details.map(([label, value]) => new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true }),
          new TextRun({ text: String(value || 'No especificado') }),
        ],
      })),
      ...sections.flatMap(([label, value, section]) => {
        const attachment = attachedFiles[section]
          || (removedAttachments.includes(section) ? null : savedAttachments[section])
        return [
          new Paragraph({ text: label, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: value || 'No especificado' })] }),
          ...(attachment
            ? [new Paragraph({
                children: [
                  new TextRun({ text: 'Anexo Excel: ', bold: true }),
                  new TextRun({ text: attachment.name || attachment.filename }),
                ],
              })]
            : []),
        ]
      }),
    ]
    const documentFile = new Document({
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22, color: '2C2C30' },
            paragraph: { spacing: { after: 140 } },
          },
        },
      },
      sections: [{ children }],
    })
    return {
      blob: await Packer.toBlob(documentFile),
      filename: getWordFilename(data.clientName),
    }
  }

  const exportActa = async () => {
    if (!form.clientName.trim()) {
      setExportError('Ingresa el nombre del cliente para generar el Word.')
      return
    }

    setExporting(true)
    setExportError('')
    try {
      const { blob, filename } = await buildWord()
      downloadBlob(blob, filename)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'No se pudo generar el Word.')
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
      const { blob, filename } = await buildWord(normalizedForm)
      const word = new File([blob], filename, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const uploads = Object.fromEntries(
        Object.entries(attachedFiles).map(([section, attachment]) => [section, attachment.file]),
      )
      const result = await saveActa({
        id: selectedActaId,
        data: normalizedForm,
        word,
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
                {exporting ? 'Generando…' : 'Descargar Word'}
              </button>
            </div>
          </div>
          {exportError && <p className="export-error" role="alert">{exportError}</p>}

          <div className="preview-card">
            <div className="preview-kicker">{summary.title}</div>
            <h2>{summary.client}</h2>

            <div className="meta-grid">
              <div>
                <span>Línea</span>
                <strong>{summary.line}</strong>
              </div>
              <div>
                <span>Monto</span>
                <strong>{summary.amount}</strong>
              </div>
              <div>
                <span>Riesgo</span>
                <strong>{summary.risk}</strong>
              </div>
            </div>

            <section className="summary-block">
              <h3>Perfil</h3>
              <p>{form.profile}</p>
            </section>

            <section className="summary-block">
              <h3>Análisis financiero</h3>
              <p>{form.financial}</p>
            </section>

            <section className="summary-block">
              <h3>Garantías</h3>
              <p>{form.guarantees}</p>
            </section>

            <section className="summary-block">
              <h3>Condiciones</h3>
              <p>{form.conditions}</p>
            </section>

            <div className="recommendation-row">
              <span>Recomendación</span>
              <strong>{summary.recommendation}</strong>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
