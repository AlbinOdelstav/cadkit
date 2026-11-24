#!/usr/bin/env node
// Regression test for the validator: every seeded defect must be caught by
// the check written for it, and the clean design must not fail.
//
//   node tests/run_tests.mjs            -> tests/RESULTS.md, exit 1 on any miss
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig, childEnv } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.dirname(HERE);
const OUT = path.join(HERE, 'uno_box', 'out');
const CLI = path.join(KIT, 'cadkit.mjs');

// The tests use their own tolerance table (tests/fixtures/), never the user's
// profile, so results do not depend on whose printer runs them.
process.env.CADKIT_TOLERANCES = path.join(HERE, 'fixtures', 'tolerances-test.yaml');
const CFG = loadConfig();
if (!CFG.freecadcmd) { console.error('FreeCAD not found: set freecadcmd in config.yaml'); process.exit(3); }
const b = spawnSync(CFG.freecadcmd, [path.join(HERE, 'uno_box', 'build.py')],
  { env: childEnv(CFG, { CADKIT_HOME: KIT }), encoding: 'utf8', maxBuffer: 1 << 26 });
if (!fs.existsSync(path.join(OUT, 'clean', 'cadkit.yaml'))) { console.error('test design build failed\n' + (b.stderr || '')); process.exit(3); }

// test design 2: TT motor on a retainer plate (screw into a bought part, pin fits into its holes)
const OUT_TT = path.join(HERE, 'tt_mount', 'out');
const b2 = spawnSync(CFG.freecadcmd, [path.join(HERE, 'tt_mount', 'build.py')],
  { env: childEnv(CFG, { CADKIT_HOME: KIT }), encoding: 'utf8', maxBuffer: 1 << 26 });
if (!fs.existsSync(path.join(OUT_TT, 'clean', 'cadkit.yaml'))) { console.error('TT test design build failed: ' + (b2.stderr || '')); process.exit(3); }
const vdir = (v) => (v.startsWith('tt/') ? path.join(OUT_TT, v.slice(3)) : path.join(OUT, v));

// variant -> what must be found. check: substring of the check name.
const EXPECT = {
  clean: { noFail: true, verdict: 'COUPON FIRST', measure: ['h3_x', 'h4_x', 'usb_plug_w', 'dc_plug_d'], why: 'no defect; Uno hole positions are drawing values and cable plug sizes are estimates, so those are asked to be measured' },
  clean_measured: { noFail: true, verdict: 'READY', why: 'same design, hole positions and cable plugs measured' },
  m3_hole_small: { find: [['FAIL', 'fasteners', 'clearance hole in Lid']], why: 'lid holes 2.5 instead of 3.4' },
  pilot_hard_start: { find: [['WARNING', 'fasteners', 'pilot hole in Base', 'lid-1']], why: 'corner-post pilots 2.6 (works, hard to start per coupon)' },
  lid_hole_offset: { find: [['FAIL', 'fasteners', 'pilot hole in Base', 'lid-2']], why: 'one lid hole 1.5 mm off its post' },
  screw_too_long: { find: [['FAIL', 'fasteners', 'screw is free to its tip', 'uno-h3']], why: 'M3x12 into a 6.5 mm deep pilot' },
  driver_blocked: { find: [['FAIL', 'fasteners', 'screwdriver reaches the head', 'uno-h4']], why: 'a shelf over the board screw' },
  thin_wall: { find: [['FAIL', 'walls', 'no wall thinner']], why: 'walls 0.6 mm' },
  usb_misaligned: { find: [['FAIL', 'access', 'usb_b plug reachable']], why: 'USB opening 4 mm off' },
  pins_hit_floor: { find: [['FAIL', 'access', "solder side"]], why: 'standoffs 1.5 mm: board underside on the floor' },
  lid_too_tight: { find: [['FAIL', 'fits', 'fit lid lip in base']], why: 'lip gap 0.1 per side' },
  uno_does_not_fit: { find: [['FAIL', 'assembly', 'no clash']], why: 'cavity 2 mm too short: board hits the corner posts' },
  floating_standoff: { find: [['FAIL', 'geometry', 'one connected solid', 'Base'], ['FAIL', 'mesh', 'single shell', 'Base']], why: 'one support pin 0.2 mm above the floor' },
  unsupported_shelf: { find: [['WARNING', 'print', 'self-supporting', 'Base']], why: '8 mm cantilever shelf' },
  cable_hole_small: { find: [['FAIL', 'access', 'access path sensor cable exit']], why: 'cable hole 3 mm for a 4 mm cable' },
  undeclared_hole: { find: [['WARNING', 'fasteners', 'hole is declared', 'Base']], why: 'M3-size hole no fastener uses' },
  slender_pin: { find: [['FAIL', 'print', 'slender', 'Base']], why: '1.4 mm pin, 22 mm tall' },
  broken_mesh: { find: [['FAIL', 'mesh', 'watertight', 'Lid']], why: '40 facets removed from the STL' },
  wrong_scale: { find: [['FAIL', 'export', 'STL matches the CAD model', 'Lid']], why: 'STL written in inches' },
  'tt/clean': { noFail: true, verdict: 'COUPON FIRST', find: [['PASS', 'fasteners', 'thread into component:tt'], ['PASS', 'fasteners', 'thread engagement in component:tt'], ['PASS', 'fits', 'fit pins in gearbox holes'], ['PASS', 'walls', 'walls at least', 'Plate']], why: 'TT motor: M3 threads into the tail (library threads:), 2.0 pins in the 3.0 gearbox holes; only the ASSUMED wire room asks to be looked at' },
  'tt/pin_tight_vs_unc': { find: [['WARNING', 'fits', 'fit pins in gearbox holes']], measure: ['mh_x'], why: 'pins 2.5: 0.25 per side is less than the ±0.3 hole-position uncertainty' },
  'tt/pin_too_big': { find: [['FAIL', 'fits', 'fit pins in gearbox holes']], why: 'pins 2.95 in 3.0 holes' },
  'tt/screw_into_gearbox': { find: [['FAIL', 'fasteners', 'thread into component:tt']], why: 'screw threaded into a gearbox hole the library does not declare as threadable' },
};

