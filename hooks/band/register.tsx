import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { base, boardHtml, tasksFrom } from './board'
import type { Band } from './types'
import type { Col } from './metrics'
import {
  DEF_PATHS,
  GREP_DEFS,
  KIND_COLORS,
  NO_TOKENS,
  addTokens,
  breakdown,
  legendText,
  defsIn,
  elapsed,
  fmtTokens,
  hits,
  ledgerFile,
  mainModel,
  markdown,
  metricsSvg,
  MODEL_PATTERN,
  parseDefs,
  percent,
  resume,
  snapshot,
  sessionTitle,
  taskKey,
  testsLabel,
  TITLE_RECORD,
  toolCalls,
  TOOL_RESULT_RECORD,
  TOOL_USE_RECORD,
  toolsSummary,
  totalTokens,
  upsertCsv,
  webhookRequest,
} from './metrics'

const LEVELS = ['off', 'lite', 'full', 'ultra']
const EMPTY: Band = {
  level: 'off',
  model: '',
  cost: 0,
  spent: 0,
  turns: 0,
  turnCosts: [],
  tokens: NO_TOKENS,
  busyMs: 0,
  name: '',
  project: '',
  session: '',
  transcript: '',
  reused: [],
  created: [],
  removed: [],
  openCallers: [],
  tests: { state: 'none' },
  details: false,
}
// The counters of one task: what a new session or /clear starts over.
const TASK = {
  spent: 0,
  turns: 0,
  turnCosts: [],
  tokens: NO_TOKENS,
  busyMs: 0,
  name: '',
  model: '',
  reused: [],
  created: [],
  removed: [],
  openCallers: [],
  tests: { state: 'none' as const },
}
const band = atom({ plugin: 'ponytail', key: 'band' } as const, EMPTY)
// State kept from an older version of the band lacks newer fields.
const load = async ($: EngineInterface): Promise<Band> => ({ ...EMPTY, ...(await read($, band)) })


