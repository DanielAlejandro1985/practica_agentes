const ACTAS_URL = '/api/actas'

async function errorMessage(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await response.json()
    if (body && typeof body.error === 'string') return body.error
  }
  return `La solicitud falló (${response.status}).`
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(await errorMessage(response))
  if (response.status === 204) return null
  return response.json()
}

export function listActas() {
  return requestJson(ACTAS_URL)
}

export function getActa(id) {
  return requestJson(`${ACTAS_URL}/${encodeURIComponent(id)}`)
}

export function saveActa({ id, data, word, attachments, removedAttachments }) {
  const body = new FormData()
  body.append('data', JSON.stringify({ data }))
  body.append('word', word, word.name)
  body.append('remove_attachments', JSON.stringify(removedAttachments))

  for (const [section, file] of Object.entries(attachments)) {
    if (file) body.append(`attachment_${section}`, file, file.name)
  }

  return requestJson(id ? `${ACTAS_URL}/${encodeURIComponent(id)}` : ACTAS_URL, {
    method: id ? 'PUT' : 'POST',
    body,
  })
}

export function deleteActa(id) {
  return requestJson(`${ACTAS_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

async function downloadFile(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.blob()
}

export function downloadActaWord(id) {
  return downloadFile(`${ACTAS_URL}/${encodeURIComponent(id)}/word`)
}

export function downloadActaAttachment(id, section) {
  return downloadFile(`${ACTAS_URL}/${encodeURIComponent(id)}/attachments/${encodeURIComponent(section)}`)
}

export function getAiStatus() {
  return requestJson('/api/ai/status')
}

export function configureAi(apiKey) {
  return requestJson('/api/ai/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
}

export function generateWithAi({ data, presentationText, attachments }) {
  const body = new FormData()
  body.append('data', JSON.stringify({ data, presentationText }))
  for (const [section, file] of Object.entries(attachments)) {
    if (file) body.append(`attachment_${section}`, file, file.name)
  }
  return requestJson('/api/ai/generate', {
    method: 'POST',
    body,
  })
}
