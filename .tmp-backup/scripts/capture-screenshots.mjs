/**
 * Ambil screenshot halaman aplikasi untuk dokumentasi (README).
 *
 * Cara kerja: headless Chromium dikendalikan lewat Chrome DevTools Protocol
 * (CDP) - tanpa dependensi tambahan, hanya `ws` yang sudah ada di node_modules.
 *
 * Contoh:
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs --out docs/screenshots
 */
import { execSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const outDir = path.resolve(
  args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/screenshots',
)
const PORT = 9222

/** Alamat aplikasi yang difoto. Override lewat env untuk build lain. */
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:8000'
const MOBILE_URL = process.env.MOBILE_URL || 'http://localhost:5173'

/** @type {Array<{name: string, url: string, viewport: {width: number, height: number}, click?: string, wait?: number}>} */
const SHOTS = [
  {
    name: 'admin-laporan',
    url: `${ADMIN_URL}/`,
    viewport: { width: 1600, height: 1000 },
  },
  {
    name: 'admin-master-tarif',
    url: `${ADMIN_URL}/`,
    viewport: { width: 1600, height: 1000 },
    click: 'Master Tarif',
  },
  {
    name: 'admin-master-region',
    url: `${ADMIN_URL}/`,
    viewport: { width: 1600, height: 1000 },
    click: 'Master Region',
  },
  {
    name: 'admin-petugas',
    url: `${ADMIN_URL}/`,
    viewport: { width: 1600, height: 1000 },
    click: 'Petugas',
  },
  {
    name: 'admin-laporan-spreadsheet',
    url: `${ADMIN_URL}/#/sheet`,
    viewport: { width: 1600, height: 1000 },
  },
  {
    name: 'admin-laporan-rekap',
    url: `${ADMIN_URL}/#/sheet/rekap`,
    viewport: { width: 1600, height: 1000 },
  },
  {
    name: 'mobile-login',
    url: `${MOBILE_URL}/`,
    viewport: { width: 414, height: 896 },
  },
]

function chromePath() {
  for (const c of ['chromium', 'chromium-browser', 'google-chrome']) {
    try {
      const p = execSync(`command -v ${c}`, { encoding: 'utf8' }).trim()
      if (p) return p
    } catch {
      /* lanjut ke kandidat berikutnya */
    }
  }
  return 'chromium'
}

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

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 })
    ws.on('open', () => resolve(new CDP(ws)))
    ws.on('error', reject)
  })
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const chrome = spawn(
    chromePath(),
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
  for (let i = 0; i < 50 && !browserWs; i++) {
    await delay(200)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const info = await res.json()
      browserWs = info.webSocketDebuggerUrl
    } catch {
      /* chromium belum siap */
    }
  }
  if (!browserWs) throw new Error('Chromium tidak bisa dinyalakan')

  const browser = await connect(browserWs)
  try {
    for (const shot of SHOTS) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })

      await browser.send(
        'Emulation.setDeviceMetricsOverride',
        {
          width: shot.viewport.width,
          height: shot.viewport.height,
          deviceScaleFactor: 1,
          mobile: shot.viewport.width < 600,
        },
        sessionId,
      )
      await browser.send('Page.enable', {}, sessionId)
      await browser.send('Runtime.enable', {}, sessionId)

      await browser.send('Page.navigate', { url: shot.url }, sessionId)
      await delay(shot.wait ?? 6000)

      if (shot.click) {
        await browser.send(
          'Runtime.evaluate',
          {
            expression: `(() => {
              const el = [...document.querySelectorAll('button,a')].find(b => b.textContent.trim().startsWith(${JSON.stringify(shot.click)}))
              if (el) { el.click(); return true }
              return false
            })()`,
            awaitPromise: true,
          },
          sessionId,
        )
        await delay(4000)
      }

      const { data } = await browser.send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: false },
        sessionId,
      )
      const file = path.join(outDir, `${shot.name}.png`)
      await writeFile(file, Buffer.from(data, 'base64'))
      console.log('saved', file)

      await browser.send('Target.closeTarget', { targetId })
    }
  } finally {
    chrome.kill('SIGKILL')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
