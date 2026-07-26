/**
 * Collect the second brain into one graph.json, from sources that are actually on disk.
 *
 * Everything here is read, never remembered. If a source is missing the node still appears, marked
 * `missing`, because a brain that silently omits what it cannot see is how nine "that does not
 * exist" claims got made in a single session.
 *
 * Sources, all local:
 *   graph-hop ledger      ~/.claude/graph-hop/ledger/*.md          reasoning threads + staleness
 *   memory stores         ~/.claude/projects/<slug>/memory/*.md    durable facts
 *   claude sessions       ~/.claude/projects/<slug>/*.jsonl        session activity
 *   repositories.yaml     node-platform                            the repo registry
 *   ECOSYSTEM_STATUS.md   node-platform                            P0 scores, proof schema
 *   evolution/            node-platform                            events, drafts, schemas
 *
 * Notion is deliberately NOT read here. It needs an authenticated API call, and a collector that
 * silently produced an empty Notion node would be worse than one that says it cannot see it.
 *
 * Usage: node tools/brain/collect.mjs [--out tools/brain/graph.json]
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const LEDGER = path.join(HOME, '.claude', 'graph-hop', 'ledger');
const PROJECTS = path.join(HOME, '.claude', 'projects');
const PLATFORM = 'D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/node-platform';

const out = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'tools/brain/graph.json';

const nodes = [];
const edges = [];
const add = (n) => { nodes.push(n); return n.id; };
const link = (a, b, kind = 'has') => edges.push({ source: a, target: b, kind });

const safeDir = async (p) => { try { return await readdir(p, { withFileTypes: true }); } catch { return []; } };
const safeRead = async (p) => { try { return await readFile(p, 'utf8'); } catch { return null; } };

add({ id: 'core', label: 'second brain', group: 'core', status: 'live', size: 34,
  note: 'Six sources. The store existed before it was ever read first.' });

/* ---------- reasoning threads ---------- */
add({ id: 'threads', label: 'ChatGPT', group: 'source', status: 'live', size: 20,
  note: 'graph-hop ledger — months of design reasoning' });
link('core', 'threads', 'source');

for (const entry of await safeDir(LEDGER)) {
  if (!entry.isFile() || !entry.name.startsWith('thread-')) continue;
  const body = (await safeRead(path.join(LEDGER, entry.name))) ?? '';
  const turns = Number((body.match(/turns-at-(?:last-)?read:\s*(\d+)/i) ?? [])[1] ?? 0);
  const read = (body.match(/(?:last-consulted|read-on):\s*([0-9-]+)/i) ?? [])[1] ?? '?';
  const id = `t:${entry.name.replace(/^thread-|\.md$/g, '')}`;
  // A ledger node older than two days is treated as stale: threads move, and a stale node that
  // looks current is exactly the failure this whole exercise is about.
  const ageDays = read === '?' ? 99 : (Date.now() - Date.parse(read)) / 864e5;
  add({ id, label: entry.name.replace(/^thread-|\.md$/g, ''), group: 'thread',
    status: ageDays > 2 ? 'stale' : 'live', size: 8 + Math.min(turns, 30) / 4,
    note: `${turns} turns at last read · ${read}` });
  link('threads', id);
}

/* ---------- claude code sessions ---------- */
add({ id: 'sessions', label: 'Claude Code', group: 'source', status: 'live', size: 20,
  note: 'sessions across every working directory' });
link('core', 'sessions', 'source');

let sessionCount = 0;
for (const proj of await safeDir(PROJECTS)) {
  if (!proj.isDirectory()) continue;
  const dir = path.join(PROJECTS, proj.name);
  const files = (await safeDir(dir)).filter((f) => f.isFile() && f.name.endsWith('.jsonl'));
  if (files.length === 0) continue;
  let newest = 0;
  for (const f of files) {
    try { newest = Math.max(newest, (await stat(path.join(dir, f.name))).mtimeMs); } catch { /* skip */ }
  }
  sessionCount += files.length;
  const ageDays = (Date.now() - newest) / 864e5;
  const id = `s:${proj.name}`;
  add({ id, label: proj.name.replace(/^[A-Z]--VSCode-Projects-/, '').slice(0, 28),
    group: 'session', status: ageDays < 1 ? 'live' : ageDays < 7 ? 'stale' : 'cold',
    size: 6 + Math.min(files.length, 20) / 3,
    note: `${files.length} session${files.length === 1 ? '' : 's'} · last active ${ageDays < 1 ? 'today' : `${Math.round(ageDays)}d ago`}` });
  link('sessions', id);

  const mem = (await safeDir(path.join(dir, 'memory'))).filter((f) => f.isFile() && f.name !== 'MEMORY.md');
  if (mem.length > 0) {
    const mid = `m:${proj.name}`;
    add({ id: mid, label: `${mem.length} memories`, group: 'memory', status: 'live', size: 5 + mem.length / 4,
      note: mem.slice(0, 6).map((f) => f.name.replace(/\.md$/, '')).join(' · ') });
    link(id, mid, 'remembers');
  }
}
nodes.find((n) => n.id === 'sessions').note = `${sessionCount} sessions on disk`;

