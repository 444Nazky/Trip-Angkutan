// Pemeriksaan sekali jalan (temporary): buktikan endpoint master yang dipakai
// tab "Master Region" benar-benar menulis ke database dan tidak menyisakan data.
// Jalankan terhadap server intranet lokal, lalu file ini dihapus.

const BASE = 'http://127.0.0.1:3000/api'
let token = null

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

const ids = (rows) => (Array.isArray(rows) ? rows.map((r) => r.id).sort() : rows)

async function main() {
  const login = await req('POST', '/auth/admin-login', { username: 'admin', password: 'admin123456' })
  token = login.data?.token
  console.log('login:', login.status, token ? 'token ok' : JSON.stringify(login.data))
  if (!token) throw new Error('login gagal')

  const before = {
    regions: ids((await req('GET', '/regions')).data),
    dermagas: ids((await req('GET', '/dermagas')).data),
  }
  console.log('baseline: regions=%d dermagas=%d', before.regions.length, before.dermagas.length)

  const CODE = 'ZZTEST'
  const DCODE = 'ZZT1'
  let regionId = null
  let dermagaId = null

  try {
    const created = await req('POST', '/regions', { name: 'ZZ TEST MASTER REGION', code: CODE })
    regionId = created.data?.id
    console.log('POST /regions:', created.status, regionId)

    const dm = await req('POST', '/dermagas', { region_id: regionId, name: 'ZZ TEST DERMAGA', code: DCODE })
    dermagaId = dm.data?.id
    console.log('POST /dermagas:', dm.status, dermagaId)

    const regions = (await req('GET', '/regions')).data
    const dermagas = (await req('GET', '/dermagas')).data
    const regionRow = regions.find((r) => r.id === regionId)
    const dermagaRow = dermagas.find((d) => d.id === dermagaId)
    console.log('GET /regions punya baris baru:', !!regionRow, JSON.stringify(regionRow))
    console.log('GET /dermagas punya baris baru:', !!dermagaRow, JSON.stringify({
      id: dermagaRow?.id, region_id: dermagaRow?.region_id, name: dermagaRow?.name, code: dermagaRow?.code,
      region_name: dermagaRow?.region_name, region_code: dermagaRow?.region_code,
    }))

    // Apa yang terjadi kalau wilayah dihapus padahal dermaganya masih ada?
    const delRegion = await req('DELETE', `/regions/${regionId}`)
    console.log('DELETE /regions (dermaga masih ada):', delRegion.status, JSON.stringify(delRegion.data))
    const afterDel = (await req('GET', '/dermagas')).data.find((d) => d.id === dermagaId)
    console.log('dermaga setelah wilayah dihapus:', JSON.stringify({
      masih_ada: !!afterDel, region_id: afterDel?.region_id ?? null,
    }))
    regionId = null

    // FK: dermaga dengan wilayah bukan uuid harus ditolak, bukan tersimpan.
    const bad = await req('POST', '/dermagas', { region_id: 'bukan-uuid', name: 'ZZ BAD', code: 'ZZBAD' })
    console.log('POST /dermagas region_id ngawur:', bad.status, JSON.stringify(bad.data))
  } finally {
    if (dermagaId) {
      const del = await req('DELETE', `/dermagas/${dermagaId}`)
      console.log('DELETE /dermagas:', del.status, JSON.stringify(del.data))
    }
    if (regionId) {
      const del = await req('DELETE', `/regions/${regionId}`)
      console.log('DELETE /regions:', del.status, JSON.stringify(del.data))
    }
  }

  const after = {
    regions: ids((await req('GET', '/regions')).data),
    dermagas: ids((await req('GET', '/dermagas')).data),
  }
  const sameIds = (a, b) => a.length === b.length && a.every((x, i) => String(x) === String(b[i]))
  console.log('sisa data uji (regions):', sameIds(before.regions, after.regions) ? 'tidak ada' : after.regions.filter((x) => !before.regions.includes(x)))
  console.log('sisa data uji (dermagas):', sameIds(before.dermagas, after.dermagas) ? 'tidak ada' : after.dermagas.filter((x) => !before.dermagas.includes(x)))
  console.log('jumlah akhir: regions=%d dermagas=%d (baseline %d/%d)',
    after.regions.length, after.dermagas.length, before.regions.length, before.dermagas.length)
}

main().catch((e) => { console.error('GAGAL:', e.message); process.exitCode = 1 })
