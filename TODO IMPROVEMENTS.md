# TODO IMPROVEMENTS

> Last updated: 2026-09-23

## Pending Changes

### npm audit: fastify / fast-uri advisories (transitive)
- **Category:** Dependency
- **Source:** `npm audit`, 2026-09-12
- **What:** `fastify@5.11.3` has 2 moderate advisories (schema validation bypass via root primitive coercion mismatch, X-Forwarded-* spoofing under trustProxy hop-count). Its transitive `fast-uri` (via `@fastify/ajv-compiler`/`ajv`) has several high SSRF/host-confusion advisories in URI parsing. `npm audit fix` resolves both by bumping `fastify` within its `^5.0.0` range.
- **Where:** `package.json` (`fastify` dependency), `node_modules/fastify`, `node_modules/**/fast-uri` (transitive)
- **Why:** Neither looks practically exploitable here: RigDeck doesn't set `trustProxy` (X-Forwarded spoofing needs it) and doesn't declare any Fastify route `schema` (see the schema-validation TODO below), so the AJV/fast-uri URI-parsing path they patch isn't in RigDeck's request path today. Still flagging per the "do not upgrade dependencies" instruction for this pass rather than running `npm audit fix` unreviewed.
- **Risk:** Low actual exposure given current usage; low-risk fix (`npm audit fix`, no major bump) once someone signs off.
- **Effort:** Low

### No CI workflow
- **Category:** Refactor
- **Source:** repo read — `.github/` only contains `screenshot.jpg`, no `.github/workflows/`
- **What:** `npm test` and `npm run typecheck` both pass cleanly and cheaply (~2-3s), but nothing runs them automatically on push/PR. CONTRIBUTING.md asks contributors to "run `npm test` before pushing" on the honor system only.
- **Where:** `.github/workflows/` (missing)
- **Why:** Adding a GitHub Actions workflow is infra, not a drive-by fix — wanted a human call on runner OS. The app itself is Windows-only (Win32 API via PowerShell), but the test suite's assertions didn't look OS-specific on read; that needs confirming on an actual Linux/`windows-latest` runner before picking one, not assumed.
- **Risk:** None to existing behavior; just automation scope creep for a "safe changes only" pass.
- **Effort:** Low

### Orphaned PowerShell child process on dev-server restart
- **Category:** Bug
- **Source:** code read, src/lib/audio.ts:143-171
- **What:** `startMeterStream()` spawns a resident `powershell.exe audio-meters-stream.ps1` process while the audio mixer's VU meter is subscribed. It's only killed via `subscribeMeters()`'s returned unsubscribe (SSE `close`/`error`) or when the process exits on its own. There's no `process.on('SIGINT'/'SIGTERM', ...)` handler in `src/server.ts` to kill it on shutdown.
- **Where:** `src/lib/audio.ts:136-171`, `src/server.ts` (no shutdown hook currently)
- **Why:** `npm run dev` (tsx watch) sends a programmatic SIGTERM to the old process on file change, not a console Ctrl+C — child processes in a different process group don't get that signal automatically. If the mixer was open when a dev restart happens, the old `powershell.exe` can be left running indefinitely.
- **Risk:** Low blast radius (dev-only edge case, self-limiting since ref-count means at most one leaked process per restart-while-mixer-open), but a graceful-shutdown handler touches process lifecycle — wanted a human call on whether to add `app.close()` + explicit `meterProcess?.kill()` on SIGINT/SIGTERM, or leave as is since it's dev-only.
- **Effort:** Low

### No Fastify route schema validation
- **Category:** Refactor
- **Source:** web research — Fastify 5 best practices (AJV-based route schemas are the framework's core perf/safety feature; RigDeck's routes validate manually and inline instead)
- **What:** None of the routes in `src/server.ts` declare a Fastify `schema` (body/querystring/params JSON Schema). Validation is done ad hoc per-handler (e.g. `fsFolderPathError`, manual `if (!name)` checks). Fastify's AJV-based schema validation would reject malformed bodies before the handler runs, and is also faster (fast-json-stringify for responses).
- **Where:** `src/server.ts` (all ~30 routes)
- **Why:** Touches the public contract of every route (error shape/timing changes on invalid input) — worth doing deliberately, not as a drive-by edit, and the project's stated minimalist philosophy ("sem abstração que o projeto não precisa") means this may not be worth the added schema boilerplate for a single-user local tool. Flagging as a considered option, not a recommendation.
- **Risk:** Behavior change on every route; medium effort for the payoff on a trusted-network single-user tool.
- **Effort:** High

