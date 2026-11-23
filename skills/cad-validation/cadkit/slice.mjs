// Slice each STL of a version with Bambu Studio's command line (tested on
// Bambu Studio 02.08.02.61) and report what the slicer saw.
//
// Uses the SYSTEM presets: Bambu Lab P1S 0.4 nozzle, 0.20mm Standard @BBL X1C,
// Bambu PLA Basic @BBL P1S 0.4 nozzle. The CLI does not resolve every
// inherited value (it reports 2 walls / 20 % infill and 0 g), so: time and
// layer count are the slicer's, grams are computed from filament length, and
// your own Studio presets (walls, infill) will change the time.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const presetsIn = (SYS) => ({
  machine: path.join(SYS, 'machine', 'Bambu Lab P1S 0.4 nozzle.json'),
  process: path.join(SYS, 'process', '0.20mm Standard @BBL X1C.json'),
  filament: path.join(SYS, 'filament', 'Bambu PLA Basic @BBL P1S 0.4 nozzle.json'),
});
const DENSITY = { PLA: 1.24 };

export async function slice(dir, { BAMBU, SYS }) {
  if (!BAMBU || !SYS) { console.error('Bambu Studio or its presets not found: set bambu_studio / bambu_presets in config.yaml'); return 3; }
  const PRESETS = presetsIn(SYS);
  for (const p of Object.values(PRESETS)) if (!fs.existsSync(p)) { console.error(`preset missing: ${p}`); return 3; }
  const stlDir = path.join(dir, 'stl');
  if (!fs.existsSync(stlDir)) { console.error(`no stl/ in ${dir}`); return 3; }
  const out = path.join(dir, 'validation', 'slice');
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const f of fs.readdirSync(stlDir).filter((x) => x.toLowerCase().endsWith('.stl'))) {
    const od = path.join(out, path.basename(f, '.stl'));
    fs.rmSync(od, { recursive: true, force: true });
    fs.mkdirSync(od, { recursive: true });
    const r = spawnSync(BAMBU, ['--slice', '0', '--arrange', '1',
      '--load-settings', `${PRESETS.machine};${PRESETS.process}`,
      '--load-filaments', PRESETS.filament,
      '--outputdir', od, '--export-3mf', 'sliced.3mf', path.join(stlDir, f)],
    { encoding: 'utf8', timeout: 15 * 60 * 1000 });
    const rj = path.join(od, 'result.json');
    if (!fs.existsSync(rj)) { rows.push({ part: f, status: 'NOT TESTED', note: `slicer wrote no result (exit ${r.status})` }); continue; }
    const res = JSON.parse(fs.readFileSync(rj, 'utf8'));
    const pl = (res.sliced_plates || [])[0] || {};
    const g = path.join(od, 'plate_1.gcode');
    let len = 0, layers = 0;
    if (fs.existsSync(g)) {
      const head = fs.readFileSync(g, 'utf8').slice(0, 4000);
      len = Number((head.match(/total filament length \[mm\] : ([0-9.]+)/) || [])[1] || 0);
      layers = Number((head.match(/total layer number: (\d+)/) || [])[1] || 0);
    }
    const grams = len * Math.PI * 0.875 * 0.875 / 1000 * DENSITY.PLA;
    const warn = (pl.warning_message || '').trim();
    rows.push({
      part: f, status: res.return_code === 0 ? (warn ? 'WARNING' : 'PASS') : 'FAIL',
      minutes: Math.round((pl.total_predication || 0) / 60), grams: Math.round(grams * 10) / 10, layers,
      bridge_s: Math.round((pl.feature_type_times || {}).Bridge || 0),
      note: res.return_code === 0 ? (warn || 'sliced without warnings') : res.error_string,
    });
  }
  const md = ['# Slicer check (Bambu Studio CLI, P1S 0.4, PLA, system presets)', '',
    '| Part | Status | Time | Filament | Layers | Bridging | Slicer says |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.part} | ${r.status} | ${r.minutes ?? '-'} min | ${r.grams ?? '-'} g | ${r.layers ?? '-'} | ${r.bridge_s ?? '-'} s | ${r.note} |`),
    '', 'Time is for 2 walls / 20 % infill (the CLI preset); expect more with your settings. ' +
    'Supports are off in the preset, so the slicer does not judge overhangs: that is the validator\'s ' +
    '`self-supporting` check. Open `sliced.3mf` in Studio for the layer-by-layer preview.', ''].join('\n');
  fs.writeFileSync(path.join(out, 'slice.md'), md);
  fs.writeFileSync(path.join(out, 'slice.json'), JSON.stringify(rows, null, 1));
  console.log(md);
  return rows.some((r) => r.status === 'FAIL') ? 1 : 0;
}
