#!/usr/bin/env node
// Stop hook: if this session wrote STL files in a CAD version folder and that
// folder has no current, non-failing validation report, keep Claude working
// until it has run `cadkit validate` (or explained why not).
//
// Only folders under the session's cwd, and only STLs written since this
// session's transcript was created, so old projects are never nagged.
// Blocks at most once per stop (stop_hook_active), so it cannot loop.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cadkit.mjs');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(raw); } catch { process.exit(0); }
  if (ev.stop_hook_active) process.exit(0);
  const cwd = ev.cwd || process.cwd();
  let since = Date.now() - 6 * 3600e3;
  try { since = fs.statSync(ev.transcript_path).birthtimeMs || since; } catch { /* keep default */ }
  const r = spawnSync(process.execPath, [CLI, 'scan', cwd, String((Date.now() - since) / 3600e3)], { encoding: 'utf8', timeout: 60000 });
  const lines = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean)
    .filter((l) => !l.includes(`${path.sep}cadkit${path.sep}tests${path.sep}`));
  if (r.status !== 1 || !lines.length) process.exit(0);
  const reason = 'STL files were written in this session, but these version folders have no current passing validation:\n' +
    lines.map((l) => '  - ' + l).join('\n') +
    '\nRun `node "' + CLI + '" validate <folder>` for each (write cadkit.yaml first if it is missing), ' +
    'and report the verdict to the user. If these STLs are scratch output not meant for printing, say so to the user instead. ' +
    'Never call a part ready to print without a current report.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
});
