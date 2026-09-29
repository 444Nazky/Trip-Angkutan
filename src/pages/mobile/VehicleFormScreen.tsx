import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, Check, Loader2 } from 'lucide-react'
import { tariffFor, useApp } from '../store'
import { checkPlate, type PlateCheck } from '../../services/plates'
import type { MobileScreen } from '../types'

interface VehicleFormScreenProps {
  go: (s: MobileScreen) => void
}

// Label "Pilih…" di select menandakan field belum diisi — sengaja dibuat
// wajib (bukan opsional) untuk jenis kendaraan & kategori.
const TYPE_PLACEHOLDER = 'Pilih jenis kendaraan'
const CATEGORY_PLACEHOLDER = 'Pilih kategori'

export default function VehicleFormScreen({ go }: VehicleFormScreenProps) {
  const { draft, patchDraft, addVehicle, tariffs } = useApp()
  const { plate, type: vehicleType, category } = draft.vehicleForm
  const photoTaken = draft.photo

  const [check, setCheck] = useState<PlateCheck | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [plateError, setPlateError] = useState('')
  const [showModal, setShowModal] = useState(false)

  const vehicleTypes = tariffs.length > 0 ? tariffs.map(t => t.type) : ['Motor', 'Mobil', 'Truck Kecil', 'Truck Sedang', 'Truck Besar']
  const categories = ['Internal', 'Eksternal', 'Lokal']

  // Semua field wajib — tidak ada satu pun yang opsional.
  const plateOk = plate.trim().length >= 2
  const typeOk = !!vehicleType && vehicleType !== TYPE_PLACEHOLDER
  const categoryOk = !!category && category !== CATEGORY_PLACEHOLDER
  const isFormComplete = !!photoTaken && plateOk && typeOk && categoryOk

  const filledCount = [!!photoTaken, plateOk, typeOk, categoryOk].filter(Boolean).length

  const runCheck = async (p: string) => {
    if (!p.trim()) return
    setCheckLoading(true)
    setPlateError('')
    const res = await checkPlate(p, null)
    setCheck(res || null)
    setCheckLoading(false)
  }

  const setField = (p: Partial<{ plate: string; type: string; category: string }>) =>
    patchDraft({ vehicleForm: { ...draft.vehicleForm, ...p } })

  // Handle OCR result
  useEffect(() => {
    if (draft.ocrResult) {
      const normalizedPlate = draft.ocrResult.replace(/\s+/g, ' ').trim().toUpperCase()
      if (normalizedPlate.length >= 3) {
        setField({ plate: normalizedPlate })
        void runCheck(normalizedPlate)
      }
      patchDraft({ ocrResult: undefined })
    }
  }, [draft.ocrResult])

  const openCamera = (mode: 'photo' | 'ocr') => {
    patchDraft({ cameraFrom: 'vehicle-form', cameraMode: mode })
    go('camera')
  }

  // Guard keras: tidak ada kendaraan yang tersimpan dengan field kosong.
  const pushVehicle = () => {
    if (!isFormComplete) return false
    addVehicle({
      plate: plate.trim().toUpperCase(),
      type: vehicleType,
      category: category,
      tariff: tariffFor(vehicleType).loadedNum,
      photoUrl: draft.photoUrl,
      photoCapturedAt: draft.photoCapturedAt,
      photoLatitude: draft.photoLatitude,
      photoLongitude: draft.photoLongitude,
      plateStatus: check?.status,
    })
    patchDraft({
      vehicleForm: { plate: '', type: '', category: '' },
      photo: false,
      photoUrl: undefined,
      photoCapturedAt: undefined,
      photoLatitude: undefined,
      photoLongitude: undefined,
    })
    setCheck(null)
    return true
  }

  return (
    <div className="px-4 pt-2 pb-6">
      <button onClick={() => go('route-select')} className="flex items-center gap-1.5 text-slate-500 text-sm mb-4">
        <ChevronLeft size={16} /> Kembali
      </button>

      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Input Kendaraan</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">Semua kolom wajib diisi</p>
        </div>
        <span className={`text-xs font-semibold tabular-nums ${isFormComplete ? 'text-emerald-600' : 'text-slate-400'}`}>
          {filledCount}/4
        </span>
      </div>

      {/* Satu kartu — tiap baris dipisah garis tipis, tanpa kotak bertumpuk */}
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {/* Foto Dokumentasi */}
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[13px] font-medium text-slate-600">
              Foto Dokumentasi <span className="text-red-500">*</span>
            </label>
            {photoTaken && (
              <button onClick={() => openCamera('photo')} className="text-[11px] text-blue-600 font-medium">
                Ulangi
              </button>
            )}
          </div>
          <button
            onClick={() => openCamera('photo')}
            className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
              photoTaken
                ? 'border-slate-200 bg-white'
                : 'border-dashed border-slate-300 bg-slate-50 hover:border-slate-400'
            }`}
          >
            {photoTaken && draft.photoUrl ? (
              <>
                <img src={draft.photoUrl} alt="" className="w-11 h-11 rounded-lg object-cover" />
                <span className="text-sm text-slate-700">Foto tersimpan</span>
                <Check size={16} className="ml-auto text-emerald-500" />
              </>
            ) : (
              <>
                <span className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Camera size={18} className="text-slate-500" />
                </span>
                <span className="text-sm text-slate-600">Ambil foto dari kamera</span>
              </>
            )}
          </button>
        </div>

        {/* Nomor Plat */}
        <div className="px-4 py-3.5">
          <label className="text-[13px] font-medium text-slate-600 block mb-2">
            Nomor Plat <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              value={plate}
              onChange={e => {
                setPlateError('')
                setField({ plate: e.target.value.toUpperCase() })
              }}
              onBlur={() => plate.trim() && void runCheck(plate)}
              placeholder="B 1234 XY"
              className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono font-bold tracking-wider text-slate-900 placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => openCamera('ocr')}
              className="shrink-0 px-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-100"
            >
              <Camera size={14} /> Scan
            </button>
          </div>
          {plateError && <p className="text-xs text-red-500 mt-1.5">{plateError}</p>}
          {(check || checkLoading) && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
              {checkLoading ? (
                <><Loader2 size={12} className="animate-spin" /> Memeriksa plat…</>
              ) : check ? (
                <>
                  <span className={`font-medium ${
                    check.status === 'internal' ? 'text-slate-700'
                    : check.status === 'lokal' ? 'text-blue-600'
                    : 'text-amber-600'
                  }`}>{check.status}</span>
                  {check.found && <span>(terdaftar di database)</span>}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Jenis Kendaraan — wajib */}
        <div className="px-4 py-3.5">
          <label htmlFor="v-type" className="text-[13px] font-medium text-slate-600 block mb-2">
            Jenis Kendaraan <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              id="v-type"
              value={typeOk ? vehicleType : ''}
              onChange={e => setField({ type: e.target.value })}
              className={`w-full appearance-none bg-slate-50 border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 ${
                typeOk ? 'border-slate-200 text-slate-900' : 'border-slate-300 text-slate-400'
              }`}
            >
              <option value="">{TYPE_PLACEHOLDER}</option>
              {vehicleTypes.map(vt => (
                <option key={vt} value={vt}>{vt}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
          </div>
        </div>

        {/* Kategori — wajib */}
        <div className="px-4 py-3.5">
          <label htmlFor="v-category" className="text-[13px] font-medium text-slate-600 block mb-2">
            Kategori <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              id="v-category"
              value={categoryOk ? category : ''}
              onChange={e => setField({ category: e.target.value })}
              className={`w-full appearance-none bg-slate-50 border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 ${
                categoryOk ? 'border-slate-200 text-slate-900' : 'border-slate-300 text-slate-400'
              }`}
            >
              <option value="">{CATEGORY_PLACEHOLDER}</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
          </div>
        </div>
      </div>

      {/* Tombol Simpan — terkunci sampai 4/4 */}
      <button
        onClick={() => isFormComplete && setShowModal(true)}
        disabled={!isFormComplete}
        className={`w-full py-3.5 mt-4 rounded-xl font-semibold text-sm transition-colors ${
          isFormComplete
            ? 'bg-slate-900 text-white hover:bg-slate-800'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        {!photoTaken
          ? 'Ambil Foto Dahulu'
          : !plateOk
            ? 'Isi Nomor Plat'
            : !typeOk
              ? 'Pilih Jenis Kendaraan'
              : !categoryOk
                ? 'Pilih Kategori'
                : 'Simpan Kendaraan'}
      </button>

      {/* Kendaraan Tersimpan */}
      {draft.vehicles.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-slate-500 mb-2">
            Kendaraan Tersimpan <span className="text-slate-400">({draft.vehicles.length})</span>
          </p>
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {draft.vehicles.map((v, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                {v.photoUrl && <img src={v.photoUrl} alt="" className="w-8 h-8 rounded-md object-cover" />}
                <span className="font-mono font-bold text-[13px] text-slate-800">{v.plate}</span>
                <span className="text-xs text-slate-500">{v.type}</span>
                <span className="ml-auto text-[11px] text-slate-400">{v.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50">
          <div className="w-full bg-white rounded-t-2xl p-6">
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-5" />
            <h3 className="text-center font-semibold text-slate-900 mb-4">Kendaraan Tersimpan</h3>

            <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Plat</span>
                <span className="font-mono font-bold">{plate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Jenis</span>
                <span>{vehicleType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kategori</span>
                <span>{category}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { if (pushVehicle()) { setShowModal(false); go('trip-summary') } }}
                className="flex-1 py-3 rounded-xl border-2 border-slate-200 font-medium text-sm text-slate-700"
              >
                Lanjut Trip
              </button>
              <button
                onClick={() => { if (pushVehicle()) setShowModal(false) }}
                className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium text-sm"
              >
                Tambah Lagi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
