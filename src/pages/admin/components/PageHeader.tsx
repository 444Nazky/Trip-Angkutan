import type { ReactNode } from 'react'
import { PAGE_HEADER, PAGE_HEADER_BAR, PAGE_HEADER_SUB, PAGE_HEADER_TITLE } from '../theme'

interface PageHeaderProps {
  /** Judul halaman (mis. "Master Tarif"). */
  title: string
  /** Keterangan singkat di bawah judul. */
  subtitle?: ReactNode
  /** Elemen kanan: badge status, tombol aksi, dsb. */
  actions?: ReactNode
}

/**
 * Header halaman admin.
 *
 * Permukaannya tetap putih (tidak bidang gelap) - warna datang dari aksen
 * biru #2563EB di tepi kiri, badge status, dan kepala tabel.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className={PAGE_HEADER}>
      <span className={PAGE_HEADER_BAR} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className={PAGE_HEADER_TITLE}>{title}</h3>
          {subtitle ? <p className={PAGE_HEADER_SUB}>{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
