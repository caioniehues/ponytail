// Driving a band turn from a test: the session, the band flag, a transcript per session and the greps, mocked,
// with every command and write the band makes recorded. A new case adds a `state` field, not new mocks.

import type { On } from 'claude-code'

import { BAND_SESSION } from './band-session'

import { parseCsv } from '../../hooks/band/board'
import { TITLE_RECORD, TOOL_RESULT_RECORD, TOOL_USE_RECORD } from '../../hooks/band/metrics'

// A mocked process.run answer.
export const ran = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// A band test's session: the band flag, a transcript per session, and every command and write the band makes.
// ledger: the ledger folder exists already. title: the session's sidebar name in its transcript.
export function bandSession(on: On, state: { hidden: boolean; usd: number; calls?: string; defs?: string; ledger?: boolean; title?: string }) {
  let session = 's1'
  const transcript = () => `/home/u/.claude/projects/-repo/${session}.jsonl`
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', ($, e) => (e.path.replaceAll('\\', '/').endsWith('/home/u/.claude/.ponytail-band') && state.hidden ? { value: 'off' } : { deny: 'missing' }) as never)
  on('session.repo', () => ({ value: { root: '/repo' } }) as never)
  on('session.root', () => ({ value: '-repo' }))
  on('session.id', () => ({ value: session }))
  on('session.turns', () => ({ value: 1 }))
  on('session.usage', () => ({ value: { startedAt: 0, cost: { usd: state.usd } } }) as never)
  on('fs.exists', ($, e) => ({ value: e.path === transcript() || (state.ledger === true && e.path.endsWith('/.config/ponytail/band')) }))
  on('fs.list', () => ({ value: [] }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', ($, e) => {
    writes.push({ path: e.path.replace(/\\/g, '/'), text: e.text })
    return { value: undefined }
  })
  // The fixture's tool calls: an Edit that removes `legacy`, so a shown turn searches for its callers.
  const toolLines = BAND_SESSION.split('\n').filter(line => line.includes(TOOL_USE_RECORD) || line.includes(TOOL_RESULT_RECORD)).join('\n')
  const runs: string[][] = []
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    if (e.argv.includes(TITLE_RECORD) && state.title !== undefined) return ran(0, JSON.stringify({ type: 'custom-title', customTitle: state.title })) as never
    if (e.argv.includes(TOOL_USE_RECORD)) return ran(0, state.calls ?? toolLines) as never
    return (e.argv.includes('-nE') && state.defs !== undefined ? ran(0, state.defs) : ran(1)) as never
  })
  on('command.run', () => {
    session = 's2'
    return { text: '' }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  const searches = () => runs.filter(argv => argv[0] === 'git' || argv[0] === 'grep')
  return { runs, searches, writes }
}

// A field of the last ledger row a turn wrote.
export function ledgerField(writes: { path: string; text: string }[]) {
  const [header, row] = parseCsv(writes.filter(w => w.path.endsWith('/repo.csv')).at(-1)?.text ?? '')
  return (name: string) => row?.[header?.indexOf(name) ?? -1]
}
