"""Invented QA corpus modelled on agent-written Markdown. No real documents. Usage: python -I make_corpus.py <out dir>"""
import json, os, random
random.seed(7)
import sys
out = sys.argv[1] if len(sys.argv) > 1 else 'qa-corpus'
os.makedirs(out, exist_ok=True)
def w(name, text, crlf=False, bom=False):
    data = text.replace('\n', '\r\n') if crlf else text
    b = data.encode('utf-8')
    if bom: b = b'\xef\xbb\xbf' + b
    open(os.path.join(out, name), 'wb').write(b)
verbs = ['Wire', 'Test', 'Document', 'Refactor', 'Measure', 'Review', 'Ship', 'Audit', 'Port', 'Draft']
nouns = ['the parser', 'session restore', 'the export path', 'library scan', 'the watcher', 'focus order',
         'the toolbar', 'CSV preview', 'theme tokens', 'the installer', 'print CSS', 'undo stack']
def task(done=False, depth=0):
    return '  ' * depth + '- [%s] %s %s' % ('x' if done else ' ', random.choice(verbs), random.choice(nouns))
# 1. 600-line checklist, CRLF + BOM, headings every ~40 lines
L = ['# Release checklist (invented)', '', 'Status: in progress. Owner: the agent fleet.', '']
sec = 0
while len(L) < 600:
    sec += 1
    L += ['## Phase %d — %s' % (sec, random.choice(nouns).title()), '']
    for i in range(30):
        L.append(task(random.random() < 0.3))
        if random.random() < 0.2:
            L.append(task(False, 1)); L.append(task(random.random() < 0.5, 1))
    L += ['', '1. First numbered step', '2. Second numbered step', '   - [ ] nested task under a number', '3. Third', '']
w('checklist-600-crlf-bom.md', '\n'.join(L[:600]) + '\n', crlf=True, bom=True)
# 2. agent plan with front matter, tables, nested lists, code, callouts (LF)
plan = '''---
title: Agent plan for the importer
status: active
owner: agent
tags: [plan, importer]
---

# Importer plan

> [!NOTE]
> This plan was written by an agent. Ticks are updated as slices land.

## Goals

1. Parse the three input formats.
   1. JSON first.
   2. Then YAML.
      - [ ] decide on multi-document handling
      - [x] reject anchors that loop
2. Keep memory under the budget.
3. Report progress.

## Slices

| Slice | Owner | Status | Notes |
| --- | --- | --- | --- |
| S1 parser | agent-a | done | merged |
| S2 budget | agent-b | in progress | needs a test |
| S3 report | — | todo | blocked on S2 |

## Tasks

- [ ] S2: add the budget test
- [ ] S2: wire the budget into the loader
  - [ ] measure the 50 MB case
  - [ ] measure the 500 MB case
- [x] S1: parser merged
- [ ] S3: write the report template

```ts
export function budget(bytes: number): boolean {
  return bytes < 250_000;
}
```

:::warning
Do not run the 500 MB case on a shared runner.
:::

## Open questions

- Should the report go to the Library?
- Who reviews S3?
'''
for i in range(1, 41):
    plan += '\n### Note %d\n\nParagraph %d of invented notes about the importer, long enough to wrap across the reader width on a normal window so scrolling is real.\n\n- [ ] follow-up %d\n' % (i, i, i)
w('agent-plan-frontmatter.md', plan)
w('agent-plan-frontmatter-crlf.md', plan, crlf=True)
# 3. Transcript JSONL
turns = []
for i in range(12):
    turns.append({'role': 'user', 'content': 'Question %d: can you check slice S%d?' % (i, i)})
    turns.append({'role': 'assistant', 'content': 'Checked S%d. It passes three of four tests; the fourth needs a fixture.' % i})
w('transcript-chat.jsonl', '\n'.join(json.dumps(t) for t in turns) + '\n')
agent = []
for i in range(8):
    agent.append({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Run step %d' % i}]}, 'timestamp': '2026-11-13T01:%02d:00Z' % i})
    agent.append({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Ran step %d.' % i}, {'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'npm test'}}]}, 'timestamp': '2026-11-13T01:%02d:30Z' % i})
w('transcript-agent.jsonl', '\n'.join(json.dumps(t) for t in agent) + '\n')
# 4. JSON / YAML / TOML / CSV / TSV / log
w('report.json', json.dumps({'name': 'importer', 'version': '0.3.1', 'slices': [{'id': 'S%d' % i, 'status': random.choice(['done', 'todo', 'in progress']), 'tests': random.randint(0, 40)} for i in range(1, 9)], 'budget': {'bytes': 250000, 'unit': 'B'}}, indent=2) + '\n')
w('config.yaml', 'name: importer\nretries: 3\nformats:\n  - json\n  - yaml\n  - csv\nlimits:\n  memory_mb: 512\n  timeout_s: 30\n---\nname: second-document\nenabled: false\n')
w('settings.toml', 'title = "Importer"\n\n[limits]\nmemory_mb = 512\ntimeout_s = 30\n\n[[formats]]\nname = "json"\n\n[[formats]]\nname = "csv"\n')
w('results.csv', 'slice,owner,tests,passed\n' + '\n'.join('S%d,agent-%s,%d,%d' % (i, 'abc'[i % 3], 10 + i, 9 + i) for i in range(1, 30)) + '\n', crlf=True)
w('results.tsv', 'slice\towner\tstatus\n' + '\n'.join('S%d\tagent\tdone' % i for i in range(1, 10)) + '\n')
w('build.log', '\n'.join('2026-11-13T01:%02d:%02dZ INFO step %d ok' % (i // 60, i % 60, i) for i in range(200)) + '\n2026-11-13T01:59:59Z ERROR step 200 failed: invented\n')
w('empty.md', '')
w('unicode name é 漢字.md', '# Unicode path\n\n- [ ] tick me\n- [ ] and me\n')
print(len(os.listdir(out)), 'files in', out)
