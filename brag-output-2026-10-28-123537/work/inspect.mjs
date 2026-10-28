/** Cek isi frame: teks yang terlihat + statistik piksel (deteksi frame kosong). */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(HERE, process.argv[2] || 'stills')

for (const f of (await readdir(dir)).filter((n) => n.endsWith('.png')).sort()) {
  const p = path.join(dir, f)
  const out = execFileSync('identify', ['-format', '%wx%h %[mean] %[standard-deviation]', p], {
    encoding: 'utf8',
  })
  // rasio piksel non-background: berapa banyak piksel beda jauh dari warna角角
  const stat = execFileSync(
    'convert',
    [p, '-colorspace', 'gray', '-format', '%[fx:standard_deviation]', 'info:'],
    { encoding: 'utf8' },
  )
  console.log(f.padEnd(16), out.trim(), ' sd(gray)=', stat.trim())
}
