# Companion push: direction and slice contracts

Status: **direction set 2026-11-11 by the owner; contracts written by the coordinating session.**
Baseline: main `d905cab`. Tracker: #195. This file is the brief for the implementing sessions.
It states goals, seams, limits and proof. It does not prescribe code. Where it conflicts with an
older design note, this file wins for the items in "Boundary changes" and nowhere else.

## Owner direction

Make MDviewer the best local Markdown viewer for Windows, for someone who works with Markdown all
day in agentic development: open instantly, copy parts, change text and see it at once, keep track
of files across projects, and replace Notepad for quick notes. Simple first; every extra part
expands on demand. A companion that is always there and makes agent-written Markdown easy to see.

## What the review found (first-hand, main `d905cab`)

1. **Opening is not instant.** The reader shows an empty card and "Opening…" until Shiki and
   Mermaid settle, because `src/desktop/render.ts` awaits everything before the first paint.
2. **Front matter is not understood.** Nothing in `src/render/` handles it, so SKILL.md, agent
   definitions and memory files render their YAML as a rule plus a stray heading.
3. **The frontend has no file identity.** The host returns basenames only. That blocks in-place
   Save (#196), reload, recent and pinned files, relative links, local images and file watching.
4. **Editing means "Edit & PDF".** It loads the whole paginated workspace, puts five rows of chrome
   (about 190 px) above the text, and repaginates with Paged.js in the background even in
   Markdown-only view. Wrong default for notes and quick fixes.
5. **The reader bar is eleven form controls in a row.** Documents switch through a `<select>`.
   No command palette, no quick open.
6. **Nothing helps you copy.** No code-copy button, no copy-section, no copy-as-Markdown.
7. **Two document stores with a hand-written handoff** (`ReaderSession` and App `DocStore`, joined
   by `workspaceOriginals`) inside a 508-line module-level script, `src/desktop/main.ts`. Every
   feature has to thread both.
8. **Agentic setup has drifted** from the estate canon in 15 places (table at the end).

## Product shape

One window, one set of open documents, three surfaces:

| Surface | Purpose | Cost |
| --- | --- | --- |
| **Read** (default) | Continuous reader | Paints text first, upgrades code and diagrams after |
| **Edit** (`Ctrl+E`) | Source pane beside the live reader | No pagination; reuses `mountEditor`, Find and Format |
| **PDF** (command) | The existing paginated workspace, unchanged | Loaded only when asked, as today |

Chrome is one slim bar: `[Library] [document tabs] … [Edit] [More]`. Everything else lives in the
command palette (`Ctrl+K`), the More menu, or a collapsible panel (left: Library and Outline;
bottom: status line). With a document open, the default window shows the document and little else.

Companion behaviour:

- **Live.** A clean document follows its file on disk and the changed blocks flash. A document
  with unsaved edits gets a non-modal bar: Reload, Keep mine, Save As.
- **Library.** Pinned files, Recent, Projects (pinned folders), and Activity (Markdown files in
  pinned projects ordered by last change, with a "changed since you looked" mark).
- **Agent-aware.** Front matter as a Properties card with a lint for the mistakes that make Claude
  Code drop a file; `@path` imports and `[[name]]` links open in the app; a token estimate in the
  status line; an "Agent files" group per project; "Copy reference" for pasting into a prompt.
- **Pin on top.** One toggle keeps the window above the terminal.

## Boundary changes

Authorized by the owner direction above. Each slice updates `PRODUCT_VISION.md`, the spec and the
privacy text when it ships its row. Everything not listed stays as it is: no network, no document
telemetry, the sanitizer, the CSP, no generic filesystem or shell command, the web/PWA contract,
the render order and the no-slice guarantee.

Owner confirmation: the file watcher, `library.json` (saved file paths) and in-place Save rows were
confirmed by the owner in chat on 2026-11-11 ("Keep defaults"). The other rows (display paths in the
webview, session list restore, recovery staying opt-in) and drift-table rows 4, 10 and 15 remain
coordinator assumptions.

| Was | Now | Limits |
| --- | --- | --- |
| No file watcher | Native watcher for open bound files and pinned project folders | OS change notifications only, no polling; starts after the first bound document; reader cold start must not regress |
| Only settings persisted | Plus `library.json` in app local data | Paths and timestamps only, never content; a "Clear library" command; capped (500 recents, 64 pins) |
| Save writes a copy | `Ctrl+S` saves in place per `FILE_LIFECYCLE.md` | Save Copy stays; conflict rules as designed |
| Absolute paths never reach the webview | The webview receives display paths for bound documents and library entries | It still cannot supply a path: opens go through the native picker, an opaque token or a library entry id; relative links and assets resolve natively against the document's own folder |
| No session list | Reopen last session's bound files on launch | Paths only, default on, one setting |
| Unsaved-content recovery | Unchanged: opt-in per `RECOVERY.md` | Add one inline offer the first time an Untitled note has text; default stays off |

## Seams (slice S0 creates them; later slices add files behind them)

Native, `src-tauri/src/`: split `main.rs` into `commands/` plus `registry.rs`, `replace.rs`,
`library.rs`, `watch.rs`, `assets.rs`. `registry.rs` maps an opaque random token to a binding
(path, volume and file identity, content digest of at least 128 bits, length, encoding, line-ending
policy, generation). `OpenBatch` documents gain `token`, `path` and `dir` (display only),
`encoding`, `eol`.

Frontend, `src/desktop/`:

- `documents.ts`: one store for open documents across Read, Edit and PDF. Each document has a
  stable key, text, saved baseline, optional binding and a disk state (`synced`, `changed`,
  `missing`). Dirty is `text !== saved`. The PDF workspace maps its `DocStore` ids to these keys;
  `workspaceOriginals` goes away. This is the single ownership map `FILE_LIFECYCLE.md` requires.
- `commands.ts`: `registerCommand({ id, title, keys?, enabled?, run })`. Shortcuts, the palette and
  menus all read this registry.
- `panels.ts`: `registerPanel({ id, title, mount })` for the left sidebar.
- `main.ts` shrinks to wiring.
- `reader/`: `render.ts` (moved), `patch.ts`, `sourcemap.ts`, `copy.ts`, `frontmatter.ts`.

## Slices

Each slice is one PR unless it says otherwise. "Proof" is what must be true before merge, on top
of the standing gate (typecheck, lint, unit, both builds, the affected Playwright suites, hosted CI
green at the head).

### S8. Agentic setup sync (first, small)
Apply the `safe sync` rows of the drift table. Row 1 goes in its own PR. Rows 4, 10 and 15 use the
defaults named in the table. Commit this file and `.claude/launch.json`.
Proof: `npm run agent:hooks:smoke`, `npm run agent:skills:validate`.

### S0. Foundations (no behaviour change)
S0a native registry and module split, with `open_files` and `take_pending_files` returning the new
fields. S0b frontend `documents.ts`, `commands.ts`, `panels.ts`, with `main.ts` reduced to wiring.
Proof: every existing unit, desktop e2e, Rust and native smoke check passes unmodified, except
where a test asserted the absence of paths. S0a and S0b may be two PRs.

### S1a. Conflict-safe replace primitive (Astra)
`replace.rs`, Windows only, no IPC: replace a file only if its identity and digest still match, and
create a new file without clobbering. Meet the four numbered requirements under "Native persistence
gate" in `FILE_LIFECYCLE.md`, with a separate-process race harness in the Windows CI job. A
suggested mechanism, not a mandate: hold the destination handle without write or delete sharing,
verify through that handle, write and flush a sibling temporary file, rename the original aside by
handle, rename the temporary into place without replace, delete the aside, and journal the two
renames so a crash between them is recoverable. Fail closed on any sharing violation.
Budget: if no primitive is proven at twice the budget, ship Save on verify-through-handle plus
`ReplaceFileW` and describe it honestly as "checks for outside changes before writing". The watcher
keeps the stale window to milliseconds. Never call that fallback conflict-safe.

### S1b. Save and Save As (#196)
Implement `FILE_LIFECYCLE.md` on S0 and S1a: captured revisions, the completion table, encoding and
line-ending preservation, the conflict bar. `Ctrl+S` is Save, `Ctrl+Shift+S` is Save As, Save Copy
stays a command. Works from Read, Edit and PDF.
Proof: byte-for-byte round trips (UTF-8, BOM, UTF-16, CRLF), the real native dialog smoke, stale and
revoked completions, duplicate basenames. Second lens: `deep-reviewer` or Terra, because this is
the data-loss surface.

### S1c. Live reload
`watch.rs` on the `notify` crate (new pinned dependency, add its licence notice). Events carry a
token only. Clean document: re-read, patch the reader in place, keep the scroll anchor, flash the
changed blocks, update the saved baseline. Dirty document: the conflict bar; nothing is discarded
without a click. Deleted or moved: state shown, text kept. A save by this app must not echo as an
outside change.
Proof: native test that writes a file from a second process and observes one coalesced event;
desktop e2e for the three states with a stubbed bridge; reader cold-start unchanged.

### S2a. Source map and copy toolkit
Reader only: block elements carry their source line range (`data-src="start-end"`, from
markdown-it `token.map`, clamped to the document). On top of it:
- Code blocks: a Copy button on hover and focus; copies the fence body exactly.
- Headings: Copy link, Copy section as Markdown (to the next heading of the same or higher level).
- Selection: `Ctrl+Shift+C` copies the Markdown source of every block the selection touches.
  `Ctrl+C` stays the browser default.
- Document: Copy path, and Copy reference (`relative/path.md:12-30` against the project root when
  the file is inside a pinned project, else the full path).
Proof: unit tests for range mapping including lists, tables, nested blockquotes and front matter
offsets; e2e clipboard assertions; paginated output byte-identical to before.

### S2b. Front matter
A shared pre-step recognises leading YAML front matter (opening `---` on line 1, closing `---` or
`...`) and blanks it with the same number of lines so source maps hold. The reader shows a
collapsible Properties card; the paginated pipeline omits it. No new dependency: a tolerant
line-based reader for flat keys, lists and quoted strings, and a raw monospace fallback for
anything else. Lint, shown on the card: an unquoted value containing `: `, a missing `name` or
`description` when the file is a SKILL.md, an agent definition or a memory file, and an
unterminated block.
Proof: unit tests on real fixtures (a skill, an agent, a memory file, a broken one); the no-cutoff
test still green; spec updated.

### S2c. Text first, then upgrade; block patching
The reader paints parsed text at once, then swaps highlighted code and diagrams in place.
`patch.ts` replaces only the top-level blocks whose source changed and reuses highlighted fences
and Mermaid output by content hash. Live reload and Edit both use it.
Proof: a performance mark shows first text paint for the sample under 100 ms in the production
build on the development machine; code blocks do not shift by more than one pixel on upgrade;
`renderChain` ordering and Mermaid serialisation are preserved.

### S3. Shell (design-led)
Replace the reader toolbar with the slim bar, tabs, More menu, command palette with quick open
(`Ctrl+K`, `Ctrl+P`), collapsible left panel and one-line status (path, words, token estimate,
save state). Add follow-system theme and pin-on-top. Design work goes through the `impeccable`
skill and a `ui-designer` agent; show the coordinator screenshots of the prototype before building
it out.
Proof: with a document open at 1120×800 the chrome is at most 44 px above and 24 px below; every
former control is reachable from the palette; keyboard, forced-colors and reduced-motion checks in
both desktop Playwright configs; `scripts/desktop-smoke.ps1` updated in the same PR because it
finds buttons by name.

### S4. Library
Native `library.rs` owns `library.json` (recent, pinned files, pinned folders, last-seen stamps)
and a bounded folder scan (depth 8, 5,000 files, skipping `node_modules`, `.git`, `target`, `dist`,
`build`, `.venv`; dot-folders such as `.claude` are included). The panel shows Pinned, Recent,
Projects and Activity, with an "Agent files" group per project: `CLAUDE.md`, `AGENTS.md`,
`**/SKILL.md`, `.claude/agents/*.md`, `MEMORY.md` and `memory/*.md`, `HUMAN_TODO.md`,
`ACTION_ITEMS.md`, `ORCHESTRATOR.md`. The native half and the panel may be two PRs.
Proof: Rust tests for bounds, reparse points and corrupt store recovery; e2e for pin, unpin, open,
clear; nothing but paths and timestamps on disk.

### S5. Edit surface
`Ctrl+E` shows the source pane beside the reader, built from `mountEditor`, `mountEditorSearch` and
`mountEditorFormatting`. Typing patches the reader through S2c. Scroll follows through S2a. The PDF
command still enters the existing workspace, now keyed by document key.
Proof: the editor safety, search and formatting e2e suites run against the new surface; no Paged.js
chunk is requested while editing; undo history survives a mode toggle.

### S6. Links, images, history
Relative `.md` links, `@path` imports and `[[name]]` links open in the app through a native
`open_relative(token, href)` that resolves against the document's folder and re-applies the file
policy. Local images load through `assets.rs` as blob URLs (PNG, JPEG, GIF, WebP, SVG as image
only; 20 MB each). Back and forward with `Alt+Left` and `Alt+Right`.

### S7. Session and recovery
Reopen the last session's bound files. Then #197 as designed, plus the one-time inline offer.

### S9. Measure, polish, ship a build
Refresh #202's workloads against the new reader and Edit surface and fix what the numbers show.
Produce a local release build (`npm run desktop:build`) and record where the installer and the
portable executable are, so the owner can install it. Add the human acceptance item for it.

## Use case: run cards

The owner will work through ChatGPT "run cards" in MDviewer: a folder holding `desk.md` (a queue
table with relative links) and `runs/<NN>-<LANE>-<part>.md` cards that a generator rewrites as runs
complete. What they feel first, in order: copy a whole fenced block; open a folder and follow
relative `.md` links with Back; reload when the file changes on disk, keeping the scroll position;
long code blocks that behave. Acceptance for S1c and S6: with `desk.md` open, clicking a relative
link to a card opens it in the same window; `Alt+Left` returns to `desk.md` at its previous scroll
position; when a second process rewrites the open card, the view updates within about a second and
the scroll anchor holds. Real samples are private: read them locally only, never copy their text
into the repository, a fixture, a PR or an issue. This ordering is a coordinator assumption about
the owner's near-term priority (relayed 2026-11-11); the owner can reverse it.

## Lanes and routing

Models resolve through the estate `model-effort-routing` skill; this file names jobs, not ladders.

| Lane | Driver | Order | Owns |
| --- | --- | --- | --- |
| Core | Opus session, merge authority | S8, S0, S1b, S1c, S4 native, S6 native, S7 | `src-tauri/**`, `src/desktop/{documents,native,main}.ts`, agentic files |
| Experience | Opus session, merge authority | S2b, S2a, S2c, then S3 once S0 is on main, S4 panel, S5, S9 | `src/render/**`, `src/desktop/reader/**`, shell chrome and styles after S0 |

Suggested pairings: Astra takes S1a at the start, in its own worktree. Sol takes S0a beside the
Core driver's S0b, and a design critique of S5. The review gate is the `reviewer` agent; S1b and
S1c add one second lens. Free lenses (Muse, GLM) may sweep merged work for bugs and test gaps.
Until S0 merges, the Experience lane touches `src/desktop/main.ts` only for wire-up lines.

Rules for both lanes: estate laws govern (T2, merge free inside the gate, two review rounds at
most, three-minute head age, merge commits through `estate_merge.py`, ready-for-review PRs, one
worktree per slice under a short path such as `C:/Users/jekyt/source/mdv-<slice>`). Sync the spec,
`AGENT_INDEX.md` and the roadmap in the PR that changes their truth; keep `ORCHESTRATOR.md` entries
to ten lines. Never deploy (AI-9), never self-clear an `ACTION_ITEMS.md` item. Give Playwright a
distinct `E2E_PORT` and `DESKTOP_E2E_PORT` per worktree. After each merge, send the coordinator
five lines: what merged, proof, what is not verified, next slice, any decision needed.

## Agentic drift table (S8)

| # | Item | Where | Change | Class |
| --- | --- | --- | --- | --- |
| 1 | Project `defaultMode: bypassPermissions` | `.claude/settings.json:5`, `CLAUDE.md:154`, `mdv-claude-tooling/SKILL.md:22` | Delete the key; reword the two mentions | Posture change, own PR |
| 2 | Deprecated `includeCoAuthoredBy` | `settings.json:3`, `CLAUDE.md:69`, `GIT_WORKFLOW.md:33` | `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` | Safe sync |
| 3 | `CLAUDE.md` does not import `AGENTS.md`; its summary still describes a browser-only app | `CLAUDE.md:4-14` | Add the `@AGENTS.md` import, drop the duplicated authority order and read list, fix the summary | Safe sync |
| 4 | "Act on every finding regardless of tier" | `CLAUDE.md:107-118`, `AGENTS.md:105` | Adopt estate law 2: fix confirmed CRITICAL and HIGH, track the rest, two rounds. Default taken because the owner asked for the sync | Owner default |
| 5 | "No Codex review requests (self/Grok only)" | `ORCHESTRATOR.md:421,619,941` | Strike; reviews follow law 2g | Safe sync |
| 6 | `tier.json` notes describe a browser app only | `.agent-harness/tier.json:16` | Mention the Tauri desktop app; bump `last_reviewed` | Safe sync |
| 7 | ESTATE row is one stale line under the T1 table | `~/.claude/ESTATE.md:76` | File an issue in claude-config; not this repository | Other repository |
| 8 | No model-routing pointer | `AGENTS.md` | One line pointing at the estate `model-effort-routing` skill | Safe sync |
| 9 | Allow rules use `ls*` forms | `settings.json:10-42` | Rewrite to `Bash(ls:*)` style | Safe sync |
| 10 | Docs claim a `PreToolUse` guard that has not been wired since `0dbd8a2` | `CLAUDE.md:63`, `GIT_WORKFLOW.md:5,11`, `TOOLING_PARITY.md:32`, `mdv-claude-tooling/SKILL.md:25` | Reword to the truth: the script exists and is not wired; the rules are agent-held. Default taken because the estate declared this machine floorless | Owner default |
| 11 | Read-first ladder re-mandates auto-loaded files | `CLAUDE.md:29-47`, `AGENTS.md:28-33`, `session_start.py:15` | One line pointing at `ORCHESTRATOR.md` and `ACTION_ITEMS.md` | Safe sync |
| 12 | "Draft PRs" | `AGENTS.md:98` | Ready-for-review PRs | Safe sync |
| 13 | "Any head change resets review and CI evidence" | `AGENTS.md:102-103` | A head change re-proves what changed | Safe sync |
| 14 | Dangling section name | `GIT_WORKFLOW.md:26` | Point at "Review & Merge Gates" | Safe sync |
| 15 | `.mcp.json` unpinned; context7 may be declared at two scopes | `.mcp.json:5,11,16` | Pin versions; drop the project context7 entry only if the user-scope connector is the same server | Owner default |

## Human items

AI-6, AI-7, AI-8, AI-9 and #169 stay OPEN and are not touched by this push. S9 adds one new item:
install the local build, set it as the default Markdown app, and accept the new shell by hand.
