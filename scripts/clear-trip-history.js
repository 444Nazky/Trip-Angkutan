#!/usr/bin/env node
/**
 * clear-trip-history.js
 * Bersihkan semua data trip, session, tariffs, dan officers dari localStorage browser.
 *
 * Usage:
 *   node clear-trip-history.js        # Preview apa yang akan dihapus
 *   node clear-trip-history.js --force # Hapus langsung (tanpa konfirmasi)
 *
 * Atau salin ke Console browser DevTools untuk membersihkan langsung.
 */

const LS_KEYS = [
  'trip.trips.v1',
  'trip.officerId.v1',
  'trip.session.v1',
  'trip.tariffs.v1',
  'trip.officers.v1',
  'trip.userType',      // extra: user type stored as raw key
]

// Untuk browser: script berikut bisa dijalankan di DevTools Console
const BROWSER_SCRIPT = `
(function() {
  const keys = [
    'trip.trips.v1',
    'trip.officerId.v1',
    'trip.session.v1',
    'trip.tariffs.v1',
    'trip.officers.v1',
    'trip.userType',
    'trip.loginMethod', // legacy
    'trip.pendingSync',  // sync queue
  ]

  let count = 0
  keys.forEach(k => {
    if (localStorage.getItem(k) !== null) {
      console.log('🗑️ Menghapus:', k, '→', localStorage.getItem(k)?.slice(0, 80) + '...')
      localStorage.removeItem(k)
      count++
    }
  })

  if (count === 0) {
    console.log('✅ Tidak ada data trip yang perlu dibersihkan')
  } else {
    console.log('✅ ' + count + ' item dihapus. Refresh halaman untuk reset aplikasi.')
  }
})()
`

const FORCE = process.argv.includes('--force')

console.log('\n🧹 Clear Trip History Script')
console.log('='.repeat(40))
console.log('\nLocalStorage keys yang akan dibersihkan:\n')

LS_KEYS.forEach(k => console.log('  •', k))

console.log('\n⚠️  Script ini HANYA berfungsi di browser DevTools Console.')
console.log('   Tidak bisa dijalankan dari Node.js (karena Node tidak punya localStorage).\n')

if (FORCE) {
  console.log('Mode force: Tampilkan script untuk browser Console:\n')
  console.log('```javascript')
  console.log(BROWSER_SCRIPT)
  console.log('```')
} else {
  console.log('Mode preview. Jalankan dengan --force untuk melihat script yang perlu disalin ke Console.')
  console.log('\n📋 Script untuk browser DevTools Console:\n')
  console.log('```javascript')
  console.log(BROWSER_SCRIPT)
  console.log('```')
}

console.log('\n' + '='.repeat(40) + '\n')
