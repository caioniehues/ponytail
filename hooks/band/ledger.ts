// The task ledger as text: one CSV per project, one row per task. No I/O and no imports, so the band,
// the import (hooks/ponytail-band-import.js) and pi (pi-extension/ledger.js) write the same rows to the same files.

// A task's numbers as the ledger keeps them. The band's Snapshot is one; the import leaves out what it cannot know.
export type Row = {
  key: string
  started: string
  project: string
  name: string
  // null: the import found no price for the model.
  cost: number | null
  turns: number
  agentMs: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  reuse: number | null
  // null: the import cannot know these.
  reused: number | null
  created: number | null
  callersOpen: number | null
  tests: string
  level: string
  model: string
}

// A task's row in the ledger: the session and when it started (a /clear starts a new one).
// The session's part is its first SESSION characters, then a dash, so sessionOf can cut it back out.
const SESSION = 8
export const taskKey = (session: string, startedAt: number) => `${session.slice(0, SESSION)}-${startedAt}`
const sessionOf = (key: string) => key.slice(0, SESSION + 1)

export const stamp = (ms: number) => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

// Where the ledgers and the board live: XDG_CONFIG_HOME, empty or unset meaning ~/.config.
// shortcut: ~/.config only; Windows would want %APPDATA%.
export const ledgerDir = (xdg: string | undefined, home: string) => `${xdg || `${home}/.config`}/ponytail/band`

// RFC 4180 rows: quoted fields may hold commas, doubled quotes and line breaks.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some(f => f !== '')) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  return rows
}

export const CSV_HEADER = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model'

// shortcut: 32-bit FNV-1a (hooks modules cannot import crypto), hash the root with sha256 if two rewritten names share a file
function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// A name that is already a filename keeps that file, so myapp.csv still loads.
// A name that had to be rewritten gets a short hash of the root so api@shop and api_shop do not share a ledger.
export function ledgerFile(dir: string, project: string, root: string): string {
  const slug = project.replace(/[^\w.-]/g, '_')
  const id = slug === project ? slug : `${slug}_${shortHash(root.replace(/\\/g, '/').replace(/\/+$/, ''))}`
  return `${dir}/${id}.csv`
}

const csvField = (v: string | number | null) => {
  let s = v === null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const totalTokens = (t: Row['tokens']) => t.input + t.output + t.cacheRead + t.cacheWrite

export const csvRow = (s: Row) =>
  [s.key, s.started, s.project, s.name, s.cost === null ? '' : s.cost.toFixed(2), s.turns, (s.agentMs / 60000).toFixed(1), totalTokens(s.tokens), s.tokens.output, s.reuse, s.reused, s.created, s.callersOpen, s.tests, s.level, s.model]
    .map(csvField)
    .join(',')

// One row per task, replaced on every turn, so the file stays a table of tasks.
// Split into records, not lines: a quoted name with a line break spans two lines.
// shortcut: a session two writers date differently (an import, then a band resume) gets two rows; match on sessionOf if one shows up.
export function upsertCsv(existing: string, s: Row): string {
  return [CSV_HEADER, ...keptRows(existing, r => r[0] !== s.key), csvRow(s)].join('\n') + '\n'
}

// The existing rows, re-encoded, under a header that may be older.
const keptRows = (existing: string, keep: (r: string[]) => boolean) =>
  parseCsv(existing)
    .filter(r => r[0] !== 'key' && keep(r))
    .map(r => r.map(csvField).join(','))

export function rowFor(text: string, key: string): Record<string, string> | undefined {
  const [head, ...rows] = parseCsv(text)
  const row = head ? rows.find(r => r[head.indexOf('key')] === key) : undefined
  if (!head || !row) return undefined
  return Object.fromEntries(head.map((col, i) => [col, row[i] ?? '']))
}

export const recordedSessions = (texts: string[]) =>
  new Set(texts.flatMap(t => parseCsv(t).filter(r => r[0] !== 'key').map(r => sessionOf(r[0] ?? ''))))

// The import's rows go in after the ledger's own. A session already recorded (in have, or here) is never added twice:
// by session, not key, since the import dates a session by its transcript and the band by the engine.
export function mergeRows(existing: string, rows: Row[], have = new Set<string>()): { text: string; added: number } {
  const own = recordedSessions([existing])
  const added = rows.filter(r => !have.has(sessionOf(r.key)) && !own.has(sessionOf(r.key)))
  return { text: [CSV_HEADER, ...keptRows(existing, () => true), ...added.map(csvRow)].join('\n') + '\n', added: added.length }
}
