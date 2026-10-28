/**
 * Helper CDP minimal untuk menjelajah app yang sedang hidup.
 * Dipakai untuk melihat isi teks UI asli (bukan screenshot) supaya
 * komposisi video memakai copy asli produk.
 */
import { execSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const PORT = 9333

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

export async function withBrowser(fn) {
  const chrome = spawn(
    'chromium',
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let browserWs = null
  for (let i = 0; i < 60 && !browserWs; i++) {
    await delay(200)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      browserWs = (await res.json()).webSocketDebuggerUrl
    } catch {
      /* belum siap */
    }
  }
  if (!browserWs) throw new Error('chromium gagal start')
  const ws = new WebSocket(browserWs, { maxPayload: 256 * 1024 * 1024 })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  const browser = new CDP(ws)
  try {
    return await fn(browser)
  } finally {
    chrome.kill('SIGKILL')
  }
}

export async function openPage(browser, { url, width = 1600, height = 1000, mobile = false }) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile },
    sessionId,
  )
  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Page.navigate', { url }, sessionId)
  return { targetId, sessionId }
}

export async function evaluate(browser, sessionId, expression) {
  const res = await browser.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'eval error')
  }
  return res.result.value
}

export async function shot(browser, sessionId) {
  const { data } = await browser.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId,
  )
  return Buffer.from(data, 'base64')
}

export { delay }
