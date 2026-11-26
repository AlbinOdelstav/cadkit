#!/usr/bin/env node
// SessionStart hook: when a session opens in a project folder (or a subfolder of one),
// put the project's one-line status into Claude's context. Silent everywhere else.
import fs from 'node:fs';
import path from 'node:path';
import { load, check } from '../projkit.mjs';
import { entries, openProblems } from '../log.mjs';

let dir = process.cwd();
try { const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); if (input.cwd) dir = input.cwd; } catch { /* no stdin */ }

for (let d = path.resolve(dir), i = 0; i < 6; i++, d = path.dirname(d)) {
  const f = path.join(d, 'project.yaml');
  if (fs.existsSync(f)) {
    try {
      const p = load(f);
      if (!p || !p.schema || !p.phase) break; // some other project.yaml
      const r = check(p, f);
      const fails = r.results.filter((x) => x.level === 'FAIL').map((x) => x.msg);
      const lines = [`Maker project "${p.title || p.project}" (${f}): phase ${p.phase}.`];
      if (r.gate) lines.push(`Gate ${r.gate.from} -> ${r.gate.to}: ${r.gate.open ? 'OPEN' : 'CLOSED: ' + r.gate.blockers.join('; ')}`);
      if (fails.length) lines.push(`${fails.length} FAIL in projkit check: ${fails.slice(0, 3).join('; ')}${fails.length > 3 ? ' ...' : ''}`);
      if (r.next_step) lines.push(`Next step: ${r.next_step}`);
      const es = entries(f);
      if (es.length) { const e = es[es.length - 1]; lines.push(`Last log entry (${e.day}): ${e.kind}: ${e.text}`); }
      const open = openProblems(es);
      if (open.length) lines.push(`Open problems in LOG.md: ${open.slice(-3).map((e) => e.text).join(' | ')}`);
      lines.push('Read and update project.yaml with the cadkit "project" skill; use the "plan" skill for the build order and "log" to record results.');
      console.log(lines.join('\n'));
    } catch (e) {
      console.log(`project.yaml at ${f} could not be read: ${e.message}`);
    }
    break;
  }
  if (path.dirname(d) === d) break;
}
process.exit(0);
