import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Check, Camera, Loader2, ClipboardList, ChevronDown } from 'lucide-react'
import { tariffFor, useApp } from '../store'
import { tariffData } from '../data'
import { readPlateFromImage } from '../../services/ocr'
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
  const [ocrBusy, setOcrBusy] = useState(false)
  const [plateMsg, setPlateMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  const onScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrBusy(true)
    setPlateMsg('')
    try {
      const text = await readPlateFromImage(file)
      if (!text) {
        setPlateMsg('Plat tidak terbaca — silakan ketik manual')
      } else {
        setField({ plate: text })
        await runCheck(text)
      }
    } catch {
      setPlateMsg('OCR gagal (unduhan data OCR butuh internet) — ketik manual')
    } finally {
      setOcrBusy(false)
      e.target.value = ''
    }
  }

  // Vehicle types come from the admin-managed master tariff so the selected
  // type always maps 1:1 to a tariff row (e.g. Truck Besar ≠ Truck Sedang).
  const vehicleTypes = tariffs.length > 0 ? tariffs.map(t => t.type) : tariffData.map(t => t.type)
  const emojiFor = (t: string) => /motor/i.test(t) ? '🏍️' : /mobil/i.test(t) ? '🚗' : '🚛'

  // Form fields live in the store draft so they survive navigation to the
  // camera screen and back (component unmounts while off-screen).
  const setField = (p: Partial<{ plate: string; type: string; category: string }>) =>
    patchDraft({ vehicleForm: { ...draft.vehicleForm, ...p } })
  const setPlate = (v: string) => setField({ plate: v })
  const setVehicleType = (v: string) => setField({ type: v })
  const setCategory = (v: string) => setField({ category: v })

  // Detail informasi tambahan hanya muncul setelah input kendaraan selesai
  const vehicleInputDone = !!plate.trim() && !!vehicleType

  const pushVehicle = () => {
    addVehicle({ plate, type: vehicleType, category, tariff: tariffFor(vehicleType).loadedNum })
    patchDraft({ vehicleForm: { plate: '', type: '', category: '' }, photo: false, photoUrl: undefined })
  }

  const openCamera = () => {
    patchDraft({ cameraFrom: 'vehicle-form' })
    go('camera')
  }

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button onClick={() => go('route-select')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Data Kendaraan</h2>
      <p className="text-slate-500 text-[13px] mb-4">Lengkapi informasi kendaraan yang dibawa</p>

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
        {/* ── Langkah 1: Identitas kendaraan ──────────────────────────────── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">1 · Input Kendaraan</p>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${vehicleInputDone ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              {vehicleInputDone ? 'Selesai' : 'Belum lengkap'}
            </span>
          </div>

          <div className="space-y-4">
            {/* No. Polisi */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">No. Polisi</label>
              <input
                value={plate}
                onChange={e => setPlate(e.target.value.toUpperCase())}
                placeholder="Contoh: B 1234 XY"
                className="w-full bg-white border-2 border-slate-100 rounded-xl px-4 py-3 text-[13px] font-mono font-bold tracking-widest text-slate-900 placeholder:text-slate-300 placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:border-blue-500 transition-colors"
              />

              {/* Aksi scan & cek plat */}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={ocrBusy}
                  className="flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-[12px] font-bold text-slate-600 flex items-center justify-center gap-1.5 hover:border-blue-300 transition-colors disabled:opacity-60"
                >
                  {ocrBusy ? <><Loader2 size={14} className="animate-spin" /> Membaca plat...</> : <><Camera size={14} /> Scan Foto Plat (OCR)</>}
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
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => void onScanFile(e)}
                className="hidden"
              />

              {/* Hasil cek plat */}
              {check && (
                <div className={`mt-2 rounded-xl border-2 p-3 ${
                  check.status === 'internal' ? 'border-slate-200 bg-slate-50'
                  : check.status === 'lokal' ? 'border-blue-200 bg-blue-50'
                  : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono font-bold text-[12px] text-slate-700">{check.plate}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      check.status === 'internal' ? 'bg-slate-800 text-white'
                      : check.status === 'lokal' ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-500 text-white'
                    }`}>
                      {check.found ? `${check.status} (terdaftar)` : check.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-slate-500">Wilayah asal kendaraan</span>
                    <span className="font-bold text-slate-700">{check.originRegionCode || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px] mt-1">
                    <span className="text-slate-500">Pos pemeriksaan</span>
                    <span className="font-bold text-slate-700">{check.checkpointRegionCode || '-'}</span>
                  </div>

                  {/* Plat tak terdaftar & bukan internal → pilih region asal kendaraan */}
                  {!check.found && check.status !== 'internal' && regions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-black/5 flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500 shrink-0">Region asal:</span>
                      <select
                        value={originRegionId || check.checkpointRegionId || ''}
                        onChange={e => { setOriginRegionId(e.target.value); void runCheck(plate, e.target.value) }}
                        className="flex-1 border rounded-lg px-2 py-1.5 text-[11px] bg-white"
                      >
                        {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {plateMsg && <p className="mt-2 text-[11px] text-rose-500 font-semibold">{plateMsg}</p>}
            </div>

            {/* Jenis Kendaraan */}
            <div>
              <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">Jenis Kendaraan</label>
              <div className="grid grid-cols-3 gap-2">
                {vehicleTypes.map(vt => (
                  <button
                    key={vt}
                    onClick={() => setVehicleType(vt)}
                    className={`py-3.5 rounded-xl text-[11px] font-bold border-2 flex flex-col items-center gap-1.5 transition-all ${vehicleType === vt ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'}`}
                  >
                    <span className="text-xl">{emojiFor(vt)}</span>{vt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Langkah 2: Detail informasi tambahan (muncul setelah input kendaraan) ── */}
        {!vehicleInputDone ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-center">
            <ClipboardList size={22} className="text-slate-300 mx-auto mb-2" />
            <p className="text-[12px] font-bold text-slate-500">Detail informasi tambahan</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Lengkapi No. Polisi dan Jenis Kendaraan terlebih dahulu
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">2 · Detail Informasi Tambahan</p>
              <ChevronDown size={14} className="text-slate-300" />
            </div>

            <div className="space-y-4">
              {/* Kategori */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">Kategori Kendaraan</label>
                <div className="space-y-2">
                  {[
                    { key: 'Internal', badge: 'Internal', color: 'bg-slate-800 text-white' },
                    { key: 'Eksternal (Berganji)', badge: 'Ekst. Berganji', color: 'bg-amber-500 text-white' },
                    { key: 'Eksternal (Tanpa Garansi)', badge: 'Ekst. Tanpa Garansi', color: 'bg-rose-500 text-white' },
                  ].map(cat => (
                    <button
                      key={cat.key}
                      onClick={() => setCategory(cat.key)}
                      className={`w-full rounded-xl px-4 py-3 text-left flex items-center justify-between border-2 transition-all ${category === cat.key ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                    >
                      <span className="text-[13px] font-medium text-slate-700">{cat.key}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.color}`}>{cat.badge}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Foto Bukti — wajib via kamera */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 mb-2 block uppercase tracking-wide">
                  Foto Bukti <span className="text-rose-500">· Wajib (Kamera)</span>
                </label>
                <button
                  onClick={openCamera}
                  className={`w-full rounded-2xl border-2 border-dashed py-4 px-4 flex flex-col items-center gap-2 transition-all ${photoTaken ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300'}`}
                >
                  {photoTaken ? (
                    <>
                      {draft.photoUrl ? (
                        <img src={draft.photoUrl} alt="Bukti Muatan" className="w-24 h-24 object-cover rounded-xl border border-emerald-300 shadow-sm" />
                      ) : (
                        <span className="text-3xl">✅</span>
                      )}
                      <span className="text-[12px] font-bold text-emerald-600">Foto berhasil diambil via kamera</span>
                      <span className="text-[10px] text-emerald-500">Ketuk untuk ambil ulang</span>
                    </>
                  ) : (
                    <>
                      <Camera size={28} className="text-slate-400" />
                      <span className="text-[12px] font-semibold text-slate-500">Ambil Foto via Kamera</span>
                      <span className="text-[10px] text-slate-400">Wajib — gunakan kamera perangkat</span>
                    </>
                  )}
                </button>
              </div>

              <button
                onClick={() => setShowModal(true)}
                disabled={!photoTaken || !plate || !vehicleType || !category}
                className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all"
              >
                {!photoTaken ? 'Ambil Foto Kamera Dulu' : 'Simpan Data Kendaraan'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Tambah Kendaraan */}
      {showModal && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-end z-20">
          <div className="w-full bg-white rounded-t-3xl p-6 animate-slide-up">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
            <h3 className="text-slate-900 font-bold text-[17px] text-center mb-1">Tambah Kendaraan?</h3>
            <p className="text-slate-500 text-[13px] text-center mb-5">Input kendaraan tambahan untuk trip yang sama?</p>
            <div className="bg-slate-50 rounded-2xl p-4 mb-5">
              <div className="flex justify-between text-[12px] mb-1.5"><span className="text-slate-500">No. Polisi</span><span className="font-bold font-mono text-slate-800">{plate}</span></div>
              <div className="flex justify-between text-[12px] mb-1.5"><span className="text-slate-500">Jenis</span><span className="font-semibold text-slate-700">{vehicleType}</span></div>
              <div className="flex justify-between text-[12px]"><span className="text-slate-500">Kategori</span><span className="font-semibold text-slate-700">{category}</span></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { pushVehicle(); go('trip-summary') }} className="flex-1 py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px] hover:bg-slate-50">Tidak, Lanjutkan</button>
              <button onClick={() => { pushVehicle(); setShowModal(false) }} className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-[13px] hover:bg-blue-700">Ya, Tambah</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
