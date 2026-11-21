import JSZip from 'jszip'

const CELL_REF = /([A-Z]+)(\d+)/

function columnIndex(reference) {
  const match = String(reference || '').match(CELL_REF)
  if (!match) return 0
  return match[1].split('').reduce((total, character) => total * 26 + (character.charCodeAt(0) - 64), 0)
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = normalizeText(value)
  if (!text) return null
  const compact = text.replace(/\s/g, '')
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)
    ? compact.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function isPeriodLabel(value) {
  const text = normalizeText(value)
  if (!text) return false
  return /^(19|20)\d{2}([-/](0?[1-9]|1[0-2]))?$/.test(text)
    || /^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(text)
    || /^(q[1-4]|t[1-4])\s*(19|20)\d{2}$/i.test(text)
    || /(19|20)\d{2}/.test(text) && text.length <= 20
}

function readXmlText(node) {
  if (!node) return ''
  const texts = Array.from(node.getElementsByTagName('t'))
  if (texts.length) return texts.map((entry) => entry.textContent || '').join('')
  return node.textContent || ''
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return []
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')
  return Array.from(document.getElementsByTagName('si')).map((item) => readXmlText(item))
}

function parseSheetRows(xmlText, sharedStrings) {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')
  const rows = []
  for (const rowNode of Array.from(document.getElementsByTagName('row'))) {
    const row = []
    for (const cell of Array.from(rowNode.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') || ''
      const index = Math.max(columnIndex(reference) - 1, 0)
      const type = cell.getAttribute('t')
      let value = ''
      if (type === 's') {
        value = sharedStrings[Number(cell.getElementsByTagName('v')[0]?.textContent || '0')] ?? ''
      } else if (type === 'inlineStr') {
        value = readXmlText(cell.getElementsByTagName('is')[0])
      } else {
        value = cell.getElementsByTagName('v')[0]?.textContent || readXmlText(cell)
      }
      row[index] = value
    }
    while (row.length && normalizeText(row[row.length - 1]) === '') row.pop()
    if (row.some((cell) => normalizeText(cell) !== '')) rows.push(row.map((cell) => cell ?? ''))
  }
  return rows
}

function buildDatasetsFromRows(rows, sheetName) {
  const datasets = []
  if (!rows.length) return datasets
  const header = rows[0].map(normalizeText)
  const body = rows.slice(1)

  const headerHasPeriods = header.slice(1).some(isPeriodLabel)
  const firstColumnPeriods = body.length >= 2 && body.every((row) => isPeriodLabel(row[0]) || normalizeText(row[0]) === '')

  if (headerHasPeriods) {
    const labels = header.slice(1).filter(Boolean)
    for (const row of body) {
      const name = normalizeText(row[0]) || 'Serie'
      const values = labels.map((_, index) => parseNumber(row[index + 1]))
      if (values.some((value) => value !== null)) {
        datasets.push({
          kind: 'line',
          sheetName,
          title: `${sheetName} · ${name}`,
          labels,
          series: [{ name, values }],
        })
      }
    }
    return datasets
  }

  if (firstColumnPeriods) {
    const labels = body.map((row) => normalizeText(row[0])).filter(Boolean)
    const seriesNames = header.slice(1).map((name, index) => normalizeText(name) || `Valor ${index + 1}`)
    const series = seriesNames.map((name, index) => ({
      name,
      values: body.map((row) => parseNumber(row[index + 1])),
    })).filter((entry) => entry.values.some((value) => value !== null))
    if (series.length) {
      datasets.push({ kind: 'line', sheetName, title: `${sheetName} · Tendencia histórica`, labels, series })
    }
    return datasets
  }

  const numericColumns = header.map((_, index) => index > 0 && rows.some((row) => parseNumber(row[index]) !== null))
  const labelColumn = 0
  if (numericColumns.some(Boolean)) {
    const labels = body.map((row) => normalizeText(row[labelColumn]) || `Fila`).slice(0, 24)
    const series = header.map((name, index) => ({ index, name: normalizeText(name) || `Valor ${index}` }))
      .filter(({ index }) => numericColumns[index])
      .map(({ index, name }) => ({ name, values: body.slice(0, 24).map((row) => parseNumber(row[index])) }))
      .filter((entry) => entry.values.some((value) => value !== null))
    if (series.length) {
      datasets.push({ kind: 'bar', sheetName, title: `${sheetName} · Datos cuantitativos`, labels, series })
    }
  }

  return datasets
}

export async function extractExcelChartData(file, sectionLabel) {
  if (!file) return { datasets: [], summary: [] }
  const buffer = file.arrayBuffer ? await file.arrayBuffer() : file
  const archive = await JSZip.loadAsync(buffer)
  const sharedStrings = parseSharedStrings(await archive.file('xl/sharedStrings.xml')?.async('string'))
  const workbookXml = await archive.file('xl/workbook.xml')?.async('string')
  const relsXml = await archive.file('xl/_rels/workbook.xml.rels')?.async('string')
  const workbook = workbookXml ? new DOMParser().parseFromString(workbookXml, 'application/xml') : null
  const rels = relsXml ? new DOMParser().parseFromString(relsXml, 'application/xml') : null
  const relMap = new Map(Array.from(rels?.getElementsByTagName('Relationship') || []).map((node) => [node.getAttribute('Id'), node.getAttribute('Target')]))
  const sheets = Array.from(workbook?.getElementsByTagName('sheet') || []).map((sheet, index) => {
    const relId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const target = relMap.get(relId) || `worksheets/sheet${index + 1}.xml`
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`
    return { name: sheet.getAttribute('name') || `Hoja ${index + 1}`, path }
  })

  const datasets = []
  const summary = []
  for (const sheet of sheets.length ? sheets : [{ name: 'Hoja 1', path: 'xl/worksheets/sheet1.xml' }]) {
    const xml = await archive.file(sheet.path)?.async('string')
    if (!xml) continue
    const rows = parseSheetRows(xml, sharedStrings)
    const values = rows.flat().map(parseNumber).filter((value) => value !== null)
    if (values.length) {
      summary.push({ sheetName: sheet.name, count: values.length, total: values.reduce((sum, value) => sum + value, 0) })
    }
    datasets.push(...buildDatasetsFromRows(rows, sheet.name))
  }

  const limited = datasets.slice(0, 6).map((dataset) => ({ ...dataset, title: `${sectionLabel}: ${dataset.title}` }))
  return { datasets: limited, summary }
}

export function summarizeQuantitativeData(form, chartSources = []) {
  const items = []
  if (form.amount !== '' && form.amount !== null && form.amount !== undefined) {
    const amount = Number(form.amount)
    if (Number.isFinite(amount)) items.push({ label: 'Monto solicitado (USD)', value: amount })
  }
  const filledNarrative = ['profile', 'financial', 'guarantees', 'conditions', 'recommendation', 'observations']
    .filter((field) => String(form[field] || '').trim()).length
  items.push({ label: 'Secciones narrativas con información', value: filledNarrative })
  chartSources.forEach((source) => {
    source.summary.forEach((entry) => {
      items.push({ label: `${source.label} · ${entry.sheetName} (valores numéricos)`, value: entry.count })
    })
  })
  return items
}
