/* Komposisi: setiap frame adalah fungsi murni dari waktu t (detik). */
const D = document
const $ = (id) => D.getElementById(id)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const seg = (t, a, b) => clamp01((t - a) / (b - a))
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const nf = new Intl.NumberFormat('id-ID')

const SCENES = [
  { id: 's1', s: 0.0, e: 2.52, first: true },
  { id: 's2', s: 2.52, e: 6.02 },
  { id: 's3', s: 6.02, e: 9.52 },
  { id: 's4', s: 9.52, e: 13.02 },
  { id: 's5', s: 13.02, e: 16.52 },
  { id: 's6', s: 16.52, e: 20.02 },
]

/* ---------- helper animasi ---------- */
function anim(sel, t, start, dur, o = {}) {
  const el = typeof sel === 'string' ? $(sel) : sel
  if (!el) return
  const p = easeOut(seg(t, start, start + dur))
  const y = o.y || 0
  const x = o.x || 0
  const s = o.s || 1
  const base = o.o === undefined ? 1 : o.o
  el.style.opacity = String(base * p)
  el.style.transform = `translate3d(${x * (1 - p)}px, ${y * (1 - p)}px, 0) scale(${1 + (s - 1) * p})`
  if (o.origin) el.style.transformOrigin = o.origin
}
function fadeTo(sel, t, start, dur, to) {
  const el = typeof sel === 'string' ? $(sel) : sel
  if (!el) return
  el.style.opacity = String(to * easeOut(seg(t, start, start + dur)))
}
function setText(sel, text) {
  const el = typeof sel === 'string' ? $(sel) : sel
  if (el && el.textContent !== text) el.textContent = text
}

/* ---------- sparkline ---------- */
const DAYS = [10, 6, 4, 7, 15, 8, 14, 9, 20, 12, 11, 13, 2, 14, 8, 8, 3, 6, 7, 1]
const SW = 640, SH = 160, SMAX = 20
let sparkClipRect = null
let sparkPts = []

function buildSpark() {
  const pts = DAYS.map((v, i) => [
    (i * SW) / (DAYS.length - 1),
    150 - (v / SMAX) * 130,
  ])
  sparkPts = pts
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  $('s5-line').setAttribute('d', d)
  $('s5-area').setAttribute('d', `${d} L${SW} 150 L0 150 Z`)

  const NS = 'http://www.w3.org/2000/svg'
  const svg = $('s5-spark')
  const cp = D.createElementNS(NS, 'clipPath')
  cp.setAttribute('id', 'sparkClip')
  const r = D.createElementNS(NS, 'rect')
  r.setAttribute('x', '0'); r.setAttribute('y', '-20')
  r.setAttribute('height', '220'); r.setAttribute('width', '0')
  cp.appendChild(r)
  svg.querySelector('defs').appendChild(cp)
  sparkClipRect = r
  $('s5-line').setAttribute('clip-path', 'url(#sparkClip)')
  $('s5-area').setAttribute('clip-path', 'url(#sparkClip)')
}

/* ---------- state foto (scene 3) ---------- */
let shotState = 'idle'
function setShot(state) {
  if (shotState === state) return
  shotState = state
  const box = $('s3-shot')
  if (state === 'idle') {
    box.style.background = '#f1f5f9'
    box.style.border = '1px dashed #cbd5e1'
    box.innerHTML = `<svg viewBox="0 0 24 24" style="width:19px;height:19px;stroke:#94a3b8;fill:none;stroke-width:2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Ambil foto dari kamera`
  } else {
    box.style.background = 'linear-gradient(160deg,#1e293b 0%,#334155 55%,#0f172a 100%)'
    box.style.border = '1px solid #334155'
    box.style.position = 'relative'
    box.innerHTML = `
      <div style="position:absolute;left:0;right:0;bottom:14px;display:flex;justify-content:center;">
        <div id="s3-platebox" style="position:relative;background:#f8fafc;border-radius:6px;padding:5px 14px;font-size:15px;font-weight:800;letter-spacing:.14em;color:#0f172a;opacity:.92;">
          B 1234 XY
          <span id="s3-ocrbox" style="position:absolute;left:-5px;right:-5px;top:-5px;bottom:-5px;border:2px solid #10b981;border-radius:8px;opacity:0;"></span>
        </div>
      </div>
      <div style="position:absolute;right:10px;top:10px;width:24px;height:24px;border-radius:999px;background:#10b981;display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:#fff;fill:none;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>`
  }
}

