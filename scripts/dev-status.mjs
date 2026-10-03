#!/usr/bin/env node
/**
 * Status server lokal Trip Angkutan — `npm run status`
 * Mencetak port, PID, dan URL tiap layanan (API, mobile dev, admin PHP).
 */

import { execSync } from 'node:child_process'

const SERVICES = [
  { name: 'Backend API', port: 3000, url: 'http://localhost:3000/api/health' },
  { name: 'Mobile (dev)', port: 5173, url: 'http://localhost:5173' },
  { name: 'Admin (PHP)', port: 8000, url: 'http://localhost:8000' },
]

const listening = execSync("ss -ltn 2>/dev/null || true", { encoding: 'utf8' })
const procs = execSync("ps -eo pid,cmd 2>/dev/null || true", { encoding: 'utf8' })

const pidOf = (needle) =>
  procs
    .split('\n')
    .find((l) => l.includes(needle) && !l.includes('dev-status'))
    ?.trim() ?? '-'

console.log('Status server lokal Trip Angkutan\n')
for (const svc of SERVICES) {
  const up = listening.includes(`:${svc.port} `) || listening.includes(`:${svc.port}\n`)
  const marker = up ? '🟢 UP  ' : '🔴 DOWN'
  const proc = svc.port === 3000 ? 'node src/index.js' : svc.port === 5173 ? 'ng serve' : 'php -S'
  console.log(`${marker}  :${svc.port}  ${svc.name.padEnd(15)} ${svc.url}`)
  console.log(`         pid: ${pidOf(proc)}`)
}
console.log('\nNyalakan semua : ./restart-all.sh   ·   Hentikan dev : pkill -f "[n]g serve"')
