import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOTS = (process.env.RESTYLE_ROOTS ?? 'src,server,scripts').split(',')
const SELF = path.resolve('scripts/tmp-restyle.mjs')

const KEEP_RE = /^(deno-lint|eslint|@ts-|prettier|istanbul|c8 |vitest|TODO|FIXME|HACK|XXX|@deprecated|\/\/\/)/i
const WHY_RE = /(karena|jangan|wajib|harus|sengaja|tadinya|bug|gotcha|alasan|race|fallback|kenapa|security|workaround|server menolak|tidak boleh|jangan sampai|supaya|agar|catatan|penting|sebelum|setelah|hanya|bukan|manual|urutan)/i

const stats = { files: 0, removedComments: 0, keptComments: 0, gaps: 0 }

function scriptKind(file) {

  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  if (file.endsWith('.mjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.JSX

}

function parse(text, file) {

  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))

}

function leadingComments(text, pos) {

  const out = new Map()

  for (const p of [pos, pos - 1, pos - 2]) {

    if (p < 0) continue

    for (const c of ts.getLeadingCommentRanges(text, p) ?? []) out.set(`${c.pos}:${c.end}`, c)

  }

  return [...out.values()]

}

function collectComments(text, file) {

  const sf = parse(text, file)
  const ranges = new Map()

  const visit = (node) => {

    if (node.pos >= 0) {

      for (const c of leadingComments(text, node.pos)) ranges.set(`${c.pos}:${c.end}`, c)

    }

    for (const c of ts.getTrailingCommentRanges(text, node.end) ?? []) {

      ranges.set(`${c.pos}:${c.end}`, c)

    }

    for (const d of node.jsDoc ?? []) {

      ranges.set(`${d.pos}:${d.end}`, { pos: d.pos, end: d.end, kind: ts.SyntaxKind.MultiLineCommentTrivia })

    }

    const kids = node.getChildren ? node.getChildren(sf) : []

    for (const k of kids) visit(k)

  }

  visit(sf)

  for (const c of leadingComments(text, sf.end)) ranges.set(`${c.pos}:${c.end}`, c)

  return [...ranges.values()].sort((a, b) => a.pos - b.pos)

}

function commentText(text, c) {

  return text.slice(c.pos, c.end)

}

function commentBody(raw) {

  return raw
    .replace(/^\/\/\/?\s?/, '')
    .replace(/^\/\*+\s?/, '')
    .replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

}

function isDirective(body) {

  return KEEP_RE.test(body)

}

function shouldKeep(body) {

  return isDirective(body) || WHY_RE.test(body)

}

function condense(body, max = 150) {

  if (body.length <= max) return body

  const cut = body.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '))

  if (stop > 40) return cut.slice(0, stop + 1).trim()

  const space = cut.lastIndexOf(' ')

  return `${cut.slice(0, space > 40 ? space : max).trim()}…`

}

function lineStart(text, pos) {

  return text.lastIndexOf('\n', pos - 1) + 1

}

function commentRuns(text, ranges) {

  const runs = []

  for (const c of ranges) {

    const last = runs[runs.length - 1]

    if (last && c.pos < last.end) continue

    const gap = last ? text.slice(last.end, c.pos) : ''
    const adjacent = last && gap.trim() === '' && (gap.match(/\n/g) ?? []).length <= 1

    if (adjacent) {

      last.end = c.end
      last.parts.push(c)

    } else {

      runs.push({ start: c.pos, end: c.end, parts: [c] })

    }

  }

  return runs

}

function removeComments(text, file) {

  const comments = collectComments(text, file)
  const edits = []

  for (const run of commentRuns(text, comments)) {

    const parts = run.parts.map((p) => text.slice(p.pos, p.end))
    const body = parts.map(commentBody).join(' ').replace(/\s+/g, ' ').trim()

    const first = run.parts[0]
    const lastPart = run.parts[run.parts.length - 1]

    const before = text.slice(lineStart(text, run.start), run.start)
    const afterLineEnd = text.indexOf('\n', run.end)
    const after = text.slice(run.end, afterLineEnd < 0 ? text.length : afterLineEnd)
    const aloneOnLines = before.trim() === '' && after.trim() === ''
    const inJsx = text[run.start - 1] === '{' && text[run.end] === '}'
    const directive = parts.some((p) => isDirective(commentBody(p)))

    if (!directive && (parts.join('').length > 90 || parts.length > 1) && shouldKeep(body)) {

      stats.keptComments++

      const line = condense(body)
      const replacement = inJsx ? `{/* ${line} */}` : `// ${line}`
      const start = inJsx ? run.start - 1 : run.start
      const end = inJsx ? run.end + 1 : run.end

      edits.push({ start, end, text: replacement })
      continue

    }

    if (directive || shouldKeep(body)) {

      stats.keptComments++
      continue

    }

    stats.removedComments++

    if (aloneOnLines) {

      const start = lineStart(text, run.start)
      const end = afterLineEnd < 0 ? text.length : afterLineEnd + 1

      edits.push({ start, end, text: '' })

    } else if (inJsx) {

      edits.push({ start: run.start - 1, end: run.end + 1, text: '' })

    } else {

      edits.push({ start: first.pos, end: lastPart.end, text: '' })

    }

  }

  let out = text

  for (const e of edits.sort((a, b) => b.start - a.start)) {

    out = out.slice(0, e.start) + e.text + out.slice(e.end)

  }

  return out

}

