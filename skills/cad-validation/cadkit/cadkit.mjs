#!/usr/bin/env node
// cadkit launcher.
//
//   node cadkit.mjs validate <version dir>   run every check, write validation/report.md
//   node cadkit.mjs gate <version dir>       exit 0 only if a current, non-failing report exists
//   node cadkit.mjs scan <dir>               list version folders whose report is missing or stale
//   node cadkit.mjs new <version dir>        copy the manifest template
//   node cadkit.mjs slice <version dir>      slice the STLs with Bambu Studio's CLI (see README)
//   node cadkit.mjs coupon                   build the calibration coupon (calibration/out/)
//   node cadkit.mjs config                   show where FreeCAD, Bambu, the profile etc. were found
//
// Exit codes (validate): 0 ready, 1 NOT READY, 2 COUPON FIRST, 3 tool error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { loadConfig, childEnv } from './config.mjs';

const CFG = loadConfig();
const FREECAD = CFG.freecadcmd;
const BAMBU = CFG.bambu_studio;

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const dirOf = (p) => (fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p));

function validate(dir) {
  dir = path.resolve(dirOf(dir));
  if (!fs.existsSync(path.join(dir, 'cadkit.yaml'))) {
    console.error(`NOT READY: no cadkit.yaml in ${dir}. The manifest is mandatory: node cadkit.mjs new ${dir}`);
    return 1;
  }
  if (!FREECAD) {
    console.error('FreeCAD not found: set freecadcmd in config.yaml (see config.example.yaml)');
    return 3;
  }
  const t0 = Date.now();
  const r = spawnSync(FREECAD, [path.join(HERE, 'validate.py')], {
    env: childEnv(CFG, { CADKIT_MANIFEST: dir, CADKIT_HOME: HERE }),
    encoding: 'utf8', maxBuffer: 1 << 26, timeout: 60 * 60 * 1000,
  });
  const rp = path.join(dir, 'validation', 'report.json');
  if (!fs.existsSync(rp) || fs.statSync(rp).mtimeMs < t0) {
    console.error('validator did not write a report:\n' + (r.stderr || '') + (r.stdout || '').slice(-3000));
    return 3;
  }
  const rep = JSON.parse(fs.readFileSync(rp, 'utf8'));
  const c = rep.counts || {};
  console.log(`${rep.verdict}  (${c.PASS ?? 0} PASS, ${c.FAIL ?? 0} FAIL, ${c.WARNING ?? 0} WARNING, ${c['NOT TESTED'] ?? 0} NOT TESTED)`);
  console.log(`report: ${path.join(dir, 'validation', 'report.md')}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (rep.error) console.log(rep.error);
  return r.status ?? 3;
}

// Is there a report that covers exactly the files on disk now?
function gateInfo(dir) {
  dir = path.resolve(dirOf(dir));
  const rp = path.join(dir, 'validation', 'report.json');
  if (!fs.existsSync(path.join(dir, 'cadkit.yaml'))) return { ok: false, why: 'no cadkit.yaml (manifest is mandatory)' };
  if (!fs.existsSync(rp)) return { ok: false, why: 'never validated' };
  const rep = JSON.parse(fs.readFileSync(rp, 'utf8'));
  if (!rep.stamp) return { ok: false, why: `report has no file stamp (${rep.verdict})` };
  for (const [rel, h] of Object.entries(rep.stamp.files)) {
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) return { ok: false, why: `${rel} is gone since validation` };
    if (sha(p) !== h) return { ok: false, why: `${rel} changed after validation - run validate again` };
  }
  // STLs on disk that the report never saw
  const stlDir = path.join(dir, 'stl');
  if (fs.existsSync(stlDir)) {
    for (const f of fs.readdirSync(stlDir)) {
      if (f.toLowerCase().endsWith('.stl') && !(`stl${path.sep}${f}` in rep.stamp.files) && !(`stl/${f}` in rep.stamp.files))
        return { ok: false, why: `stl/${f} is not in the manifest, so it was never validated` };
    }
  }
  if (rep.verdict === 'NOT READY') return { ok: false, why: `report verdict NOT READY (${rep.counts.FAIL} FAIL)` };
  return { ok: true, why: rep.verdict, rep };
}

function gate(dir) {
  const g = gateInfo(dir);
  console.log(g.ok ? `GATE OPEN: ${g.why}` : `GATE CLOSED: ${g.why}`);
  if (g.ok && g.rep && Object.keys(g.rep.measure || {}).length)
    console.log('Still to measure:\n  ' + Object.keys(g.rep.measure).join('\n  '));
  return g.ok ? 0 : 1;
}

function* versionDirs(root, depth = 0) {
  if (depth > 4 || !fs.existsSync(root)) return;
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  const names = ents.map((e) => e.name);
  if (names.includes('cadkit.yaml') || names.includes('stl')) yield root;
  for (const e of ents) {
    if (e.isDirectory() && !['node_modules', '.git', 'validation', 'review', 'stl', 'parts', '__pycache__'].includes(e.name))
      yield* versionDirs(path.join(root, e.name), depth + 1);
  }
}

function scan(root, sinceMs = 0) {
  const out = [];
  for (const d of versionDirs(path.resolve(root))) {
    const stlDir = path.join(d, 'stl');
    let newest = 0;
    if (fs.existsSync(stlDir))
      for (const f of fs.readdirSync(stlDir)) if (f.toLowerCase().endsWith('.stl')) newest = Math.max(newest, fs.statSync(path.join(stlDir, f)).mtimeMs);
    if (!newest || newest < sinceMs) continue;
    const g = gateInfo(d);
    if (!g.ok) out.push({ dir: d, why: g.why });
  }
  return out;
}

function newManifest(dir) {
  dir = path.resolve(dir);
  const dst = path.join(dir, 'cadkit.yaml');
  if (fs.existsSync(dst)) { console.error(`${dst} exists - not overwriting`); return 1; }
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'templates', 'cadkit.yaml'), dst);
  console.log(`wrote ${dst} - fill in every section (write 'none' for an empty one)`);
  return 0;
}

const [cmd, arg, ...rest] = process.argv.slice(2);
let code = 0;
if (cmd === 'validate') code = validate(arg || '.');
else if (cmd === 'gate') code = gate(arg || '.');
else if (cmd === 'scan') {
  const hours = Number(rest[0] || 0);
  const res = scan(arg || '.', hours ? Date.now() - hours * 3600e3 : 0);
  for (const r of res) console.log(`${r.dir}: ${r.why}`);
  code = res.length ? 1 : 0;
} else if (cmd === 'new') code = newManifest(arg || '.');
else if (cmd === 'slice') {
  const mod = await import('./slice.mjs');
  code = await mod.slice(path.resolve(dirOf(arg || '.')), { BAMBU, SYS: CFG.bambu_presets });
} else if (cmd === 'coupon') {
  if (!FREECAD) { console.error('FreeCAD not found: set freecadcmd in config.yaml'); code = 3; } else {
    const r = spawnSync(FREECAD, [path.join(HERE, 'calibration', 'build_coupon.py')],
      { env: childEnv(CFG, { CADKIT_HOME: HERE }), encoding: 'utf8', maxBuffer: 1 << 26 });
    const md = path.join(HERE, 'calibration', 'out', 'COUPON.md');
    code = fs.existsSync(md) ? 0 : 3;
    console.log(code ? 'coupon build failed:\n' + (r.stderr || '') : `wrote ${path.dirname(md)} (STLs + COUPON.md)`);
  }
} else if (cmd === 'config') {
  const show = (k) => `${k.padEnd(19)} ${CFG[k] || '(not set)'}`;
  console.log([`config file         ${CFG._file || '(none: using environment and auto-detection)'}`,
    ...['freecadcmd', 'bambu_studio', 'bambu_presets', 'tolerances', 'inventory_hardware'].map(show)].join('\n'));
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
  code = cmd ? 3 : 0;
}
process.exit(code);

export { gateInfo, scan };