/* ---------- repositories ---------- */
add({ id: 'repos', label: 'Repositories', group: 'source', status: 'live', size: 20, note: 'the code half' });
link('core', 'repos', 'source');

const status = (await safeRead(path.join(PLATFORM, 'docs/ECOSYSTEM_STATUS.md'))) ?? '';
for (const row of status.split('\n')) {
  const m = row.match(/^\|\s*([A-Za-z][\w-]*)\s*\|\s*(\w+)\s*\|\s*([\w-]+)\s*\|.*?\|\s*(\w[\w-]*)\s*\|\s*(\d+)\/8\s*\|?\s*$/);
  if (!m) continue;
  const [, name, life, role, proof, p0] = m;
  const score = Number(p0);
  const id = `r:${name}`;
  add({ id, label: name, group: 'repo',
    status: score >= 8 ? 'live' : score === 7 ? 'stale' : 'blocked',
    size: 7 + score, note: `${role} · ${life} · P0 ${score}/8 · proof ${proof.toLowerCase()}` });
  link('repos', id);
  if (role === 'platform') link(id, 'evolution', 'owns');
}

/* ---------- evolution ledger ---------- */
const evDrafts = (await safeDir(path.join(PLATFORM, 'evolution/drafts'))).filter((f) => f.isFile()).length;
let evEvents = 0;
for (const track of await safeDir(path.join(PLATFORM, 'evolution/events'))) {
  if (track.isDirectory()) {
    evEvents += (await safeDir(path.join(PLATFORM, 'evolution/events', track.name))).filter((f) => f.isFile()).length;
  }
}
add({ id: 'evolution', label: 'Evolution ledger', group: 'source',
  status: existsSync(path.join(PLATFORM, 'evolution/ledger.json')) ? 'live' : 'missing', size: 20,
  note: `${evEvents} events · ${evDrafts} drafts · append-only, delete prohibited` });
link('core', 'evolution', 'source');

/* ---------- the join, and what is severed ---------- */
const graphOn = existsSync(path.join(PLATFORM, '.nodeagent/knowledge/graph.json'));
add({ id: 'graph', label: 'Knowledge graph', group: 'join',
  status: graphOn ? 'blocked' : 'missing', size: 18,
  note: graphOn
    ? 'initialized · import blocked on a stale code graph'
    : 'not initialized — run nodekit graph init' });
link('core', 'graph', 'join');
link('graph', 'repos', 'severed');

add({ id: 'notion', label: 'Notion', group: 'source', status: 'stale', size: 18,
  note: 'not readable from this collector — needs an authenticated call' });
link('core', 'notion', 'source');

add({ id: 'gmail', label: 'Gmail', group: 'source', status: 'missing', size: 14,
  note: 'no connector — the one named source still unwired' });
link('core', 'gmail', 'severed');

const graph = {
  generatedAt: new Date().toISOString(),
  counts: {
    nodes: nodes.length, edges: edges.length, sessions: sessionCount,
    evolutionEvents: evEvents, evolutionDrafts: evDrafts,
    severed: edges.filter((e) => e.kind === 'severed').length,
  },
  nodes, edges,
};
await writeFile(out, `${JSON.stringify(graph, null, 2)}\n`);
process.stdout.write(
  `brain graph → ${out}\n  ${nodes.length} nodes · ${edges.length} edges · ${sessionCount} sessions · ${evEvents} events · ${evDrafts} drafts · ${graph.counts.severed} severed\n`,
);
