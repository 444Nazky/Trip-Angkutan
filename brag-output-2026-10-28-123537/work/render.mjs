/**
 * Render komposisi: frame = fungsi murni dari waktu.
 *
 *   node render.mjs --still 0.5,3.5,7.8,11.8,14.8,19.0 --out stills
 *   node render.mjs --full --out frames
 */
import { execSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const FPS = 30
const DURATION = 20.02
const PORT = 9444

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

const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--font-render-hinting=none',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let browserWs = null
for (let i = 0; i < 80 && !browserWs; i++) {
  await delay(200)
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    browserWs = (await res.json()).webSocketDebuggerUrl
  } catch {
    /* belum siap */
  }
}
if (!browserWs) {
  chrome.kill('SIGKILL')
  throw new Error('chromium gagal start')
}
const ws = new WebSocket(browserWs, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => {
  ws.on('open', res)
  ws.on('error', rej)
})
const browser = new CDP(ws)

try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
    sessionId,
  )
  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send(
    'Page.navigate',
    { url: 'file://' + path.join(HERE, 'scene.html') },
    sessionId,
  )
  await delay(2500)

  const ready = await browser.send(
    'Runtime.evaluate',
    { expression: 'window.__ready ? window.__ready.then(()=>true) : false', awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (!ready.result.value) throw new Error('halaman scene tidak siap (fonts?)')
  console.log('halaman siap')

  const shoot = async (t) => {
    await browser.send(
      'Runtime.evaluate',
      { expression: `window.renderFrame(${t})` },
      sessionId,
    )
    const { data } = await browser.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, optimizeForSpeed: false },
      sessionId,
    )
    return Buffer.from(data, 'base64')
  }

  const stills = argOf('--still', '')
  if (stills) {
    const outDir = path.join(HERE, argOf('--out', 'stills'))
    await mkdir(outDir, { recursive: true })
    for (const raw of stills.split(',')) {
      const t = parseFloat(raw)
      const png = await shoot(t)
      const file = path.join(outDir, `t${t.toFixed(2).replace('.', '_')}.png`)
      await writeFile(file, png)
      console.log('still', file)
    }
  }

  if (args.includes('--full')) {
    const outDir = path.join(HERE, argOf('--out', 'frames'))
    await mkdir(outDir, { recursive: true })
    const total = Math.round(DURATION * FPS)
    const t0 = Date.now()
    for (let i = 0; i <= total; i++) {
      const t = i / FPS
      const png = await shoot(t)
      await writeFile(path.join(outDir, `f${String(i).padStart(4, '0')}.png`), png)
      if (i % 30 === 0) {
        const el = (Date.now() - t0) / 1000
        const eta = (el / (i || 1)) * (total - i)
        console.log(`frame ${i}/${total}  ${el.toFixed(1)}s  ETA ${eta.toFixed(0)}s`)
      }
    }
    console.log('selesai render', total + 1, 'frame')
  }

  // audit: overflow / teks terpotong
  const audit = await browser.send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const bad = []
        for (const sc of document.querySelectorAll('.scene')) {
          for (const el of sc.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            if (r.right > 1921 || r.bottom > 1081 || r.left < -1 || r.top < -1) {
              bad.push({ scene: sc.id, tag: el.tagName, cls: el.className && String(el.className).slice(0,40),
                         x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
            }
          }
        }
        return JSON.stringify({ overflow: bad.slice(0, 30), count: bad.length })
      })()`,
      returnByValue: true,
    },
    sessionId,
  )
  console.log('AUDIT', audit.result.value)
} finally {
  chrome.kill('SIGKILL')
}