// Windows sets USERPROFILE, not HOME.
const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
const claudeDir = async ($: EngineInterface) => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await home($)}/.claude`

// `/ponytail band` (the mode tracker) leaves "off" here to hide the band. Absent flag = shown.
async function bandHidden($: EngineInterface): Promise<boolean> {
  try {
    return (await $.fs.read(`${await claudeDir($)}/.ponytail-band`)).trim() === 'off'
  } catch {
    return false
  }
}

// The level ponytail's own hooks write. Absent flag = off.
// shortcut: the shared flag the statusline reads, so two sessions in different repos show the last switch; read the per-project flag if that matters.
async function readLevel($: EngineInterface): Promise<string> {
  const dir = await claudeDir($)
  try {
    const level = (await $.fs.read(`${dir}/.ponytail-active`)).trim()
    return LEVELS.includes(level) ? level : 'off'
  } catch {
    // Only the node hooks write the flag, so without node an absent flag is not a deliberate /ponytail off (#1280).
    const node = await $.process.run(['node', '--version']).catch(() => undefined)
    return node?.exitCode === 0 ? 'off' : 'no node'
  }
}

// The same commands a person types, so ponytail's own skills and hooks stay the only logic.
const run = ($: EngineInterface, command: string, args = '') => $.command.run({ command, args })

type Options = { readonly [field: string]: unknown }

// The lines of a transcript grep keeps, or the whole file without grep; undefined when neither can read it.
// grep, because $.fs.read refuses files over 4 MiB and transcripts grow past that.
// shortcut: without grep (Windows) only a transcript under 4 MiB is read; findstr would lift that.
async function grepOrRead($: EngineInterface, args: string[], file: string): Promise<string | undefined> {
  const grep = await $.process.run(['grep', ...args, file]).catch(() => undefined)
  return grep !== undefined && grep.exitCode <= 1 ? grep.stdout : await $.fs.read(file).catch(() => undefined)
}

// The session's sidebar name.
async function readTitle($: EngineInterface, transcript: string): Promise<string | undefined> {
  if (transcript === '') return undefined
  return sessionTitle((await grepOrRead($, ['-F', TITLE_RECORD], transcript)) ?? '')
}

// The model that wrote most of the session's replies, so the board can tell models apart.
async function readModel($: EngineInterface, transcript: string): Promise<string> {
  if (transcript === '') return ''
  return mainModel((await grepOrRead($, ['-o', MODEL_PATTERN], transcript)) ?? '')
}

// Every tool call the session made, which toolsSummary folds into the band: the tests they ran, the definitions they
// wrote, the known names they call. From the transcripts, the session's and each subagent's beside it (<session>/subagents/*.jsonl), not a tool.call
// hook: see docs/adr/0001-band-reads-tool-calls-from-the-transcript.md.
// shortcut: replays every tool call each turn, so a long session re-reads itself; a saved byte offset would lift that.
async function readCalls($: EngineInterface, transcript: string) {
  if (transcript === '') return undefined
  const read = (file: string) => grepOrRead($, ['-F', '-e', TOOL_USE_RECORD, '-e', TOOL_RESULT_RECORD], file)
  const text = await read(transcript)
  if (text === undefined) return undefined
  const dir = `${transcript.replace(/\.jsonl$/, '')}/subagents`
  const agents = (await $.fs.list(dir).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
  const theirs = await Promise.all(agents.map(f => read(`${dir}/${f.name}`)))
  return toolCalls([text, ...theirs.filter(t => t !== undefined)].join('\n'))
}

// Where Claude Code keeps the session's transcript: on managed, Team and Enterprise machines its cc-plugin-sec-default skips every classic.* hook, so no hook hands the path over.
// First the folder its rule names, then every project folder: it hashes names past 200 characters, and /cd, worktrees and /resume can put the file elsewhere.
// shortcut: with persistence off there is no file, so every turn checks every folder, read the path from the engine once it offers one.
async function findTranscript($: EngineInterface, session: string): Promise<string> {
  const projects = `${await claudeDir($)}/projects`
  const exists = (file: string) => $.fs.exists(file).catch(() => false)
  const root = await $.session.root().catch(() => '')
  const named = `${projects}/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${session}.jsonl`
  if (root !== '' && (await exists(named))) return named
  const dirs = (await $.fs.list(projects).catch(() => [])).filter(d => d.kind === 'dir')
  // One at a time: thousands of checks in flight at once are slower than in turn.
  for (const dir of dirs) {
    const file = `${projects}/${dir.name}/${session}.jsonl`
    if (await exists(file)) return file
  }
  return ''
}

// Where the task ledgers and the board live.
// shortcut: ~/.config only (XDG respected); Windows would want %APPDATA%.
async function ledgerDir($: EngineInterface) {
  return `${(await $.env.get('XDG_CONFIG_HOME')) ?? `${await home($)}/.config`}/ponytail/band`
}

// After every turn: the task's row in a CSV per project, and the same row to a webhook if one is set.
async function record($: EngineInterface, b: Band, options: Options) {
  const startedAt = (await $.session.usage()).startedAt
  const row = snapshot(b, startedAt)
  if (options.ledger !== false && b.project !== '') {
    const dir = await ledgerDir($)
    const root = (await $.session.repo().catch(() => null))?.root ?? (await $.session.cwd())
    const file = ledgerFile(dir, b.project, root)
    const existing = await $.fs.read(file).catch(() => '')
    const fresh = !(await $.fs.exists(dir).catch(() => false))
    // $.fs.write creates the directory: no mkdir, which Windows does not have.
    await $.fs.write(file, upsertCsv(existing, row))
    // $.fs.write takes no mode, so a directory made just now is locked to the user once.
    if (fresh && (await $.env.get('OS')) !== 'Windows_NT') await $.process.run(['chmod', '700', dir]).catch(() => {})
    // The board is a plain file a refresh rereads, so it is rebuilt with every row.
    await writeBoard($, dir)
  }
  const url = typeof options.webhookUrl === 'string' ? options.webhookUrl.trim() : ''
  if (url !== '') {
    const token = typeof options.webhookToken === 'string' ? options.webhookToken.trim() : ''
    const request = webhookRequest(url, token, options.sendNames === true, row)
    if ('refused' in request) {
      $.ui.status(`ponytail band: ${request.refused}`)
      return
    }
    // Not awaited: a slow endpoint must never hold up the turn.
    void $.http
      .fetch(request.url, request.init)
      .then(r => $.ui.status(r.ok ? undefined : `ponytail band: webhook answered ${r.status}`))
      .catch(() => $.ui.status('ponytail band: webhook unreachable'))
  }
}

// Builds board.html from every project's ledger.
async function writeBoard($: EngineInterface, dir: string) {
  const entries = await $.fs.list(dir).catch(() => [])
  const texts = await Promise.all(entries.filter(f => f.kind === 'file' && f.name.endsWith('.csv')).map(f => $.fs.read(`${dir}/${f.name}`).catch(() => '')))
  const file = `${dir}/board.html`
  // The folder found under its upper-case name: a file system that ignores case (Windows, macOS by default).
  // dir is always ledgerDir(), which ends in lower-case /ponytail/band, so the upper-case name is another path.
  const ignoreCase = await $.fs.exists(dir.toUpperCase()).catch(() => false)
  await $.fs.write(file, boardHtml(texts.flatMap(tasksFrom), await $.clock.now(), ignoreCase))
  return file
}

// Builds the board fresh and opens it in the browser.
async function openBoard($: EngineInterface) {
  const file = await writeBoard($, await ledgerDir($))
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  const mac = !windows && (await $.process.run(['uname'])).stdout.trim() === 'Darwin'
  await $.process.run(windows ? ['cmd', '/c', 'start', '', file] : [mac ? 'open' : 'xdg-open', file])
}

// The definitions that exist now: what new code can reuse.
async function definitions($: EngineInterface): Promise<Map<string, string>> {
  const grep = await $.process.run(['git', 'grep', '-I', '--untracked', '-nE', GREP_DEFS, '--', ...DEF_PATHS]).catch(() => undefined)
  return grep?.exitCode === 0 ? parseDefs(grep.stdout) : new Map()
}

// Sets the band up for a session (level, project, task row, cost baseline); returns the definitions that exist now,
// or none while the band is hidden: the first turn it is shown searches for them.
async function start($: EngineInterface): Promise<Map<string, string> | undefined> {
  const hidden = await bandHidden($)
  const known = hidden ? undefined : await definitions($)
  const level = await readLevel($)
  const details = (await $.store.get('details')) === true
  const repo = await $.session.repo().catch(() => null)
  const root = repo?.root ?? (await $.session.cwd())
  const project = base(root)
  const session = await $.session.id()
  // The cost so far is the baseline for the last turn's own cost.
  const usage = await $.session.usage().catch(() => undefined)
  const csv = usage ? await $.fs.read(ledgerFile(await ledgerDir($), project, root)).catch(() => '') : ''
  const key = usage ? taskKey(session, usage.startedAt) : ''
  // Another session (/resume, /branch) starts its own counters; its row brings back what it had.
  await update($, band, b => resume({ ...EMPTY, ...(b.session === session ? b : { ...b, ...TASK }), level, details, project, session, cost: usage?.cost?.usd ?? b.cost }, csv, key))
  return known
}

export const register: Register = (on, options) => {
  // Definitions that existed when the session started: what new code can reuse. Unset while the band was hidden.
  let known: Map<string, string> | undefined

  on('session.start', async ($, e, next) => {
    known = await start($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // /clear, /resume and /branch go on under another session id with an empty band and no session.start, so the band
  // showed "off" until the first turn ended. Set it up again once one of them has moved the session.
  // Only these commands: the engine labels a command's output with every plugin its hook chain ran through, so a hook on
  // every command printed "ponytail+<plugin>:" before other plugins' commands.
  // shortcut: after /clear, ponytail-activate.js may reset the flag to the default level after this, so a level switched
  // before /clear can show until the first turn ends; a session skips a plugin's classic.SessionStart hook, the one later point.
  on('command.run', { command: ['clear', 'resume', 'branch'] }, async ($, e, next) => {
    const session = await $.session.id()
    const result = await next(e)
    if ((await $.session.id()) !== session) known = await start($).catch(() => known)
    return result
  }).catch(($, e, next) => next(e))

  // /clear starts a new task: the counters start over, the cost baseline stays.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, band, b => ({ ...EMPTY, ...b, ...TASK }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // The first prompt names the task until the session has a sidebar name.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (e.origin.kind !== 'plugin' && text !== '' && !text.startsWith('/')) {
      const name = [...(text.split(/\r?\n/)[0] ?? '')].slice(0, 60).join('')
      await update($, band, b => (b.name === '' ? { ...EMPTY, ...b, name } : b))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const used = e.usage
    if (e.agentId !== undefined) {
      // A subagent's tokens count; its cost is already in the session cost the main turn reads.
      if (used) await update($, band, b => ({ ...EMPTY, ...b, tokens: addTokens(b.tokens ?? NO_TOKENS, used) }))
      return next(e)
    }

    const usage = await $.session.usage()
    const turns = await $.session.turns()
    const level = await readLevel($)
    // What every turn adds, shown or hidden: tokens and agent time are summed per turn, so a turn left out is lost.
    const totals = (b: Band) => {
      const cost = usage.cost?.usd ?? b.cost
      // A cost below the baseline means the engine started its ledger over.
      const turn = cost >= b.cost ? cost - b.cost : cost
      return {
        level,
        cost,
        // Each turn adds its own cost. Not the engine's total: it goes on across /clear and starts over in a new process.
        spent: b.spent + turn,
        turns,
        turnCosts: [...b.turnCosts, turn].slice(-20),
        tokens: used ? addTokens(b.tokens, used) : b.tokens,
        busyMs: b.busyMs + e.durationMs,
      }
    }
    // Hidden, the band keeps only its totals: no transcript reads, no searches, no ledger row.
    if (await bandHidden($)) {
      await update($, band, x => {
        const b = { ...EMPTY, ...x }
        return { ...b, ...totals(b) }
      })
      return next(e)
    }
    const { removed: stored, transcript: saved } = await load($)
    const session = await $.session.id()
    // Here, not at start: the first turn writes the file, and a new id (/clear, /resume) or a move (/cd, a worktree) changes it.
    const kept = base(saved) === `${session}.jsonl` && (await $.fs.exists(saved).catch(() => false))
    const transcript = kept ? saved : await findTranscript($, session)
    const title = await readTitle($, transcript)
    const model = await readModel($, transcript)
    const calls = await readCalls($, transcript)
    const root = (await $.session.repo().catch(() => null))?.root ?? (await $.session.cwd())
    if (known === undefined) {
      // The start-up search a hidden band skipped runs at its first shown turn. What the task wrote while hidden is in
      // the tree by now: it is the task's own, so new code calling it is not reuse.
      // shortcut: the tree as it is when shown, so code changed outside tool calls while hidden (a pull, a checkout) counts as there before, and a name the task created hides an older one of that name elsewhere; key known by file too if that bites.
      const created = calls === undefined ? [] : toolsSummary(calls, root, new Map()).created
      known = new Map([...(await definitions($))].filter(([name]) => !created.includes(name)))
    }
    const tools = calls === undefined ? undefined : toolsSummary(calls, root, known)
    const removed = tools?.removed ?? stored

    // A removed or renamed definition that is not defined again but still called somewhere.
    // shortcut: name match with git grep, so a same-named call in another module counts too.
    const stillRemoved: string[] = []
    const open: string[] = []
    // One search for every name: a search each walked the repo once more on every turn, for every name the session removed.
    // shortcut: one -e per removed name, so argv grows with the session's removals (Windows caps a command line at 32K chars); feed the names on stdin with -f - if a session ever removes thousands.
    const grep = removed.length === 0 ? undefined : await $.process.run(['git', 'grep', '-I', '--untracked', '-nw', ...removed.flatMap(name => ['-e', name])]).catch(() => undefined)
    // The checks below each look for one name, so a row another name found never counts for it.
    const rows = hits(grep?.stdout ?? '')
    for (const name of removed) {
      if (rows.some(r => defsIn(r.file, r.text.trimStart()).includes(name))) continue
      const call = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`)
      const refs = rows.filter(r => call.test(r.text)).map(r => `${r.file}:${r.line}`)
      if (refs.length > 0) {
        stillRemoved.push(name)
        open.push(...refs)
      }
    }

    const b = await update($, band, x => {
      const b = { ...EMPTY, ...x }
      return {
        ...b,
        ...tools,
        ...totals(b),
        transcript,
        name: title ?? b.name,
        model: model || b.model,
        removed: stillRemoved,
        openCallers: open,
      }
    })
    await record($, b, options).catch(() => $.ui.status('ponytail band: could not write the task ledger'))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await bandHidden($))) return next(e)
    // Other mods share this slot: draw theirs below ours instead of replacing it.
    // Beneath is another mod or Claude Code's own content (from 2.1.321 the test harness hands back the engine's too).
    // next(e) rejects only when nothing answers beneath (the harness up to 2.1.319): the band still draws.
    const below = await next(e).catch(() => undefined)

    const b = await load($)
    const now = await $.clock.now()
    const startedAt = (await $.session.usage().catch(() => undefined))?.startedAt ?? now
    const reuse = percent(b.reused.length, b.created.length)
    const avg = b.turns > 0 ? b.spent / b.turns : 0
    const last = b.turnCosts[b.turnCosts.length - 1]
    // shortcut: a band resumed from the ledger books cache reads as input (see resume), so the rate reads low until /clear; upgrade once the ledger keeps the cache columns.
    const cacheHit = percent(b.tokens.cacheRead, b.tokens.input + b.tokens.cacheWrite)

    const setLevel = async (level: string) => {
      await update($, band, x => ({ ...x, level }))
      await run($, 'ponytail:ponytail', level)
    }
    const toggle = async () => {
      await update($, band, x => ({ ...x, details: !x.details }))
      await $.store.set('details', !b.details)
    }
    const review = () => run($, 'ponytail:ponytail-review')
    const audit = () => run($, 'ponytail:ponytail-audit')
    const board = () => openBoard($).catch(() => $.ui.toast('ponytail band: could not open the board'))
    const copy = async () => {
      const done = await $.ui.copy({ text: markdown(snapshot(await load($), startedAt)), surface: e.surface })
      $.ui.toast(done.isCopied ? 'Task copied as Markdown' : `Copy failed: ${done.reason}`)
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    // bodyColumns counts terminal cells; a graphical surface draws Buttons wider than their cells, so a row sized to it wraps there.
    const width = e.surface === 'terminal' ? e.props.bodyColumns : undefined
    const stack =(mine: NonNullable<typeof below>) => (below ? <Box flexDirection="column">{mine}{below}</Box> : mine)

    const testsText =
      b.tests.state === 'pass'
        ? `✓ ${b.tests.passed ?? ''} tests`
        : b.tests.state === 'fail'
          ? `✗ ${b.tests.failed ?? ''} failed`
          : b.tests.state === 'stale'
            ? 'no test since change'
            : ''
    const testsColor = b.tests.state === 'pass' ? 'success' : b.tests.state === 'fail' ? 'error' : undefined
    const hasOpen = b.openCallers.length > 0

    if (!b.details) {
      return stack(
        <Box key="band" flexDirection="row" alignItems="center" gap={2} width={width}>
          {/* A click opens the four levels: one click, one turn, no stops on levels nobody wanted. */}
          {/* Button takes one string label (engine 2.1.292 refuses Text children), so the dot sits beside it. */}
          <Text color={b.level === 'off' ? 'inactive' : b.level === 'no node' ? 'warning' : 'suggestion'}>●</Text>
          <Button key="level" plain label={b.level} onPress={toggle} />
          <Text>${b.spent.toFixed(2)}</Text>
          {last !== undefined && <Text dimColor>last ${last.toFixed(2)}</Text>}
          <Text dimColor>{elapsed(b.busyMs)}</Text>
          {reuse !== undefined && <Text>{reuse}% reuse</Text>}
          {cacheHit !== undefined && <Text dimColor>{cacheHit}% cache</Text>}
          {hasOpen && <Text color="warning">⚠ {b.openCallers.length} callers open</Text>}
          {testsText !== '' && (
            <Text color={testsColor} dimColor={b.tests.state === 'stale'}>
              {testsText}
            </Text>
          )}
          <Box flexGrow={1} />
          <Button key="review" plain label="Review" onPress={review} />
          <Button key="audit" plain label="Audit" onPress={audit} />
          <Button key="board" plain label="Board" onPress={board} />
          <Button key="details" plain label="Details" onPress={toggle} />
        </Box>
      )
    }

    // The cost and token cells split by token type, one color each, named in the legend row.
    // shortcut: a band resumed from the ledger books all but output as input (see resume), so its split is wrong until /clear; store the split in the ledger if that bites.
    const parts = breakdown(b.tokens, b.spent)
    const tokenTotal = totalTokens(b.tokens)
    const legend = tokenTotal > 0 ? parts.map(legendText) : []

    // Only columns that say something; callers and tests appear once there is something to report.
    const cols: Col[] = [
      {
        key: 'cost',
        label: 'cost',
        value: `$${b.spent.toFixed(2)}`,
        sub: last === undefined ? '' : `last $${last.toFixed(2)} · ⌀ $${avg.toFixed(2)}`,
        ...(b.spent > 0 && tokenTotal > 0 ? { split: parts.map(p => p.usd / b.spent) } : {}),
      },
      {
        key: 'tokens',
        label: 'tokens',
        value: fmtTokens(tokenTotal),
        sub: `${b.turns} ${b.turns === 1 ? 'turn' : 'turns'}`,
        ...(tokenTotal > 0 ? { split: parts.map(p => p.tokens / tokenTotal) } : {}),
      },
      { key: 'time', label: 'agent time', value: elapsed(b.busyMs), sub: b.turns > 0 ? `⌀ ${elapsed(b.busyMs / b.turns)} / turn` : '' },
    ]
    if (reuse !== undefined) cols.push({ key: 'reuse', label: 'reuse', value: `${reuse}%`, sub: '' })
    if (hasOpen) {
      cols.push({ key: 'callers', label: 'callers', value: `${b.openCallers.length} open`, sub: b.openCallers.slice(0, 2).join(', '), tone: 'warning' })
    }
    if (b.tests.state !== 'none') {
      cols.push({
        key: 'tests',
        label: 'tests',
        value: testsLabel(b.tests),
        sub: b.tests.state === 'pass' ? 'after last change' : b.tests.state === 'fail' ? 'last run' : 'code changed since',
        tone: b.tests.state === 'pass' ? 'success' : b.tests.state === 'fail' ? 'error' : undefined,
      })
    }

    let metrics = (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(e.props.bodyColumns)}
        </Text>
        <Box flexDirection="row" gap={2}>
          {cols.map(c => {
            // Off the terminal the columns share the row; a width in cells would leave most of it empty and cut the text.
            const colCells = width === undefined ? 20 : Math.max(10, Math.floor(width / cols.length) - 2)
            return (
              <Box key={c.key} flexDirection="column" {...(width === undefined ? { flexGrow: 1 } : { width: colCells })}>
                <Text dimColor>{c.label}</Text>
                <Text bold color={c.tone}>
                  {c.value}
                </Text>
                {c.split && (
                  <Box flexDirection="row">
                    {c.split.map((f, k) => (
                      <Box key={`bar-${c.key}-${k}`}>
                        <Text color={KIND_COLORS[k]}>{'█'.repeat(Math.round(f * (colCells - 2)))}</Text>
                      </Box>
                    ))}
                  </Box>
                )}
                <Text dimColor wrap="truncate-end">
                  {c.sub}
                </Text>
              </Box>
            )
          })}
        </Box>
        {legend.length > 0 && (
          <Text dimColor wrap="truncate-end">
            {'─'.repeat(e.props.bodyColumns)}
          </Text>
        )}
        {legend.length > 0 && (
          <Box flexDirection="row" gap={2}>
            {legend.map((text, k) => (
              <Box key={`legend-${k}`} flexDirection="row" gap={1}>
                <Text color={KIND_COLORS[k]}>■</Text>
                <Text dimColor>{text}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
    // Text glyphs make broken lines in the desktop's proportional font; an SVG draws real ones.
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const alt = [...cols.map(c => `${c.label} ${c.value}`), ...legend].join(', ')
      metrics = <Svg source={metricsSvg(cols, b.turnCosts, 720, legend)} alt={alt} />
    }

    return stack(
      // The desktop's SVG draws its own line at the top, which would touch the buttons without the gap.
      <Box key="band" flexDirection="column" width={width} gap={e.surface === 'desktop' ? 1 : 0}>
        {/* Mode, its levels, a dot, the actions: one airy line. columnGap alone, so a wrap adds no empty rows. */}
        <Box flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap">
          <Text dimColor>Mode</Text>
          {LEVELS.map(level => (
            <Button
              key={`level-${level}`}
              label={level}
              {...(level === b.level ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })}
              onPress={() => setLevel(level)}
            />
          ))}
          <Text dimColor>·</Text>
          <Button key="copy" plain label="Copy" onPress={copy} />
          <Button key="review" plain label="Review" onPress={review} />
          <Button key="audit" plain label="Audit" onPress={audit} />
          <Button key="board" plain label="Board" onPress={board} />
          <Button key="details" plain label="Compact" onPress={toggle} />
        </Box>
        {metrics}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
