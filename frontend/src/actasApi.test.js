import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deleteActa,
  downloadActaWord,
  getActa,
  listActas,
  saveActa,
} from './actasApi.js'

test('saveActa posts the Word, fields, new attachments, and removals', async () => {
  const originalFetch = globalThis.fetch
  let capturedUrl
  let capturedOptions
  globalThis.fetch = async (url, options) => {
    capturedUrl = url
    capturedOptions = options
    return Response.json({ id: 'acta-1' }, { status: 201 })
  }

  try {
    const word = new Blob(['word'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const attachment = new Blob(['sheet'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const result = await saveActa({
      data: { clientName: 'Ana' },
      word: Object.assign(word, { name: 'acta.docx' }),
      attachments: { financial: Object.assign(attachment, { name: 'balance.xlsx' }) },
      removedAttachments: ['conditions'],
    })

    assert.equal(result.id, 'acta-1')
    assert.equal(capturedUrl, '/api/actas')
    assert.equal(capturedOptions.method, 'POST')
    assert.equal(capturedOptions.body.get('data'), '{"data":{"clientName":"Ana"}}')
    assert.equal(capturedOptions.body.get('remove_attachments'), '["conditions"]')
    assert.equal(capturedOptions.body.get('word').name, 'acta.docx')
    assert.equal(capturedOptions.body.get('attachment_financial').name, 'balance.xlsx')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('API helpers address a saved record and return explicit server errors', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/word')) return new Response('docx bytes')
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/missing')) return Response.json({ error: 'No se encontró el acta.' }, { status: 404 })
    if (url === '/api/actas') return Response.json([])
    return Response.json({ id: 'saved' })
  }

  try {
    assert.deepEqual(await listActas(), [])
    assert.equal((await getActa('saved')).id, 'saved')
    assert.equal(await (await downloadActaWord('saved')).text(), 'docx bytes')
    assert.equal(await deleteActa('saved'), null)
    await assert.rejects(getActa('missing'), /No se encontró el acta/)
    assert.deepEqual(requests.map(({ url }) => url), [
      '/api/actas',
      '/api/actas/saved',
      '/api/actas/saved/word',
      '/api/actas/saved',
      '/api/actas/missing',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
