#!/usr/bin/env node
/**
 * English-as-key codemod. Usage:
 *   node scripts/i18n-codemod.mjs            # rewrite files in place (idempotent) + regenerate manifest
 *   node scripts/i18n-codemod.mjs --manifest # only regenerate lib/i18n/ui-manifest.json from current sources
 * Wraps visible hard-coded English in <Tx>…</Tx> / __tx("…") and lists every string in lib/i18n/ui-manifest.json.
 */
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const MANIFEST_ONLY = process.argv.includes('--manifest')
const SKIP = [/^components\/ui\//, /^app\/api\//, /^components\/tx\.tsx$/, /\.test\./, /^app\/global-error/]
const RENDER_NAMES = new Set(['label', 'title', 'description', 'subtitle', 'hint', 'heading', 'tooltip', 'cta', 'helperText', 'emptyText', 'error', 'errorMessage', 'message', 'msg', 'notice'])
const PROP_KEYS = new Set(['label', 'title', 'description', 'subtitle', 'hint', 'heading', 'placeholder', 'tooltip', 'cta', 'helperText', 'emptyText'])
const DOM_ATTRS = new Set(['placeholder', 'aria-label', 'alt'])
const COMPONENT_ATTRS = new Set(['title', 'label', 'description', 'subtitle', 'hint', 'heading', 'helperText', 'tooltip', 'cta', 'emptyText'])
const CALLS = new Set(['setError', 'setErr', 'setMsg', 'setMessage', 'setNotice', 'setInfo', 'setSuccess', 'setFormError', 'setStatusMsg', 'setStatusMessage', 'alert', 'confirm', 'showToast', 'setToast', 'setErrorMessage', 'setSuccessMessage'])
const TOAST_OBJ = new Set(['toast'])
const NO_TEXT_PARENTS = new Set(['script', 'style', 'code', 'pre', 'textarea'])
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', copy: '©', middot: '·', bull: '•' }

const norm = s => s.replace(/\s+/g, ' ').trim()
const letters = s => (s.match(/\p{L}/gu) || []).length
function decode(raw) {
  let bad = false
  const out = raw.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, g) => {
    if (g[0] === '#') { try { return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) } catch { bad = true; return m } }
    if (g in ENT) return ENT[g]; bad = true; return m
  })
  return bad ? null : out
}
const looksHuman = s => { const n = norm(s); return n.length >= 2 && n.length <= 400 && letters(n) >= 2 && !/^(https?:|\/|#|\.|\$\{)/.test(n) && !/^[a-z0-9_\-:./@]+$/.test(n) && !/[<>{}]/.test(n) && !/^#?[0-9a-f]{6}$/i.test(n) }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else if (/\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/')
const tagName = n => n.tagName.getText()
const isStr = n => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
const unparen = n => { while (n && ts.isParenthesizedExpression(n)) n = n.expression; return n }

function branches(expr) {
  expr = unparen(expr); if (!expr) return []
  if (isStr(expr)) return [expr]
  if (ts.isConditionalExpression(expr)) return [...branches(expr.whenTrue), ...branches(expr.whenFalse)]
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind
    if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) return branches(expr.right)
  }
  return []
}
function hookOwner(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (!(ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p))) continue
    let name = p.name?.text
    if (!name) {
      let q = p.parent
      if (ts.isCallExpression(q)) q = q.parent
      if (q && ts.isVariableDeclaration(q) && ts.isIdentifier(q.name)) name = q.name.text
    }
    if (name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) && p.body && ts.isBlock(p.body) && !(p.modifiers || []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) return p
  }
  return null
}

