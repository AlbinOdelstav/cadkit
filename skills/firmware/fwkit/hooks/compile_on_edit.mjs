#!/usr/bin/env node
// PostToolUse hook (Edit / Write / MultiEdit): when Claude changes a sketch file (or the
// project.yaml) of a project with firmware.fqbn + firmware.sketch, regenerate pins.h and
// compile. A failed compile is sent back to Claude (exit 2) so it fixes the code before
// it says anything is done. Silent for every other file, and when arduino-cli is missing.
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../../../project/projkit/projkit.mjs';
import { project, compile } from '../fwkit.mjs';
import { loadConfig } from '../../../cad-validation/cadkit/config.mjs';

const SRC = ['.ino', '.h', '.hpp', '.c', '.cpp'];
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const file = input.tool_input && (input.tool_input.file_path || input.tool_input.path);
if (!file) process.exit(0);
const abs = path.resolve(input.cwd || process.cwd(), file);
const ext = path.extname(abs).toLowerCase();
const isYaml = path.basename(abs) === 'project.yaml';
if (!SRC.includes(ext) && !isYaml) process.exit(0);
if (path.basename(abs) === 'pins.h') process.exit(0); // generated

// the project this file belongs to
let projFile = null;
for (let d = isYaml ? path.dirname(abs) : path.dirname(abs), i = 0; i < 8; i++, d = path.dirname(d)) {
  const f = path.join(d, 'project.yaml');
  if (fs.existsSync(f)) {
    try {
      const p = load(f);
      const sk = p && p.schema && p.firmware && p.firmware.sketch;
      if (sk && sk !== 'none') {
        const sketch = path.resolve(d, String(sk));
        if (isYaml ? f === abs && fs.existsSync(sketch) : abs.startsWith(sketch + path.sep)) projFile = f;
      }
    } catch { /* not ours */ }
    break;
  }
  if (path.dirname(d) === d) break;
}
if (!projFile) process.exit(0);
const cli = loadConfig().arduino_cli;
if (!cli || !fs.existsSync(cli)) process.exit(0);

let res;
try { res = compile(project(projFile)); } catch (e) { process.stderr.write(`fwkit: ${e.message}\n`); process.exit(0); }
const u = res.usage;
const use = [u.flash && `flash ${u.flash.pct} %`, u.ram && `RAM ${u.ram.pct} %`].filter(Boolean).join(', ');
const warns = res.issues.filter((x) => x.level !== 'INFO').map((x) => `${x.level}: ${x.msg}`);
if (!res.ok || res.issues.some((x) => x.level === 'FAIL')) {
  const errs = String(res.errors || '').split(/\r?\n/).filter((l) => /error|fatal/i.test(l)).slice(0, 20);
  process.stderr.write(`fwkit compile FAILED for ${res.sketch} (${res.fqbn}). Fix it before saying the firmware is done:\n${[...errs, ...warns].join('\n')}\n`);
  process.exit(2);
}
const msg = `fwkit: compiled ${path.basename(res.sketch)} for ${res.fqbn} (${use})${res.pins_regenerated ? '; pins.h regenerated from project.yaml' : ''}.` + (warns.length ? `\n${warns.join('\n')}` : '');
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } }));
process.exit(0);
