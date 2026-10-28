/** Cek ketat: elemen benar-benar terlihat (offsetParent != null) pada waktu tertentu. */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = 9466
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (raw) => { const m = JSON.parse(raw.toString())
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) } }) }
  send(method, params = {}, sessionId) { const id = ++this.id; const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId; this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })) }
}
const chrome = spawn('chromium', ['--headless=new','--disable-gpu','--hide-scrollbars','--no-first-run',
  `--remote-debugging-port=${PORT}`,'about:blank'], { stdio: 'ignore' })
let browserWs = null
for (let i = 0; i < 80 && !browserWs; i++) { await delay(200)
  try { browserWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch {} }
const ws = new WebSocket(browserWs); await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
const browser = new CDP(ws)
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
await browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId)
await browser.send('Page.enable', {}, sessionId); await browser.send('Runtime.enable', {}, sessionId)
await browser.send('Page.navigate', { url: 'file://' + path.join(HERE, 'scene.html') }, sessionId)
await delay(2500)
await browser.send('Runtime.evaluate', { expression: 'window.__ready.then(()=>true)', awaitPromise: true, returnByValue: true }, sessionId)

const CHECKS = [
  [0.30, 's1-title', 'TOS/PAT TI besar'],
  [0.90, 's1-strike', 'coretan amber'],
  [1.00, 's1-sub', 'sub-hook'],
  [1.00, 's1-phone', 'ponsel'],
  [5.20, 's2-card', 'kartu brand'],
  [5.20, 's2-c3', 'chip API'],
  [7.20, 's3-title', 'judul agent'],
  [7.20, 's3-sub', 'sub agent'],
  [7.60, 's3-saved', 'kartu Foto tersimpan'],
  [8.30, 's3-submit', 'tombol Kirim Trip'],
  [8.80, 's3-ocr', 'badge OCR'],
  [8.90, 's3-ocrbox', 'kotak deteksi plat'],
  [10.50, 's4-menu', 'dropdown terbuka'],
  [11.30, 's4-menu', 'dropdown (masih buka?)'],
  [11.90, 's4-menu', 'dropdown (harus tertutup)'],
  [11.90, 's4-seltext', 'teks select'],
  [12.20, 's4-toast', 'toast'],
  [12.20, 's4-cursor', 'kursor'],
  [15.00, 's5-v1', 'angka trip'],
  [15.00, 's5-pct', 'persentase muatan'],
  [15.00, 's5-line', 'garis sparkline'],
  [19.40, 's6-line', 'kalimat akhir'],
  [19.40, 's6-brand', 'lockup brand'],
]
for (const [t, id, label] of CHECKS) {
  const r = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      window.renderFrame(${t})
      const el = document.getElementById(${JSON.stringify(id)})
      if (!el) return 'MISSING'
      const st = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const shown = el.offsetParent !== null && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.3
      return (shown ? 'OK  ' : 'HIDE') + ' op=' + Number(st.opacity).toFixed(2) +
             ' disp=' + st.display + ' box=' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
    })()`, returnByValue: true }, sessionId)
  console.log(`t=${String(t).padEnd(5)} ${label.padEnd(24)} ${r.result.value}`)
}
chrome.kill('SIGKILL')