function run(args) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
  });
}

async function pool(items, n, fn) {
  const res = {};
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = items[i++]; res[k] = await fn(k); }
  }));
  return res;
}

const variants = Object.keys(EXPECT);
const t0 = Date.now();
await pool(variants, 4, (v) => run(['validate', vdir(v)]));
const rows = [];
let misses = 0;
for (const v of variants) {
  const e = EXPECT[v];
  const rp = path.join(vdir(v), 'validation', 'report.json');
  if (!fs.existsSync(rp)) { rows.push([v, e.why, 'NO REPORT', '', '']); misses++; continue; }
  const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
  const fails = r.rows.filter((x) => x.status === 'FAIL');
  const res = [];
  let ok = true;
  if (e.noFail && fails.length) { ok = false; res.push(`unexpected FAIL: ${fails.map((f) => f.check).join('; ')}`); }
  if (e.verdict && !r.verdict.startsWith(e.verdict)) { ok = false; res.push(`verdict ${r.verdict}, wanted ${e.verdict}`); }
  for (const m of e.measure || []) if (!Object.keys(r.measure).some((k) => k.includes(m))) { ok = false; res.push(`no measure ask for ${m}`); }
  for (const [st, cat, chk, item] of e.find || []) {
    const hit = r.rows.find((x) => x.status === st && x.cat === cat && x.check.includes(chk) && (!item || x.item === item));
    if (!hit) { ok = false; res.push(`MISSED ${st} ${cat} '${chk}'${item ? ' on ' + item : ''}`); }
    else res.push(`${st}: ${hit.check} - ${hit.measured}`);
  }
  const other = fails.filter((f) => !(e.find || []).some(([st, cat, chk]) => st === 'FAIL' && f.cat === cat && f.check.includes(chk)));
  if (!ok) misses++;
  rows.push([v, e.why, ok ? 'CAUGHT' : 'MISSED', res.join('<br>'),
    `${r.verdict}; ${r.counts.FAIL} FAIL, ${r.counts.WARNING} WARN` + (other.length && !e.noFail ? `<br>also: ${other.map((f) => f.check).join('; ')}` : '')]);
}