### Dependency updates available
- **Category:** Dependency
- **Source:** `npm outdated`
- **What:** `tsx` 4.23.11 → 4.23.12 (patch, safe). `typescript` 5.9.3 → latest is 7.0.2 (major jump — TS went to a new major versioning scheme; needs a compat check before bumping, not a drop-in). `@types/node` 22.20.1 → latest 26.2.0 (major, should track the `engines.node >=20` constraint rather than jumping straight to latest types).
- **Where:** `package.json`
- **Why:** `npm audit` shows 0 vulnerabilities, so this is routine hygiene, not urgent. TypeScript's major bump in particular needs a manual look at breaking changes before touching `tsconfig.json`.
- **Risk:** Low for the tsx patch; unknown for the two major bumps until changelogs are checked.
- **Effort:** Low (tsx) / Medium (typescript, @types/node)

## Notes

Baseline before this cycle: `npm run typecheck` clean, `npm test` 73/73 passing, `npm audit` 0 vulnerabilities. Codebase is unusually well-documented (rationale comments on nearly every non-obvious decision) and defensive already — most of the obvious "safe fix" categories (dead code, missing tests on pure functions, a11y gaps) came up empty on this pass. No safe changes were applied this cycle; everything found needed a judgment call, so it's queued above instead.

### 2026-09-12 pass

Found the working tree already carrying an uncommitted, functionally-complete feature (long-press-to-kill on file-browser tiles: `public/grid.js`, `src/lib/executor.ts` `killByPath`, `src/server.ts` `POST /api/fs/kill`) — left it as-is (not mine to add or revert per this pass's scope) but added the missing test coverage for it, since that part was a shipped-but-untested code path:
- `test/executor.test.ts`: unit test for `killByPath`'s non-`.exe` branch (pure, no process spawned).
- `test/server.test.ts`: `POST /api/fs/kill` 400-without-path and ok:false-for-non-.exe-target cases, mirroring the existing `/api/fs/open` test's pattern of only covering the side-effect-free branches.

Also found both READMEs (`README.md`, `README.pt-BR.md`) undocumented for 2 of the 5 `PresetStep` types (`sound`, `obs` — only `launch`/`cmd`/`key` were described) and missing the audio mixer, OBS control, and file-folder browsing entirely from the Features list, despite all three being shipped and tested. Fixed both files' step-type and Features sections to match `src/types.ts` and the actual `public/*.js` modules.

`npm audit` now shows 2 vulnerabilities (0 at the last pass) — queued above rather than fixed, since fixing means bumping `fastify` and this pass's scope excludes dependency upgrades.

Baseline after this cycle: `npm run typecheck` clean, `npm test` 76/76 passing (73 + 3 new).

### 2026-09-23 pass (3 cycles, Claude usage-tiles feature review)

Target this pass was the Claude 5h/weekly usage tiles feature shipped earlier
in the same session (`src/lib/stats.ts`, `public/status.js`, `public/editor.js`,
`public/state.js`) — new code from this session, not yet reviewed by this
skill. Researched locally (read the claude-hud plugin source on disk for the
`usage-snapshot.json` schema) instead of web search, since the exact source
was available and more precise than a search result.

**Cycle 1 — correctness/testability:**
- `src/lib/stats.ts`: extracted `isSnapshotStale(updatedAtMs, nowMs)` as an
  exported pure function out of `getClaudeSessionStats` (same pattern as the
  existing `cpuPercentFromSamples`) so the 15-minute staleness boundary is
  unit-testable without depending on the real clock or a snapshot file on disk.
- `test/stats.test.ts`: added 4 tests for `isSnapshotStale` — fresh, just past
  the boundary, exactly at the boundary (inclusive), and future timestamp
  (clock skew) treated as stale.
- `public/editor.js`: null-guard on `document.getElementById('stat-toggle-...')`
  in the CONFIG-panel wiring loop, so a future `STAT_KEYS` entry without a
  matching checkbox in `index.html` fails silently instead of throwing.
- `public/style.css`: `.stats:empty { display: none }` — if the user unchecks
  every stat tile, the bar no longer leaves an empty padded strip.

**Cycle 2 — docs (UX/PO: shipped-but-undocumented feature, same pattern as the
2026-09-12 pass):**
- `README.md`, `README.pt-BR.md`: "Live stats" bullet now mentions the Claude
  usage tiles and the CONFIG-panel picker; the `stats.ts` line in the repo-tree
  comment updated to say what it now covers.
- `CHANGELOG.md`: added an `[Unreleased] / Added` entry for both the usage
  tiles and the visibility picker (file was empty under `[Unreleased]`).

**Cycle 3 — UX (dead-option cleanup):**
- `public/status.js`: added `hasClaudeData()` (true once `/api/stats` has
  returned a non-null `claude` field at least once).
- `public/editor.js`: CONFIG panel now hides the "Claude 5h" / "Claude
  semanal" checkboxes when the user has no claude-hud snapshot at all,
  re-checked every time the panel opens — a user without claude-hud installed
  was previously shown two checkboxes that could never do anything.

Nothing sensitive surfaced on this target — no new entries added to the
Pending Changes list above (all queued items are unchanged from 2026-09-12).

Baseline after this pass: `npm run typecheck` clean, `npm test` 81/81 passing
(77 + 4 new). All changes above are uncommitted per this skill's rule.
