// Verifikasi BACA-SAJA (temporary): buka dashboard admin hasil build di Chromium
// headless dengan endpoint default (server kantor 192.168.1.123:3000), klik menu
// "Master Region", lalu bandingkan isi halaman dengan isi database.
// Tidak ada penulisan ke server kantor. File ini dihapus setelah dipakai.

import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const PAGE = 'http://127.0.0.1:8123/'
const API = 'http://192.168.1.123:3000/api'
const CDP_PORT = 9223
const PROFILE = '/tmp/cdp-master-region-office'

let token = null
async function api(method, path) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const text = await res.text()
  try { return { status: res.status, data: JSON.parse(text) } } catch { return { status: res.status, data: text } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* belum siap */ }
    await sleep(250)
  }
  throw new Error('CDP tidak siap')
}

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }))
    ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e?.message ?? 'unknown'}`)))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      }
    })
    function send(method, params = {}) {
      const myId = ++id
      return new Promise((res, rej) => {
        pending.set(myId, { res, rej })
        ws.send(JSON.stringify({ id: myId, method, params }))
      })
    }
  })
}

const HELPERS = `
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const bodyText = () => document.body.innerText;
  const buttonByText = (text) => $$('button').find(b => (b.textContent || '').replace(/\\s+/g, ' ').trim() === text);
  const waitFor = async (fn, timeout = 15000) => {
    const t0 = Date.now();
    for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeout) return null; await new Promise(r => setTimeout(r, 150)); }
  };
`

async function main() {
  const chromium = spawn('chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1600,1200', PAGE,
  ], { stdio: 'ignore' })

  const login = await api('POST', '/auth/admin-login', {})
  token = login.data?.token
  if (!token) throw new Error('login API gagal')
  const regions = (await api('GET', '/regions')).data
  const dermagas = (await api('GET', '/dermagas')).data
  const routes = (await api('GET', '/routes')).data
  const officers = (await api('GET', '/officers')).data
  console.log(`database kantor: regions=${regions.length} dermagas=${dermagas.length} routes=${routes.length} officers=${officers.length}`)

  const wsUrl = await waitForCdp()
  const { send, close } = await cdp(wsUrl)
  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.text}`)
    return r.result?.value
  }
  const inPage = (code) => evaluate(`(async () => { ${HELPERS} ${code} })()`)

  // Pastikan halaman memakai endpoint default (tanpa override localStorage).
  const endpoint = await inPage(`return { override: localStorage.getItem('trip.api.baseUrl') };`)
  console.log('override endpoint di browser:', JSON.stringify(endpoint))

  await sleep(2500)
  const nav = await inPage(`
    const btn = await waitFor(() => buttonByText('Master Region'));
    if (!btn) return { found: false, body: bodyText().slice(0, 300) };
    btn.click();
    await waitFor(() => buttonByText('Tambah Region'));
    await waitFor(() => /\\d+ wilayah · \\d+ dermaga/.test(bodyText()) || bodyText().includes('Server tidak bisa dihubungi'));
    return { found: true };
  `)
  console.log('buka menu Master Region:', JSON.stringify(nav))

  const dom = await inPage(`
    const rows = $$('tbody tr').map(tr => {
      const cells = $$('td', tr).map(td => td.innerText.replace(/\\s+/g, ' ').trim());
      const isRegion = !!tr.querySelector('span.font-bold') && (tr.innerText || '').includes('wilayah');
      return { isRegion, cells };
    });
    return {
      badge: (bodyText().match(/\\d+ wilayah · \\d+ dermaga/) || ['tidak ada'])[0],
      offline: bodyText().includes('Server tidak bisa dihubungi'),
      judul: (bodyText().match(/Master Region/) || []).length,
      rows,
      tabelKosong: bodyText().includes('Belum ada wilayah di database'),
    };
  `)
  console.log('badge halaman:', JSON.stringify(dom.badge), '| tabel kosong?', dom.tabelKosong, dom.offline ? '| OFFLINE' : '')

  const regionRows = dom.rows.filter((r) => r.isRegion).map((r) => r.cells)
  const dermagaRows = dom.rows.filter((r) => !r.isRegion && r.cells.length === 4).map((r) => r.cells)
  console.log('\n--- baris wilayah di halaman ---')
  for (const c of regionRows) console.log(' ', c[0], '|', c[1], '|', c[2])
  console.log('--- baris dermaga di halaman ---')
  for (const c of dermagaRows) console.log(' ', c[0], '|', c[1], '|', c[2])

  // Bandingkan dengan database.
  const regionByCode = new Map(regions.map((r) => [String(r.code).toUpperCase(), r]))
  const regionIds = new Set(regions.map((r) => String(r.id)))
  const expectedNames = regions.map((r) => r.name || r.code)
  const domNames = regionRows.map((c) => c[0].replace(/\\s*wilayah$/, '').trim())
  const kurang = expectedNames.filter((n) => !domNames.includes(String(n)))
  const lebih = domNames.filter((n) => !expectedNames.map(String).includes(n))
  console.log('\nwilayah di DB tapi tidak tampil di halaman:', kurang.length ? kurang : 'tidak ada')
  console.log('wilayah di halaman tapi tidak ada di DB:', lebih.length ? lebih : 'tidak ada')

  const orphanDb = dermagas.filter((d) => !d.region_id || !regionIds.has(String(d.region_id)))
  console.log(`dermaga yatim di DB (region_id kosong/tidak ada wilayahnya): ${orphanDb.length}`,
    orphanDb.map((d) => `${d.name}/${d.code}`).join(', ') || '')
  const orphanDom = dermagaRows.filter((c) => domNames.every((n) => false) === false ? false : false)
  void orphanDom
  console.log('halaman menampilkan blok "Dermaga tanpa wilayah"?', dom.rows.some((r) => r.cells.join(' ').includes('Dermaga tanpa wilayah')))

  // Jumlah dermaga per wilayah: DB vs halaman.
  let mismatch = 0
  for (const r of regions) {
    const dbCount = dermagas.filter((d) => String(d.region_id) === String(r.id)).length
    const header = regionRows.find((c) => c[0].replace(/\\s*wilayah$/, '').trim() === String(r.name || r.code))
    const domCount = header ? Number((header[2].match(/^(\\d+) dermaga/) || [])[1] ?? -1) : -1
    if (dbCount !== domCount) { mismatch++; console.log(`  BEDA ${r.code}: DB=${dbCount} halaman=${domCount}`) }
  }
  console.log('selisih jumlah dermaga per wilayah:', mismatch === 0 ? 'tidak ada' : `${mismatch} wilayah`)
  console.log('jumlah baris dermaga di halaman:', dermagaRows.length, '| dermaga di DB:', dermagas.length)
  void regionByCode

  console.log('\nteks halaman (200 char):', JSON.stringify((await inPage(`return bodyText();`)).replace(/\s+/g, ' ').slice(0, 200)))
  close()
  chromium.kill('SIGKILL')
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* profil sementara */ }
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1 })