// gate behaviour on the clean design
const g1 = await run(['gate', path.join(OUT, 'clean')]);
const stl = path.join(OUT, 'clean', 'stl', 'Base.stl');
const orig = fs.readFileSync(stl);
fs.appendFileSync(stl, '\n');
const g2 = await run(['gate', path.join(OUT, 'clean')]);
fs.writeFileSync(stl, orig);
const g3 = await run(['gate', path.join(OUT, 'thin_wall')]);
const gateOk = g1.code === 0 && g2.code === 1 && g3.code === 1;
if (!gateOk) misses++;
rows.push(['gate', 'print gate: open on a current report, closed after the STL changes, closed on FAIL',
  gateOk ? 'CAUGHT' : 'MISSED', [g1.out, g2.out, g3.out].map((s) => s.trim().split('\n')[0]).join('<br>'), '']);

// manifest strictness
const tmp = path.join(OUT, '_manifest_tests');
fs.rmSync(tmp, { recursive: true, force: true });
fs.cpSync(path.join(OUT, 'clean'), tmp, { recursive: true });
fs.rmSync(path.join(tmp, 'validation'), { recursive: true, force: true });
const man = fs.readFileSync(path.join(tmp, 'cadkit.yaml'), 'utf8');
fs.writeFileSync(path.join(tmp, 'cadkit.yaml'), man.replace(/^motions: none\s*$/m, ''));
const m1 = await run(['validate', tmp]);
const r1 = JSON.parse(fs.readFileSync(path.join(tmp, 'validation', 'report.json'), 'utf8'));
fs.writeFileSync(path.join(tmp, 'cadkit.yaml'), man.replace('material: PLA', 'material: PETG'));
const m2 = await run(['validate', tmp]);
const r2 = JSON.parse(fs.readFileSync(path.join(tmp, 'validation', 'report.json'), 'utf8'));
const manOk = r1.verdict === 'NOT READY' && /motions/.test(r1.error || '') &&
  r2.verdict === 'NOT READY' && r2.rows.some((x) => x.status === 'FAIL' && x.check.includes('tolerance table'));
if (!manOk) misses++;
rows.push(['manifest', 'a missing section, or a material without a tolerance table, blocks validation',
  manOk ? 'CAUGHT' : 'MISSED', `missing 'motions': ${r1.verdict}<br>PETG: ${r2.verdict}`, '']);

// profile rule: no profile, or the uncalibrated example, must FAIL
fs.writeFileSync(path.join(tmp, 'cadkit.yaml'), man);
const fixture = process.env.CADKIT_TOLERANCES;
const profRes = [];
for (const [label, p] of [['example profile', path.join(KIT, '..', '..', '..', 'profiles', 'example-p1s-pla.yaml')],
  ['missing profile', path.join(tmp, 'does-not-exist.yaml')]]) {
  process.env.CADKIT_TOLERANCES = p;
  await run(['validate', tmp]);
  const r = JSON.parse(fs.readFileSync(path.join(tmp, 'validation', 'report.json'), 'utf8'));
  profRes.push([label, r.verdict === 'NOT READY' && r.rows.some((x) => x.status === 'FAIL' && x.check.includes('tolerance table')), r.verdict]);
}
process.env.CADKIT_TOLERANCES = fixture;
const profOk = profRes.every(([, ok]) => ok);
if (!profOk) misses++;
rows.push(['profile', 'an uncalibrated or missing tolerance profile blocks validation',
  profOk ? 'CAUGHT' : 'MISSED', profRes.map(([l, , v]) => `${l}: ${v}`).join('<br>'), '']);
fs.rmSync(tmp, { recursive: true, force: true });

const md = [
  '# Validator test results',
  '',
  `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}, ${((Date.now() - t0) / 1000).toFixed(0)} s. ` +
  `${rows.length - misses} of ${rows.length} cases behave as expected.`,
  '',
  'Test design: Arduino Uno R3 enclosure (`uno_box/build.py`), base + screwed lid, USB-B and DC openings, cable exit. ' +
  'Each variant introduces ONE defect; the validator must catch it with the check meant for it.',
  '',
  '| Case | Defect | Result | Evidence | Report |', '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(HERE, 'RESULTS.md'), md);
console.log(md);
process.exit(misses ? 1 : 0);