/* ---------- posisi cursor (diukur dari DOM) ---------- */
let cursorFrom = null, cursorTo = null
function measureCursor() {
  const opt = $('s4-opt-all')
  const menu = $('s4-menu')
  if (!opt || !menu) return
  // Menu harus terlihat saat diukur, dan kartu tarif harus dalam posisi
  // settled (transform dihitung dari rect, jadioffset ikut terbaca).
  const prev = menu.style.display
  menu.style.display = 'block'
  const r = opt.getBoundingClientRect()
  cursorTo = { x: r.left + 74, y: r.top + r.height / 2 - 2 }
  cursorFrom = { x: r.right + 235, y: r.bottom + 172 }
  menu.style.display = prev
}

/* ---------- kurva sparkline: titik ujungnya ---------- */
function sparkEnd(progress) {
  const n = sparkPts.length
  const f = clamp01(progress) * (n - 1)
  const i = Math.min(n - 2, Math.floor(f))
  const k = f - i
  const a = sparkPts[i], b = sparkPts[i + 1]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

/* ---------- render utama ---------- */
function render(t) {
  /* opasitas tiap scene */
  for (const sc of SCENES) {
    const el = $(sc.id)
    if (!el) continue
    let o = 1
    if (!sc.first) o = Math.min(o, easeOut(seg(t, sc.s + 0.06, sc.s + 0.30)))
    o = Math.min(o, 1 - easeOut(seg(t, sc.e - 0.16, sc.e)))
    el.style.opacity = String(o)
    el.style.visibility = o <= 0.001 ? 'hidden' : 'visible'
  }

  /* glow hidup di background */
  const glow = 0.14 + 0.04 * Math.sin(t * 1.1)
  $('bg').style.opacity = String(0.75 + glow)

  /* ---------- S1 : HOOK ---------- */
  anim('s1-kicker', t, 0.0, 0.4, { y: 14 })
  anim('s1-title', t, 0.05, 0.45, { y: 26 })
  anim('s1-l1', t, 0.08, 0.45, { y: 22 })
  anim('s1-l2', t, 0.34, 0.45, { y: 22 })
  const swipe = seg(t, 0.78, 1.24)
  $('s1-swipe').style.transform = `scaleX(${easeOut(swipe)})`
  anim('s1-sub', t, 0.58, 0.5, { y: 18 })
  anim('s1-phone', t, 0.2, 0.9, { y: 110, o: 1, origin: 'center bottom' })

  /* ---------- S2 : REVEAL ---------- */
  anim('s2-card', t, 2.58, 0.5, { y: 46 })
  anim('s2-name', t, 2.85, 0.5, { y: 18 })
  anim('s2-tag', t, 3.0, 0.5, { y: 14 })
  anim('s2-c1', t, 3.25, 0.45, { y: 16 })
  anim('s2-c2', t, 3.4, 0.45, { y: 16 })
  anim('s2-c3', t, 3.55, 0.45, { y: 16 })

  /* ---------- S3 : PETUGAS ---------- */
  anim('s3-kicker', t, 6.1, 0.45, { y: 14 })
  anim('s3-title', t, 6.15, 0.55, { y: 30 })
  anim('s3-sub', t, 6.5, 0.5, { y: 18 })
  anim('s3-p1', t, 6.8, 0.45, { y: 16 })
  anim('s3-p2', t, 6.95, 0.45, { y: 16 })
  anim('s3-p3', t, 7.1, 0.45, { y: 16 })
  anim('s3-phone', t, 6.08, 0.75, { y: 90, origin: 'center bottom' })

  setShot(t >= 7.4 ? 'photo' : 'idle')
  const saved = $('s3-saved')
  if (t >= 7.75) {
    saved.style.display = 'flex'
    fadeTo(saved, t, 7.75, 0.35, 1)
    saved.style.transform = `translateY(${(1 - easeOut(seg(t, 7.75, 8.1))) * 12}px)`
  } else {
    saved.style.display = 'none'
  }
  const sub = $('s3-submit')
  const on = t >= 8.05
  sub.className = 'p-btn ' + (on ? 'p-btn-on' : 'p-btn-off')
  const ocr = $('s3-ocr')
  fadeTo(ocr, t, 8.55, 0.3, 1)
  const ob = $('s3-ocrbox')
  if (ob) {
    const p = easeOut(seg(t, 8.55, 8.85))
    ob.style.opacity = String(p)
    ob.style.transform = `scale(${1 + (1 - p) * 0.35})`
    ob.style.transformOrigin = 'center'
  }

  /* ---------- S4 : MASTER TARIF ---------- */
  anim('s4-kicker', t, 9.6, 0.4, { y: 14 })
  anim('s4-title', t, 9.65, 0.55, { y: 28 })
  anim('s4-card', t, 9.8, 0.6, { y: 44 })

  const menu = $('s4-menu')
  const menuOpen = t >= 10.35 && t < 11.35
  menu.style.display = menuOpen ? 'block' : 'none'
  if (menuOpen) {
    const p = easeOut(seg(t, 10.35, 10.6))
    menu.style.opacity = String(p)
    menu.style.transform = `translateY(${(1 - p) * -10}px) scaleY(${0.9 + 0.1 * p})`
    menu.style.transformOrigin = 'top'
  }
  const picked = t >= 11.2
  setText('s4-seltext', picked ? 'Semua Region (12)' : 'Pilih Region')

  const cur = $('s4-cursor')
  if (cursorFrom && cursorTo && t >= 10.1 && t < 11.5) {
    const p = easeInOut(seg(t, 10.35, 11.15))
    cur.style.opacity = String(easeOut(seg(t, 10.1, 10.35)) * (1 - easeOut(seg(t, 11.28, 11.5))))
    cur.style.left = `${cursorFrom.x + (cursorTo.x - cursorFrom.x) * p}px`
    cur.style.top = `${cursorFrom.y + (cursorTo.y - cursorFrom.y) * p}px`
    const sc = 1 - 0.18 * (p - 0.5) * 2
    cur.style.transform = `scale(${sc})`
  } else {
    cur.style.opacity = '0'
  }

  const toast = $('s4-toast')
  if (t >= 11.55) {
    toast.style.opacity = String(easeOut(seg(t, 11.55, 11.9)))
    toast.style.transform = `translateY(${(1 - easeOut(seg(t, 11.55, 11.9))) * 26}px)`
  } else {
    toast.style.opacity = '0'
  }
  const row = $('s4-row-truk')
  const hi = easeOut(seg(t, 11.6, 12.0))
  row.style.background = hi > 0 ? `rgba(16,185,129,${0.14 * hi})` : ''
  for (const cell of row.querySelectorAll('td')) {
    if (!cell.dataset.base) cell.dataset.base = cell.style.color || ''
  }

  /* ---------- S5 : LAPORAN ---------- */
  anim('s5-kicker', t, 13.1, 0.4, { y: 14 })
  anim('s5-title', t, 13.15, 0.5, { y: 26 })
  anim('s5-card', t, 13.3, 0.6, { y: 44 })

  const cp = easeOut(seg(t, 13.9, 14.7))
  setText('s5-v1', String(Math.round(128 * cp)))
  setText('s5-v2', String(Math.round(59 * cp)))
  setText('s5-v3', String(Math.round(82 * cp)))
  anim('s5-b1', t, 13.85, 0.5, { y: 12 })
  anim('s5-b2', t, 13.95, 0.5, { y: 12 })
  anim('s5-b3', t, 14.05, 0.5, { y: 12 })
  anim('s5-b4', t, 14.15, 0.5, { y: 12 })

  const draw = easeOut(seg(t, 14.0, 14.95))
  if (sparkClipRect) sparkClipRect.setAttribute('width', String(SW * draw))
  const [ex, ey] = sparkEnd(draw)
  $('s5-dot').setAttribute('cx', String(ex))
  $('s5-dot').setAttribute('cy', String(ey))
  $('s5-dot').style.opacity = draw > 0.02 ? '1' : '0'

  const C = 2 * Math.PI * 62
  const dp = easeOut(seg(t, 14.5, 15.3))
  $('s5-donut').setAttribute('stroke-dasharray', `${(C * 0.46 * dp).toFixed(2)} ${C.toFixed(2)}`)
  setText('s5-pct', `${Math.round(46 * dp)}%`)
  const cp2 = easeOut(seg(t, 14.5, 15.15))
  setText('s5-load', String(Math.round(59 * cp2)))
  setText('s5-empty', String(Math.round(69 * cp2)))

  /* ---------- S6 : OUTRO ---------- */
  anim('s6-kicker', t, 16.6, 0.4, { y: 14 })
  anim('s6-title', t, 16.65, 0.55, { y: 30 })
  anim('s6-title2', t, 16.95, 0.55, { y: 30 })
  anim('s6-sub', t, 17.3, 0.5, { y: 18 })
  anim('s6-card', t, 16.85, 0.6, { x: 60 })
  fadeTo('s6-badge', t, 17.2, 0.35, 1)
  fadeTo('s6-net', t, 17.5, 0.35, 1)
  anim('s6-brand', t, 18.05, 0.5, { y: 26 })
  anim('s6-line', t, 18.6, 0.5, { y: 16 })
}

/* ---------- init ---------- */
buildSpark()
setShot('idle')
requestAnimationFrame(() => {
  render(12.0)          // kartu tarif dalam posisi settled
  measureCursor()
  render(0)
})

window.renderFrame = render
window.__ready = D.fonts.ready.then(() => {
  render(12.0)
  measureCursor()
  render(0)
  return true
})
