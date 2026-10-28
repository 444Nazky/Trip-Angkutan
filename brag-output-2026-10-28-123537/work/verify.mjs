/** Verifikasi isi tiap scene: teks yang benar-benar terlihat pada waktu tertentu. */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9455

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

const chrome = spawn('chromium', ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
  `--remote-debugging-port=${PORT}`,'about:blank'], { stdio: 'ignore' })
let browserWs = null
for (let i = 0; i < 80 && !browserWs; i++) {
  await delay(200)
  try { browserWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch {}
}
const ws = new WebSocket(browserWs)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
const browser = new CDP(ws)

const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
await browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId)
await browser.send('Page.enable', {}, sessionId)
await browser.send('Runtime.enable', {}, sessionId)
await browser.send('Page.navigate', { url: 'file://' + path.join(HERE, 'scene.html') }, sessionId)
await delay(2500)
await browser.send('Runtime.evaluate', { expression: 'window.__ready.then(()=>true)', awaitPromise: true, returnByValue: true }, sessionId)

const TIMES = [0.4, 1.5, 3.6, 5.4, 7.0, 7.9, 8.8, 10.2, 11.0, 11.9, 13.6, 14.9, 16.0, 17.5, 18.4, 19.4]
for (const t of TIMES) {
  const r = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      window.renderFrame(${t})
      const out = []
      for (const sc of document.querySelectorAll('.scene')) {
        const so = parseFloat(sc.style.opacity || '0')
        if (so <= 0.02) continue
        const txt = [...sc.querySelectorAll('div,span,h1,h2,h3,p,td,th,button')]
          .filter(e => e.children.length === 0)
          .map(e => e.textContent.trim())
          .filter(x => x && x.length > 1)
          .join(' | ')
        const vis = [...sc.querySelectorAll('*')].filter(e => {
          const st = getComputedStyle(e)
          return parseFloat(st.opacity) > 0.35 && st.visibility !== 'hidden' && e.textContent.trim().length > 1 && e.children.length === 0
        }).map(e => e.textContent.trim()).filter(Boolean)
        out.push({ scene: sc.id, opacity: so, visible: [...new Set(vis)].slice(0, 14) })
      }
      return JSON.stringify(out)
    })()`,
    returnByValue: true,
  }, sessionId)
  console.log(`\n--- t=${t} ---`)
  for (const s of JSON.parse(r.result.value)) {
    console.log(` ${s.scene} (op ${s.opacity.toFixed(2)}): ${s.visible.join(' / ')}`)
  }
}
chrome.kill('SIGKILL')