function mergeImports(text, file) {

  const sf = parse(text, file)
  const imports = sf.statements.filter(ts.isImportDeclaration)
  const groups = new Map()

  for (const node of imports) {

    const mod = node.moduleSpecifier.getText(sf)
    if (!groups.has(mod)) groups.set(mod, [])
    groups.get(mod).push(node)

  }

  const edits = []

  for (const [, list] of groups) {

    if (list.length < 2) continue
    if (list.some((n) => n.assertClause)) continue

    const clauses = list.map((n) => n.importClause)
    if (clauses.some((c) => !c)) continue
    if (clauses.some((c) => c.namedBindings && ts.isNamespaceImport(c.namedBindings))) continue

    const typeOnly = clauses[0].isTypeOnly
    if (clauses.some((c) => c.isTypeOnly !== typeOnly)) continue

    const defaults = [...new Set(clauses.map((c) => c.name?.text).filter(Boolean))]
    if (defaults.length > 1) continue

    const named = []
    const seen = new Set()

    for (const c of clauses) {

      if (!c.namedBindings || !ts.isNamedImports(c.namedBindings)) continue

      for (const el of c.namedBindings.elements) {

        const key = `${el.propertyName?.text ?? ''}:${el.name.text}:${el.isTypeOnly ? 'type' : ''}`
        if (seen.has(key)) continue

        seen.add(key)
        named.push(el.getText(sf))

      }

    }

    const parts = []

    if (defaults[0]) parts.push(defaults[0])
    if (named.length > 0) parts.push(`{ ${named.join(', ')} }`)
    if (parts.length === 0) continue

    const mod = list[0].moduleSpecifier.getText(sf)
    const merged = `import ${typeOnly ? 'type ' : ''}${parts.join(', ')} from ${mod}`

    const first = list[0]
    edits.push({ start: first.getStart(sf), end: first.moduleSpecifier.getEnd(), text: merged })

    for (const extra of list.slice(1)) {

      const lineBegin = lineStart(text, extra.getStart(sf))
      const lineEnd = text.indexOf('\n', extra.moduleSpecifier.getEnd())

      edits.push({ start: lineBegin, end: lineEnd < 0 ? text.length : lineEnd + 1, text: '' })

    }

  }

  let out = text

  for (const e of edits.sort((a, b) => b.start - a.start)) {

    out = out.slice(0, e.start) + e.text + out.slice(e.end)

  }

  return out

}

function compactImports(text, file) {

  const sf = parse(text, file)
  const edits = []

  for (const node of sf.statements) {

    if (!ts.isImportDeclaration(node)) continue

    const clause = node.importClause
    if (!clause) continue

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) continue

    if (node.assertClause) continue

    if (!node.getText(sf).includes('\n')) continue

    const singleLine = clause.getText(sf).replace(/\s+/g, ' ')
    const mod = node.moduleSpecifier.getText(sf)
    const line = `import ${singleLine} from ${mod}`

    if (line.length > 120) continue

    edits.push({ start: node.getStart(sf), end: node.moduleSpecifier.getEnd(), text: line })

  }

  let out = text

  for (const e of edits.sort((a, b) => b.start - a.start)) {

    out = out.slice(0, e.start) + e.text + out.slice(e.end)

  }

  return out

}

function statementArrays(sf) {

  const out = []

  const visit = (node) => {

    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) {

      out.push(node)

    }

    ts.forEachChild(node, visit)

  }

  visit(sf)

  return out

}

function gapBlankLines(gap) {

  return Math.max(0, (gap.match(/\n/g) ?? []).length - 1)

}

function isTop(node) {

  return ts.isSourceFile(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)

}

function applySpacing(text, file) {

  const sf = parse(text, file)
  const edits = []

  for (const holder of statementArrays(sf)) {

    const list = ts.isSourceFile(holder) ? holder.statements : holder.members

    if (!list || list.length < 2) continue

    for (let i = 0; i < list.length - 1; i++) {

      const a = list[i]
      const b = list[i + 1]

      const end = a.getEnd()
      const start = b.getStart(sf)

      if (start <= end) continue

      const gap = text.slice(end, start)

      if (!gap.includes('\n')) continue

      if (gap.trim() !== '') continue

      const blanks = gapBlankLines(gap)

      const bothImports = ts.isImportDeclaration(a) && ts.isImportDeclaration(b)

      const target = bothImports ? 0 : isTop(holder) || blanks >= 1 ? 3 : 0

      if (target === 0) continue

      if (blanks === target) continue

      edits.push({ start: end, end: start, text: '\n'.repeat(target + 1) })
      stats.gaps = stats.gaps + 1

    }

  }

  let out = text

  for (const e of edits.sort((a, b) => b.start - a.start)) {

    out = out.slice(0, e.start) + e.text + out.slice(e.end)

  }

  return out

}

function tidy(text) {

  const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''))
  const collapsed = []

  let blanks = 0

  for (const line of lines) {

    if (line === '') {

      blanks++
      if (blanks > 3) continue

    } else blanks = 0

    collapsed.push(line)

  }

  return collapsed.join('\n').replace(/\n*$/, '\n')

}

function walk(dir, acc = []) {

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)

  }

  return acc

}

const files = []

for (const root of ROOTS) {

  for (const f of walk(root)) {

    if (path.resolve(f) === SELF) continue
    files.push(f)

  }

}

for (const file of files) {

  const original = fs.readFileSync(file, 'utf8')

  let next = removeComments(original, file)
  next = mergeImports(next, file)
  next = compactImports(next, file)
  next = applySpacing(next, file)
  next = tidy(next)

  if (next === original) continue

  const diag = parse(next, file).parseDiagnostics ?? []

  if (diag.length > 0) {

    console.error(`SYNTAX ERROR ${file}: ${diag[0].messageText}`)
    process.exitCode = 1
    continue

  }

  fs.writeFileSync(file, next)
  stats.files++

}

console.log(JSON.stringify(stats, null, 1))
