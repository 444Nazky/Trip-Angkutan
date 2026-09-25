import { useEffect, useState } from 'react'
import { ChevronLeft, Check, Camera, Loader2, ChevronDown } from 'lucide-react'
import { tariffFor, useApp } from '../store'
import { tariffData } from '../data'
import { checkPlate, type PlateCheck } from '../../services/plates'
import { fetchRegions, type Region } from '../../services/regions'
import type { MobileScreen } from '../types'

// ─── Vehicle Form Screen ───────────────────────────────────────────────────────
interface VehicleFormScreenProps {
  go: (s: MobileScreen) => void
}

export default function VehicleFormScreen({ go }: VehicleFormScreenProps) {
  const { draft, patchDraft, addVehicle, tariffs } = useApp()
  const [showModal, setShowModal] = useState(false)
  const { plate, type: vehicleType, category } = draft.vehicleForm
  const photoTaken = draft.photo

  // ── Registrasi plat (OCR + cek ke server) ──────────────────────────────────
  const [regions, setRegions] = useState<Region[]>([])
  const [originRegionId, setOriginRegionId] = useState('')
  const [check, setCheck] = useState<PlateCheck | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [plateMsg, setPlateMsg] = useState('')
  // Plat yang sudah diinput sebelumnya — diketuk untuk melihat detailnya
  const [openPlate, setOpenPlate] = useState<string | null>(null)
  // Accordion detail tambahan
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    fetchRegions().then(r => { if (r) setRegions(r) })
  }, [])

  const runCheck = async (p: string, origin?: string) => {
    if (!p.trim()) return
    setCheckLoading(true)
    setPlateMsg('')
    const res = await checkPlate(p, origin || originRegionId || null)
    if (!res) setPlateMsg('Server tidak tersedia — status plat tidak bisa dicek')
    setCheck(res)
    setCheckLoading(false)
  }

  // Vehicle types come from the admin-managed master tariff so the selected
  // type always maps 1:1 to a tariff row (e.g. Truck Besar ≠ Truck Sedang).
  const vehicleTypes = tariffs.length > 0 ? tariffs.map(t => t.type) : tariffData.map(t => t.type)
  const effectiveVehicleType = vehicleType || vehicleTypes[0] || 'Truck Sedang'
  const emojiFor = (t: string) => /motor/i.test(t) ? '🏍️' : /mobil/i.test(t) ? '🚗' : '🚛'

  // Form fields live in the store draft so they survive navigation to the
  // camera screen and back (component unmounts while off-screen).
  const setField = (p: Partial<{ plate: string; type: string; category: string }>) =>
    patchDraft({ vehicleForm: { ...draft.vehicleForm, ...p } })
  const setPlate = (v: string) => setField({ plate: v })
  const setVehicleType = (v: string) => setField({ type: v })
  const setCategory = (v: string) => setField({ category: v })

  // Hasil OCR dari layar kamera
  useEffect(() => {
    if (draft.ocrResult) {
      const text = draft.ocrResult
      const normalizedPlate = text.replace(/\s+/g, ' ').trim().toUpperCase()
      if (normalizedPlate.length >= 3) {
        setField({ plate: normalizedPlate })
        void runCheck(normalizedPlate)
      } else {
        setPlateMsg('Plat tidak terbaca jelas — silakan ketik manual')
      }
      requestAnimationFrame(() => patchDraft({ ocrResult: undefined }))
    }
    if (draft.ocrError) {
      setPlateMsg(draft.ocrError)
      patchDraft({ ocrError: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ocrResult, draft.ocrError])

  // Validasi cepat: hanya foto dan nomor plat yang wajib untuk lanjut
  const canProceed = photoTaken && !!plate.trim()

  const pushVehicle = (opts: { resetPhoto: boolean }) => {
    const checked = check && check.plate.toUpperCase() === plate.trim().toUpperCase() ? check : null
    const finalType = vehicleType || effectiveVehicleType
    const finalCategory = category || 'Internal'

    addVehicle({
      plate: plate.trim().toUpperCase(),
      type: finalType,
      category: finalCategory,
      tariff: tariffFor(finalType).loadedNum,
      photoUrl: draft.photoUrl,
      plateStatus: checked?.status,
      originRegion: checked?.originRegionCode || undefined,
      checkpointRegion: checked?.checkpointRegionCode || undefined,
    })
    patchDraft({
      vehicleForm: { plate: '', type: '', category: '' },
      ...(opts.resetPhoto ? { photo: false, photoUrl: undefined } : {}),
    })
  }

  const openCamera = (mode: 'photo' | 'ocr') => {
    patchDraft({ cameraFrom: 'vehicle-form', cameraMode: mode })
    go('camera')
  }

  return (
    <div className="px-4 pt-2 pb-6 animate-fade-in">
      <button onClick={() => go('route-select')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Input Kendaraan Cepat</h2>
      <p className="text-slate-500 text-[13px] mb-4">Ambil foto dokumentasi & plat nomor kendaraan</p>

      {/* Steps */}
      <div className="flex items-center gap-1.5 mb-5">
        {['Rute', 'Kondisi', 'Kendaraan', 'Selesai'].map((step, i) => (
          <div key={step} className="flex items-center gap-1.5 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${i <= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
              {i < 2 ? <Check size={12} strokeWidth={3} /> : i + 1}
            </div>
            {i < 3 && <div className={`flex-1 h-[2px] rounded-full ${i < 2 ? 'bg-blue-600' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {/* ── PRIORITAS 1: Foto Dokumentasi via Kamera ────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
              1 · Foto Dokumentasi <span className="text-rose-500">*Wajib</span>
            </p>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${photoTaken ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
              {photoTaken ? 'Siap' : 'Wajib diisi'}
            </span>
          </div>

          <button
            onClick={() => openCamera('photo')}
            className={`w-full rounded-2xl border-2 border-dashed py-4 px-4 flex flex-col items-center gap-2 transition-all ${
              photoTaken ? 'border-emerald-400 bg-emerald-50/70' : 'border-blue-300 bg-blue-50/40 hover:border-blue-400'
            }`}
          >
            {photoTaken ? (
              <>
                {draft.photoUrl ? (
                  <img src={draft.photoUrl} alt="Bukti Muatan" className="w-24 h-24 object-cover rounded-xl border border-emerald-300 shadow-sm" />
                ) : (
                  <span className="text-3xl">✅</span>
                )}
                <span className="text-[12px] font-bold text-emerald-600">Foto berhasil diambil</span>
                <span className="text-[10px] text-emerald-500">Ketuk untuk ambil ulang</span>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/30">
                  <Camera size={24} />
                </div>
                <span className="text-[13px] font-bold text-slate-800">Jepret Foto Kamera</span>
                <span className="text-[11px] text-slate-400 text-center">Buka modul kamera untuk dokumentasi muatan</span>
              </>
            )}
          </button>
        </div>

        {/* ── PRIORITAS 2: Nomor Plat (Scan OCR / Ketik Manual) ───────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
              2 · Nomor Plat <span className="text-rose-500">*Wajib</span>
            </p>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${plate.trim() ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
              {plate.trim() ? 'Terisi' : 'Wajib diisi'}
            </span>
          </div>

          <input
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            placeholder="Ketik plat (contoh: B 1234 XY)"
            className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-[14px] font-mono font-black tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
          />

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => openCamera('ocr')}
              disabled={checkLoading}
              title="Scan plat nomor lewat kamera"
              className="flex-1 rounded-xl bg-blue-50 border border-blue-200 py-2.5 text-[12px] font-bold text-blue-700 flex items-center justify-center gap-1.5 hover:bg-blue-100 transition-colors disabled:opacity-60"
            >
              <Camera size={14} /> Scan Plat (OCR)
            </button>
            <button
              type="button"
              onClick={() => void runCheck(plate)}
              disabled={checkLoading || !plate.trim()}
              className="flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-[12px] font-bold text-slate-600 flex items-center justify-center gap-1.5 hover:border-blue-300 transition-colors disabled:opacity-60"
            >
              {checkLoading ? <><Loader2 size={14} className="animate-spin" /> Mengecek...</> : 'Cek Status Plat'}
            </button>
          </div>

          {/* Hasil cek plat */}
          {check && (
            <div className={`mt-2.5 rounded-xl border-2 p-3 ${
              check.status === 'internal' ? 'border-slate-200 bg-slate-50'
              : check.status === 'lokal' ? 'border-blue-200 bg-blue-50'
              : 'border-amber-200 bg-amber-50'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-bold text-[12px] text-slate-700">{check.plate}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  check.status === 'internal' ? 'bg-slate-800 text-white'
                  : check.status === 'lokal' ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-500 text-white'
                }`}>
                  {check.found ? `${check.status} (terdaftar)` : check.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Asal: {check.originRegionCode || '-'}</span>
                <span className="text-slate-500">Pos: {check.checkpointRegionCode || '-'}</span>
              </div>

              {!check.found && check.status !== 'internal' && regions.length > 0 && (
                <div className="mt-2 pt-2 border-t border-black/5 flex items-center gap-2 text-[11px]">
                  <span className="text-slate-500 shrink-0">Wilayah asal:</span>
                  <select
                    value={originRegionId || check.checkpointRegionId || ''}
                    onChange={e => { setOriginRegionId(e.target.value); void runCheck(plate, e.target.value) }}
                    className="flex-1 border rounded-lg px-2 py-1 text-[11px] bg-white"
                  >
                    {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          {plateMsg && <p className="mt-2 text-[11px] text-rose-500 font-semibold">{plateMsg}</p>}
        </div>

        {/* ── DETAIL TAMBAHAN (Opsional / Defaults ke Internal & Truck Sedang) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-4 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
          >
            <div>
              <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                3 · Kategori & Jenis Kendaraan <span className="text-slate-400 font-normal lowercase">(opsional)</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {effectiveVehicleType} · {category || 'Internal (Default)'}
              </p>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          </button>

          {showDetails && (
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-4 animate-fade-in">
              {/* Jenis Kendaraan */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">Jenis Kendaraan</label>
                <div className="grid grid-cols-3 gap-2">
                  {vehicleTypes.map(vt => (
                    <button
                      key={vt}
                      type="button"
                      onClick={() => setVehicleType(vt)}
                      className={`py-2.5 rounded-xl text-[11px] font-bold border-2 flex flex-col items-center gap-1 transition-all ${
                        (vehicleType || effectiveVehicleType) === vt
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'
                      }`}
                    >
                      <span className="text-lg">{emojiFor(vt)}</span>{vt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kategori Kendaraan */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">Kategori Kendaraan</label>
                <div className="space-y-1.5">
                  {[
                    // Istilah lapangan: Internal · Eksternal · Eksternal Bebas
                    // (istilah lama "Berganji"/"Tanpa Garansi" sudah dibuang dari sistem)
                    { key: 'Internal', badge: 'Internal', color: 'bg-slate-800 text-white', desc: 'Plat terdaftar, tanpa tarif' },
                    { key: 'Eksternal', badge: 'Eksternal', color: 'bg-amber-500 text-white', desc: 'Plat luar region, dikenakan tarif region' },
                    { key: 'Eksternal Bebas', badge: 'Ekst. Bebas', color: 'bg-rose-500 text-white', desc: 'Plat luar region, tarif khusus' },
                  ].map(cat => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setCategory(cat.key)}
                      className={`w-full rounded-xl px-3.5 py-2.5 text-left flex items-center justify-between border-2 transition-all ${
                        (category || 'Internal') === cat.key ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-white hover:border-slate-200'
                      }`}
                    >
                      <div>
                        <span className="text-[12px] font-medium text-slate-700">{cat.key}</span>
                        <p className="text-[10px] text-slate-400">{cat.desc}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.color}`}>{cat.badge}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Tombol Aksi Utama (Langsung Aktif begitu Foto + Plat Siap) ────── */}
        <div className="pt-2">
          <button
            onClick={() => setShowModal(true)}
            disabled={!canProceed}
            className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            {!photoTaken
              ? 'Ambil Foto Dokumentasi Dahulu'
              : !plate.trim()
              ? 'Isi Nomor Plat Dahulu'
              : 'Simpan & Lanjutkan'}
          </button>

          {draft.vehicles.length > 0 && !canProceed && (
            <button
              onClick={() => go('trip-summary')}
              className="mt-2.5 w-full bg-white border border-slate-200 text-slate-700 font-bold py-3.5 rounded-2xl text-[13px] hover:bg-slate-50 transition-colors"
            >
              Lanjut ke Ringkasan Trip ({draft.vehicles.length} Kendaraan)
            </button>
          )}
        </div>

        {/* ── Daftar Plat yang Sudah Diinput ──────────────────────────────── */}
        {draft.vehicles.length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mt-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Kendaraan Tersimpan</p>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {draft.vehicles.length} unit
              </span>
            </div>
            <div className="space-y-2">
              {draft.vehicles.map((v, i) => {
                const open = openPlate === v.plate
                return (
                  <div key={`${v.plate}-${i}`} className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setOpenPlate(open ? null : v.plate)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base shrink-0">{emojiFor(v.type)}</span>
                        <span className="min-w-0">
                          <span className="block font-mono font-bold text-[13px] text-slate-800 tracking-wide truncate">{v.plate}</span>
                          <span className="block text-[11px] text-slate-500 truncate">{v.type} · {v.category || 'Internal'}</span>
                        </span>
                      </span>
                      <ChevronDown size={15} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-3.5 pb-3 pt-1 border-t border-slate-100 space-y-2 animate-fade-in text-[12px]">
                        <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="font-bold">{v.plateStatus || 'internal'}</span></div>
                        {v.photoUrl && (
                          <img src={v.photoUrl} alt={`Foto ${v.plate}`} className="w-full h-32 object-cover rounded-xl border border-slate-200" />
                        )}
                        <button
                          onClick={() => {
                            setField({ plate: v.plate, type: v.type, category: v.category })
                            setCheck(null)
                            setPlateMsg('')
                            setOpenPlate(null)
                            void runCheck(v.plate)
                          }}
                          className="mt-1 w-full rounded-xl border border-slate-300 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Ubah / Muat Plat Ini
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal Tambah Kendaraan */}
      {showModal && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-end z-20">
          <div className="w-full bg-white rounded-t-3xl p-6 animate-slide-up">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
            <h3 className="text-slate-900 font-bold text-[17px] text-center mb-1">Tambah Kendaraan Lagi?</h3>
            <p className="text-slate-500 text-[13px] text-center mb-5">Apakah ada unit kendaraan lain dalam trip ini?</p>
            <div className="bg-slate-50 rounded-2xl p-4 mb-5">
              <div className="flex justify-between text-[12px] mb-1.5"><span className="text-slate-500">No. Polisi</span><span className="font-bold font-mono text-slate-800">{plate.trim().toUpperCase()}</span></div>
              <div className="flex justify-between text-[12px] mb-1.5"><span className="text-slate-500">Jenis</span><span className="font-semibold text-slate-700">{vehicleType || effectiveVehicleType}</span></div>
              <div className="flex justify-between text-[12px]"><span className="text-slate-500">Kategori</span><span className="font-semibold text-slate-700">{category || 'Internal'}</span></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { pushVehicle({ resetPhoto: false }); go('trip-summary') }} className="flex-1 py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px] hover:bg-slate-50">Lanjut ke Ringkasan</button>
              <button onClick={() => { pushVehicle({ resetPhoto: true }); setShowModal(false) }} className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-[13px] hover:bg-blue-700">Ya, Tambah Unit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