function processFile(file, manifest) {
  const r = rel(file)
  let text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const first = sf.statements[0]
  const client = !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client'
  const edits = []; const owners = new Set(); let needTx = false, needHook = false
  const eqStrings = new Set()
  ts.forEachChild(sf, function scan(n) {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) { for (const s of [n.left, n.right]) if (isStr(s)) eqStrings.add(norm(s.text)) }
    if (ts.isCaseClause(n) && isStr(n.expression)) eqStrings.add(norm(n.expression.text))
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['includes', 'startsWith', 'endsWith', 'indexOf'].includes(n.expression.name.text) && isStr(n.arguments[0])) eqStrings.add(norm(n.arguments[0].text))
    ts.forEachChild(n, scan)
  })
  const edit = (start, end, t) => edits.push({ start, end, text: t, i: edits.length })
  const useHook = node => {
    if (!client) return false
    const o = hookOwner(node); if (!o) return false
    if (!owners.has(o)) { owners.add(o); if (!o.body.getText().includes('__tx = useTx()')) edit(o.body.getStart() + 1, o.body.getStart() + 1, '\n  const __tx = useTx();') }
    needHook = true; return true
  }
  const inTx = n => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === 'Tx') return true; return false }
  const wrapTx = lit => { edit(lit.getStart(), lit.getEnd(), `<Tx>{${JSON.stringify(norm(lit.text))}}</Tx>`); needTx = true }

  function visit(n) {
    if (ts.isJsxText(n) && !inTx(n)) {
      const parent = n.parent
      const pt = ts.isJsxElement(parent) ? tagName(parent.openingElement) : ''
      if (!NO_TEXT_PARENTS.has(pt)) {
        const raw = n.getText(); const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/); const core = m[2]
        const dec = core && decode(core)
        if (dec && letters(dec) >= 2) {
          const s = norm(dec)
          if (pt === 'option' || pt === 'title') { const sp = n.getStart() + m[1].length; if (useHook(n)) edit(sp, sp + core.length, `{__tx(${JSON.stringify(s)})}`) }
          else { const sp = n.getStart() + m[1].length; edit(sp, sp + core.length, `<Tx>{${JSON.stringify(s)}}</Tx>`); needTx = true }
        }
      }
    }
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && !inTx(n)) {
      const ex = unparen(n.expression)
      const pt = ts.isJsxElement(n.parent) ? tagName(n.parent.openingElement) : ''
      if (!NO_TEXT_PARENTS.has(pt)) {
        const bs = branches(ex).filter(b => looksHuman(b.text))
        if (bs.length && !isStr(ex) || (isStr(ex) && looksHuman(ex.text))) {
          for (const b of (isStr(ex) ? [ex] : bs)) { if (pt === 'option') { if (useHook(b)) edit(b.getStart(), b.getEnd(), `__tx(${JSON.stringify(norm(b.text))})`) } else wrapTx(b) }
        } else if ((ts.isIdentifier(ex) && RENDER_NAMES.has(ex.text)) || (ts.isPropertyAccessExpression(ex) && RENDER_NAMES.has(ex.name.text))) {
          if (pt !== 'option') { edit(n.getStart(), n.getStart(), '<Tx>'); edit(n.getEnd(), n.getEnd(), '</Tx>'); needTx = true }
        }
      }
    }
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(); const el = n.parent.parent; const tn = el.tagName ? el.tagName.getText() : ''
      const upper = /^[A-Z]/.test(tn) || tn.includes('.')
      const init = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer
      const lits = init ? (isStr(init) ? [init] : branches(init)).filter(b => looksHuman(b.text)) : []
      if (lits.length) {
        const rewrite = DOM_ATTRS.has(name) || (!upper && COMPONENT_ATTRS.has(name))
        if (rewrite) {
          if (useHook(n)) for (const b of lits) edit(b.getStart(), b.getEnd(), (init === b && ts.isJsxAttribute(b.parent)) ? `{__tx(${JSON.stringify(norm(b.text))})}` : `__tx(${JSON.stringify(norm(b.text))})`)
        } else if (upper && (COMPONENT_ATTRS.has(name) || DOM_ATTRS.has(name))) for (const b of lits) manifest.add(norm(b.text))
      }
    }
    if (ts.isCallExpression(n) && n.arguments.length >= 1) {
      let callee = n.expression.getText()
      const isCall = CALLS.has(callee) || /^toast(\.(success|error|info|warning|message|loading))?$/.test(callee)
      if (isCall) {
        const a0 = n.arguments[0]
        for (const b of branches(a0)) {
          const s = norm(b.text)
          if (!looksHuman(b.text) || eqStrings.has(s) || !(/\s/.test(s) || /[.!?]$/.test(s))) continue
          if (useHook(n)) edit(b.getStart(), b.getEnd(), `__tx(${JSON.stringify(s)})`)
        }
      }
    }
    if (ts.isPropertyAssignment(n) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && PROP_KEYS.has(n.name.text) && isStr(n.initializer) && looksHuman(n.initializer.text)) manifest.add(norm(n.initializer.text))
    ts.forEachChild(n, visit)
  }
  if (!MANIFEST_ONLY && !SKIP.some(re => re.test(r))) {
    visit(sf)
    if (edits.length) {
      edits.sort((a, b) => b.start - a.start || b.i - a.i)
      // drop overlapping non-insertion edits
      let out = text; let lastStart = Infinity
      for (const e of edits) { if (e.end > lastStart && e.end !== e.start) continue; out = out.slice(0, e.start) + e.text + out.slice(e.end); lastStart = e.start }
      const imports = []
      const hasImp = /from ['"]@\/components\/tx['"]/.test(out)
      const want = [needTx && !/\bTx\b[^\n]*from ['"]@\/components\/tx/.test(out) ? 'Tx' : null, needHook ? 'useTx' : null].filter(Boolean)
      if (want.length && !hasImp) {
        const sf2 = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        let pos = 0; for (const st of sf2.statements) if (ts.isImportDeclaration(st) || (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression))) pos = st.getEnd()
        out = out.slice(0, pos) + `\nimport { ${want.join(', ')} } from '@/components/tx'` + out.slice(pos)
      } else if (want.length && hasImp) {
        out = out.replace(/import \{([^}]*)\} from '@\/components\/tx'/, (m, g) => { const have = g.split(',').map(x => x.trim()).filter(Boolean); for (const w of want) if (!have.includes(w)) have.push(w); return `import { ${have.join(', ')} } from '@/components/tx'` })
      }
      fs.writeFileSync(file, out); text = out
    }
  }
  // pass 2: collect manifest from the final source
  if (SKIP.some(re => re.test(r)) && !/^app\/api\//.test(r)) return
  const sf3 = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  ts.forEachChild(sf3, function col(n) {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'Tx') for (const c of n.children) if (ts.isJsxExpression(c) && c.expression && isStr(c.expression)) manifest.add(norm(c.expression.text))
    if (ts.isCallExpression(n) && n.expression.getText() === '__tx' && isStr(n.arguments[0])) manifest.add(norm(n.arguments[0].text))
    if (ts.isPropertyAssignment(n) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && PROP_KEYS.has(n.name.text) && isStr(n.initializer) && looksHuman(n.initializer.text)) manifest.add(norm(n.initializer.text))
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(); const el = n.parent.parent; const tn = el.tagName ? el.tagName.getText() : ''
      if ((/^[A-Z]/.test(tn) || tn.includes('.')) && (COMPONENT_ATTRS.has(name) || DOM_ATTRS.has(name))) { const init = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer; for (const b of init ? (isStr(init) ? [init] : branches(init)) : []) if (looksHuman(b.text)) manifest.add(norm(b.text)) }
    }
    ts.forEachChild(n, col)
  })
}

function apiStrings(manifest) {
  const files = []; (function w(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (/route\.ts$/.test(e.name)) files.push(p) } })(path.join(ROOT, 'app/api'))
  for (const f of files) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)
    ts.forEachChild(sf, function c(n) {
      if (ts.isPropertyAssignment(n) && n.name && ts.isIdentifier(n.name) && (n.name.text === 'error' || n.name.text === 'message') && isStr(n.initializer) && looksHuman(n.initializer.text) && /\s/.test(n.initializer.text)) manifest.add(norm(n.initializer.text))
      ts.forEachChild(n, c)
    })
  }
}

const manifest = new Set()
const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
let changed = 0
for (const f of files) { const before = fs.readFileSync(f, 'utf8'); processFile(f, manifest); if (fs.readFileSync(f, 'utf8') !== before) changed++ }
apiStrings(manifest)
const list = [...manifest].sort()
fs.writeFileSync(path.join(ROOT, 'lib/i18n/ui-manifest.json'), JSON.stringify(list, null, 1) + '\n')
console.log(`files changed: ${changed}; manifest strings: ${list.length}`)
