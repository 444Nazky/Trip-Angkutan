// ─── Shared Data ──────────────────────────────────────────────────────────────

export const ROUTES = [
  { code: 'SJRE-SBDZ', from: 'SJRE', to: 'SBDZ', label: 'Sijangkung → Sabadi', distance: '42 km', duration: '1j 10m' },
  { code: 'SBDZ-SJRE', from: 'SBDZ', to: 'SJRE', label: 'Sabadi → Sijangkung', distance: '42 km', duration: '1j 10m' },
  { code: 'SJRE-BDAU', from: 'SJRE', to: 'BDAU', label: 'Sijangkung → Badau', distance: '18 km', duration: '35m' },
  { code: 'BDAU-SJRE', from: 'BDAU', to: 'SJRE', label: 'Badau → Sijangkung', distance: '18 km', duration: '35m' },
]

export const allTrips = [
  { id: 'TRP-2026-0091', route: 'SJRE → SBDZ', status: 'Selesai', time: '08:42', date: '21 Sep 2026', load: 'Ada Muatan', vehicle: 'B 3821 KDA', type: 'Truck Sedang', category: 'Internal', revenue: 'Rp 280.000', officer: 'Budi Santoso', duration: '1j 08m', photo: true },
  { id: 'TRP-2026-0090', route: 'SBDZ → SJRE', status: 'Selesai', time: '06:15', date: '21 Sep 2026', load: 'Kosong', vehicle: 'B 3821 KDA', type: 'Truck Sedang', category: 'Internal', revenue: 'Rp 0', officer: 'Budi Santoso', duration: '1j 12m', photo: false },
  { id: 'TRP-2026-0089', route: 'SJRE → SBDZ', status: 'Selesai', time: '14:30', date: '20 Sep 2026', load: 'Ada Muatan', vehicle: 'KA 1142 AR', type: 'Truck Besar', category: 'Eksternal', revenue: 'Rp 450.000', officer: 'Andi Pratama', duration: '1j 22m', photo: true },
  { id: 'TRP-2026-0088', route: 'SBDZ → SJRE', status: 'Selesai', time: '11:00', date: '20 Sep 2026', load: 'Ada Muatan', vehicle: 'KA 4471 BX', type: 'Mobil', category: 'Eksternal Bebas', revenue: 'Rp 45.000', officer: 'Siti Rahayu', duration: '58m', photo: true },
  { id: 'TRP-2026-0087', route: 'SJRE → BDAU', status: 'Selesai', time: '09:00', date: '19 Sep 2026', load: 'Ada Muatan', vehicle: 'B 9912 ZZ', type: 'Motor', category: 'Internal', revenue: 'Rp 15.000', officer: 'Budi Santoso', duration: '33m', photo: true },
  { id: 'TRP-2026-0086', route: 'BDAU → SJRE', status: 'Selesai', time: '07:45', date: '19 Sep 2026', load: 'Kosong', vehicle: 'B 9912 ZZ', type: 'Motor', category: 'Internal', revenue: 'Rp 0', officer: 'Budi Santoso', duration: '37m', photo: false },
]

export const tariffData = [
  { golongan: 'I', type: 'Motor', loaded: 'Rp 15.000', loadedNum: 15000, empty: 'Rp 8.000', emptyNum: 8000, desc: 'Sepeda motor roda dua' },
  { golongan: 'II', type: 'Mobil', loaded: 'Rp 45.000', loadedNum: 45000, empty: 'Rp 20.000', emptyNum: 20000, desc: 'Mobil penumpang / pickup kecil' },
  { golongan: 'III', type: 'Truck Kecil', loaded: 'Rp 120.000', loadedNum: 120000, empty: 'Rp 55.000', emptyNum: 55000, desc: 'Truck ringan s/d 3 ton' },
  { golongan: 'IV', type: 'Truck Sedang', loaded: 'Rp 280.000', loadedNum: 280000, empty: 'Rp 130.000', emptyNum: 130000, desc: 'Truck sedang 3–8 ton' },
  { golongan: 'V', type: 'Truck Besar', loaded: 'Rp 450.000', loadedNum: 450000, empty: 'Rp 200.000', emptyNum: 200000, desc: 'Truck besar / trailer di atas 8 ton' },
]

export const officerList = [
  { id: '1', name: 'Budi Santoso', initials: 'BS', region: 'BADAU', pin: '123456', status: 'Aktif', device: 'iPhone 14', trips: 91, lastActive: 'Hari ini 08:42', joined: '12 Jan 2025' },
  { id: '2', name: 'Andi Pratama', initials: 'AP', region: 'BADAU', pin: '123456', status: 'Aktif', device: 'Samsung A54', trips: 78, lastActive: 'Hari ini 06:30', joined: '3 Mar 2025' },
  { id: '3', name: 'Siti Rahayu', initials: 'SR', region: 'BADAU', pin: '123456', status: 'Nonaktif', device: 'Redmi 12', trips: 43, lastActive: '15 Sep 2026', joined: '22 Jun 2025' },
  { id: '4', name: 'Rizky Maulana', initials: 'RM', region: 'ENTIKONG', pin: '123456', status: 'Aktif', device: 'Oppo A78', trips: 112, lastActive: 'Hari ini 09:15', joined: '8 Feb 2025' },
  { id: '5', name: 'Dewi Kusuma', initials: 'DK', region: 'ENTIKONG', pin: '123456', status: 'Aktif', device: 'iPhone 13', trips: 65, lastActive: 'Kemarin 14:00', joined: '17 Apr 2025' },
]
