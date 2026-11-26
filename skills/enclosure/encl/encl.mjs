#!/usr/bin/env node
// encl - enclosure layout from a project.yaml: where each part goes, which openings the box
// needs, how big it gets. FreeCAD builds the geometry from it; cadkit validates that.
//
//   node encl.mjs plan <project> [--json]             layout, openings, size, warnings
//   node encl.mjs plan <project> --write <folder>     layout.yaml + LAYOUT.md + layout.svg into a CAD version folder
//
// Per component in project.yaml (all optional):
//   cad: <library id>      envelope, mounting holes and connectors from the cadkit component library
//   dims_mm: [l, w, h]     a plain box when there is no library file ({v: [...], src: ...} also works)
//   mount: inside | lid | wall | outside | none     (default inside; the controller is always inside)
//   access: [usb_b]        connectors that must be reachable from outside (controller default: its usb*)
//   exit: +x | -x | +y | -y                         wall for the cable of an `outside` part (default +x)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../../project/projkit/vendor/js-yaml.mjs';
import { load, resolveFile } from '../../project/projkit/projkit.mjs';
import { loadConfig } from '../../cad-validation/cadkit/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', '..', 'cad-validation', 'cadkit', 'library', 'components');
const isNone = (v) => v === undefined || v === null || v === 'none' || (Array.isArray(v) && v.length === 0);
const list = (v) => (isNone(v) ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const r1 = (x) => Math.round(x * 10) / 10;

// Defaults; every one is reported so the designer can see and change it.
export const DEFAULTS = {
  wall: 2.4, floor: 2.0, lid: 2.5,     // mm; walls >= 2x the profile's warn_wall
  gap: 4.0,                            // between parts: fingers, jumper wires, screwdriver
  margin: 3.0,                         // part to inner wall
  connector_margin: 0.5,               // accessed connector body to the inner wall
  top_room: 4.0,                       // above the tallest part (wires bend over it)
  standoff_min: 5.0,                   // floor to the underside of a board with a solder-side keepout
  opening_clear: 1.0,                  // per side around a plug
  cable_d: 6.0,                        // cable exit hole for an outside part
};

// ---------------------------------------------------------------------------
// library envelope: evaluate the dims expressions, collect boxes
export function libPart(id) {
  const f = path.join(LIB, `${id}.yaml`);
  if (!fs.existsSync(f)) return null;
  const d = yaml.load(fs.readFileSync(f, 'utf8'));
  const dims = Object.fromEntries(Object.entries(d.dims || {}).map(([k, v]) => [k, typeof v === 'object' ? Number(v.v) : Number(v)]));
  const ev = (x) => {
    if (typeof x === 'number') return x;
    const s = String(x);
    if (!/^[\sA-Za-z0-9_.+\-*/()]*$/.test(s)) throw new Error(`bad expression ${s} in ${id}`);
    const js = s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => { if (!(n in dims)) throw new Error(`dimension ${n} not in ${id}`); return `(${dims[n]})`; });
    return Function(`"use strict"; return (${js});`)();
  };
  const boxOf = (spec) => {
    if (spec.box) { const mn = spec.box.min.map(ev), sz = spec.box.size.map(ev); return { min: mn, max: mn.map((m, i) => m + sz[i]) }; }
    if (spec.cyl) {
      const b = spec.cyl.base.map(ev), dir = spec.cyl.dir.map(Number), dd = ev(spec.cyl.d) / 2, h = ev(spec.cyl.h);
      const e = b.map((x, i) => x + dir[i] * h);
      return { min: b.map((x, i) => Math.min(x, e[i]) - (dir[i] ? 0 : dd)), max: b.map((x, i) => Math.max(x, e[i]) + (dir[i] ? 0 : dd)) };
    }
    return null;
  };
  const bodies = list(d.bodies).map((b) => ({ name: b.name, ...boxOf(b) })).filter((b) => b.min);
  const keepouts = list(d.keepouts).map((b) => ({ name: b.name, ...boxOf(b) })).filter((b) => b.min);
  const holes = list(d.bodies).flatMap((b) => list(b.holes).map((h) => ({ at: h.at.map(ev), d: ev(h.d) })));
  const connectors = list(d.connectors).map((c) => ({ name: c.name, face: c.face.map(Number), plug: c.plug ? boxOf(c.plug) : null }));
  return { id, name: d.name, bodies, keepouts, holes, connectors };
}

const union = (boxes) => boxes.reduce((a, b) => (!a ? { min: [...b.min], max: [...b.max] } : { min: a.min.map((x, i) => Math.min(x, b.min[i])), max: a.max.map((x, i) => Math.max(x, b.max[i])) }), null);
// rotate a point about z by deg (multiples of 90)
const rotz = (p, deg) => { const k = ((deg / 90) % 4 + 4) % 4; let [x, y] = p; for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y, p[2]]; };
const rotBox = (b, deg) => union([[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.min[0], b.max[1]], [b.max[0], b.max[1]]].map(([x, y]) => {
  const q = rotz([x, y, 0], deg); return { min: [q[0], q[1], b.min[2]], max: [q[0], q[1], b.max[2]] };
}));
const FACE = { '-x': [-1, 0, 0], '+x': [1, 0, 0], '-y': [0, -1, 0], '+y': [0, 1, 0] };
const faceName = (f) => Object.entries(FACE).find(([, v]) => v[0] === Math.round(f[0]) && v[1] === Math.round(f[1]))?.[0] || 'top';
// smallest z rotation that turns face f into want
function turn(f, want) { for (const deg of [0, 90, 180, 270]) { const q = rotz(f, deg); if (Math.round(q[0]) === want[0] && Math.round(q[1]) === want[1]) return deg; } return 0; }

// ---------------------------------------------------------------------------
export function plan(p, opts = {}) {
  const D = { ...DEFAULTS, ...(opts.defaults || {}) };
  const R = [];
  const add = (level, msg) => R.push({ level, msg });
  const ctrl = str(p.controller);
  const parts = [];
  for (const c of list(p.components)) {
    const id = str(c.id);
    const mount = id === ctrl ? 'inside' : str(c.mount) || (['motor', 'pump', 'solenoid'].includes(str(c.type)) ? 'outside' : 'inside');
    if (mount === 'none') continue;
    let env = null, lib = null, src = '';
    if (!isNone(c.cad)) {
      lib = libPart(str(c.cad));
      if (!lib) add('FAIL', `${id}: cad "${c.cad}" is not in the component library`);
      else { env = union([...lib.bodies, ...lib.keepouts]); src = `library ${lib.id}`; }
    }
    if (!env && !isNone(c.dims_mm)) {
      const dm = Array.isArray(c.dims_mm) ? c.dims_mm : c.dims_mm.v;
      env = { min: [0, 0, 0], max: dm.map(Number) };
      src = `dims_mm (${str(c.dims_mm.src) || 'no source'})`;
      if (str(c.dims_mm.src) === 'ASSUMED' || !c.dims_mm.src) add('WARNING', `${id}: size ${dm.join(' x ')} mm is not measured: measure it before the CAD is final`);
    }
    if (!env && mount === 'outside') { env = { min: [0, 0, 0], max: [0, 0, 0] }; src = 'outside: only its cable comes in'; }
    if (!env) { add('FAIL', `${id}: no size (cad: <library id> or dims_mm: [l, w, h]): it cannot be placed`); continue; }
    for (let i = 0; i < Number(c.qty || 1); i++) parts.push({ id: Number(c.qty) > 1 ? `${id}#${i + 1}` : id, c, lib, env, src, mount });
  }

  // --- inside: controller first, its accessed connector toward -x; then the rest, largest first
  const inside = parts.filter((x) => x.mount === 'inside');
  const ctrlPart = inside.find((x) => x.c.id === ctrl);
  const access = (x) => {
    const want = list(x.c.access).map(str);
    const cons = x.lib ? x.lib.connectors : [];
    const picked = want.length ? cons.filter((k) => want.includes(k.name)) : x.c.id === ctrl ? cons.filter((k) => /usb/i.test(k.name)) : [];
    for (const w of want) if (!cons.some((k) => k.name === w)) add('FAIL', `${x.id}: access "${w}" is not a connector of ${x.lib ? x.lib.id : 'a part without a library file'}`);
    return picked;
  };
  const placed = [];
  const order = [...inside].sort((a, b) => (a === ctrlPart ? -1 : b === ctrlPart ? 1 : (b.env.max[0] - b.env.min[0]) * (b.env.max[1] - b.env.min[1]) - (a.env.max[0] - a.env.min[0]) * (a.env.max[1] - a.env.min[1])));
  const areaSum = order.reduce((s, x) => s + (x.env.max[0] - x.env.min[0] + D.gap) * (x.env.max[1] - x.env.min[1] + D.gap), 0);
  const widest = Math.max(0, ...order.map((x) => Math.max(x.env.max[0] - x.env.min[0], x.env.max[1] - x.env.min[1])));
  const rowLen = Math.max(widest, Math.sqrt(areaSum * 1.4));
  let cx = 0, cy = 0, rowH = 0;
  for (const x of order) {
    const acc = access(x);
    let deg = 0;
    if (acc.length) deg = turn(acc[0].face, FACE['-x']);
    else { const w = x.env.max[0] - x.env.min[0], h = x.env.max[1] - x.env.min[1]; if (h > w && h > rowLen - cx) deg = 90; }
    const rb = rotBox(x.env, deg);
    const under = x.lib && x.lib.keepouts.some((k) => k.min[2] < 0) ? Math.max(D.standoff_min, -Math.min(...x.lib.keepouts.map((k) => k.min[2])) + 3) : 0;
    const w = rb.max[0] - rb.min[0], h = rb.max[1] - rb.min[1];
    // a part whose connector must reach the -x wall starts a new row at x = 0
    if (cx > 0 && (acc.length || cx + w > rowLen)) { cx = 0; cy += rowH + D.gap; rowH = 0; }
    // z: a board with a solder-side keepout sits on standoffs (its z = 0 at the standoff top),
    // anything else stands on the floor
    const pz = under ? under : -x.env.min[2];
    // rows without a wall connector keep the normal margin from the -x wall
    if (cx === 0 && !acc.length) cx = D.margin - D.connector_margin;
    // jumper wires / plugs going UP out of a part that is wired (headers) need their room too
    const wired = list(p.pins).some((e) => str(e.to).split('.')[0] === x.c.id) || x.c.id === ctrl;
    const upPlug = x.lib && wired ? Math.max(-Infinity, ...x.lib.connectors.filter((k) => k.face[2] === 1 && k.plug).map((k) => k.plug.max[2])) : -Infinity;
    const pos = [cx - rb.min[0], cy - rb.min[1], pz];
    const box = { min: [cx, cy, pz + x.env.min[2]], max: [cx + w, cy + h, pz + Math.max(x.env.max[2], upPlug)] };
    placed.push({ ...x, deg, pos, box, under, access: acc });
    cx += w + D.gap; rowH = Math.max(rowH, h);
  }

  // --- the box
  const all = union(placed.map((x) => x.box)) || { min: [0, 0, 0], max: [0, 0, 0] };
  // the controller's connector side touches the wall (connector_margin), every other side gets margin
  const inner = {
    x0: Math.min(...placed.map((x) => x.box.min[0] - (x.access.length ? D.connector_margin : D.margin)), 0), x1: all.max[0] + D.margin,
    y0: all.min[1] - D.margin, y1: all.max[1] + D.margin, z0: 0, z1: all.max[2] + D.top_room,
  };
  // shift everything so the inner box starts at (wall, wall, floor) in the assembly frame
  const sh = [D.wall - inner.x0, D.wall - inner.y0, D.floor];
  for (const x of placed) { x.pos = x.pos.map((v, i) => r1(v + sh[i])); x.box = { min: x.box.min.map((v, i) => r1(v + sh[i])), max: x.box.max.map((v, i) => r1(v + sh[i])) }; }
  const innerSize = [inner.x1 - inner.x0, inner.y1 - inner.y0, inner.z1 - inner.z0].map(r1);
  const outer = [innerSize[0] + 2 * D.wall, innerSize[1] + 2 * D.wall, innerSize[2] + D.floor + D.lid].map(r1);

  // --- openings
  const openings = [];
  for (const x of placed) for (const k of x.access) {
    if (!k.plug) continue;
    // plug box in the assembly frame
    const pb = rotBox(k.plug, x.deg);
    const q = { min: pb.min.map((v, i) => v + x.pos[i]), max: pb.max.map((v, i) => v + x.pos[i]) };
    const wall = faceName(rotz(k.face, x.deg));
    const ax = wall.endsWith('x') ? 1 : 0; // the other horizontal axis spans the opening
    openings.push({ for: `${x.id}.${k.name}`, wall, kind: 'connector',
      center: [r1((q.min[ax] + q.max[ax]) / 2), r1((q.min[2] + q.max[2]) / 2)],
      size: [r1(q.max[ax] - q.min[ax] + 2 * D.opening_clear), r1(q.max[2] - q.min[2] + 2 * D.opening_clear)],
      note: 'centre = [along the wall, height above the bottom of the box]' });
  }
  const lidParts = parts.filter((x) => x.mount === 'lid');
  for (const x of lidParts) {
    const s = [x.env.max[0] - x.env.min[0], x.env.max[1] - x.env.min[1]].map(r1);
    const kind = { display: 'window (visible area + 1 mm, module screwed or clipped under the lid)', button: 'hole for the button cap', led: 'hole for the LED (5 mm LED: 5.2 mm)' }[str(x.c.type)] || 'cut-out';
    openings.push({ for: x.id, wall: 'lid', kind, size: s, note: 'position on the lid is free: put it where the user looks or presses' });
  }
  const outside = parts.filter((x) => x.mount === 'outside' || x.mount === 'wall');
  for (const x of outside) {
    const wall = str(x.c.exit) || '+x';
    openings.push({ for: x.id, wall, kind: x.mount === 'wall' ? 'part mounted in the wall' : 'cable exit (grommet or strain relief)', size: x.mount === 'wall' ? [x.env.max[1] - x.env.min[1], x.env.max[2] - x.env.min[2]].map(r1) : [D.cable_d], note: '' });
  }
  const src = p.power && p.power.source;
  const ctrlUsbPowered = placed.some((x) => x.access.some((k) => /usb|dc/i.test(k.name)));
  if (src && !isNone(src) && !ctrlUsbPowered) openings.push({ for: 'power', wall: '+x', kind: 'power cable exit or panel jack', size: [D.cable_d], note: str(src.part) });
  else if (src && !isNone(src) && !/usb/i.test(str(src.part)) && list(p.wires).some((w) => /supply/.test(`${w.from} ${w.to}`))) {
    openings.push({ for: 'power', wall: '+x', kind: 'power cable exit or panel jack (the supply feeds more than the board)', size: [D.cable_d], note: str(src.part) });
  }

  // --- heat, printer, sanity
  const hot = list(p.components).filter((c) => ['driver', 'power'].includes(str(c.type)) || Number(c.power && (c.power.peak_ma ?? c.power.ma)) >= 500);
  if (hot.length) add('WARNING', `vents needed: ${hot.map((c) => c.id).join(', ')} get warm (driver / regulator / >= 500 mA). Slots near them, low in one wall and high in the opposite`);
  const bed = bedSize(opts.printer || str(p.mechanics && p.mechanics.printer));
  if (!bed) add('NOT TESTED', 'printer build volume unknown (mechanics.printer): size not checked');
  else if (outer[0] > bed[0] || outer[1] > bed[1] || outer[2] > bed[2]) add('FAIL', `outer ${outer.join(' x ')} mm does not fit the ${bed.join(' x ')} mm build volume: split the box or rearrange`);
  else add('PASS', `outer ${outer.join(' x ')} mm fits the ${bed.join(' x ')} mm build volume`);
  const lim = p.idea && p.idea.constraints && p.idea.constraints.size_mm;
  if (Array.isArray(lim)) {
    const over = outer.map((v, i) => v > Number(lim[i])).some(Boolean);
    add(over ? 'FAIL' : 'PASS', `outer ${outer.join(' x ')} mm ${over ? 'exceeds' : 'is within'} idea.constraints.size_mm ${lim.join(' x ')}`);
  }
  for (const x of placed) {
    if (x.lib && x.lib.holes.length) add('INFO', `${x.id}: ${x.lib.holes.length} mounting holes (d ${x.lib.holes[0].d}) from the library: standoffs ${r1(x.under || D.standoff_min)} mm${x.lib.keepouts.length ? ', solder side kept clear' : ''}`);
    else add('INFO', `${x.id}: no mounting holes known: a slot, clip rails or a printed cradle (and say which)`);
  }
  if (!placed.length) add('FAIL', 'nothing to put inside');
  return { defaults: D, inner: innerSize, outer, parts: placed.map(({ id, c, src, deg, pos, box, under, access: a }) => ({ id, part: str(c.part), ref: str(c.cad) || null, size_from: src, rot_z: deg, pos, box, standoff: under || null, access: a.map((k) => k.name) })), lid: lidParts.map((x) => x.id), outside: outside.map((x) => x.id), openings, results: R };
}

export function bedSize(printer) {
  const s = str(printer).toLowerCase();
  if (/a1\s*mini/.test(s)) return [180, 180, 180];
  if (/bambu|p1s|p1p|x1|a1|p2s/.test(s)) return [256, 256, 256];
  if (/ender\s*3/.test(s)) return [220, 220, 250];
  if (/prusa|mk4|mk3/.test(s)) return [250, 210, 220];
  return null;
}

// manifest block (cadkit.yaml `components:`) for the placed library parts
export function manifestComponents(L) {
  return L.parts.filter((x) => x.ref).map((x) => ({
    id: x.id.replace('#', '-'), ref: x.ref,
    placement: { pos: x.pos, rot: x.rot_z ? [[[0, 0, 1], x.rot_z]] : [] },
    connectors_used: x.access.length ? x.access : 'none',
  }));
}

export function svg(L) {
  const W = L.outer[0], H = L.outer[1], s = Math.min(6, 700 / Math.max(W, H)), pad = 20;
  const X = (v) => pad + v * s, Y = (v) => pad + (H - v) * s;
  const el = [`<svg xmlns="http://www.w3.org/2000/svg" width="${r1(W * s + 2 * pad)}" height="${r1(H * s + 2 * pad + 20)}" font-family="sans-serif" font-size="11">`,
    `<rect x="${X(0)}" y="${Y(H)}" width="${W * s}" height="${H * s}" fill="#eee" stroke="#333" stroke-width="2"/>`,
    `<rect x="${X(L.defaults.wall)}" y="${Y(H - L.defaults.wall)}" width="${L.inner[0] * s}" height="${L.inner[1] * s}" fill="#fff" stroke="#999"/>`];
  for (const x of L.parts) {
    el.push(`<rect x="${X(x.box.min[0])}" y="${Y(x.box.max[1])}" width="${(x.box.max[0] - x.box.min[0]) * s}" height="${(x.box.max[1] - x.box.min[1]) * s}" fill="#cfe3ff" stroke="#2b6cb0"/>`);
    el.push(`<text x="${X(x.box.min[0]) + 4}" y="${Y(x.box.max[1]) + 14}">${x.id}</text>`);
  }
  for (const o of L.openings.filter((o) => o.wall === '-x' && o.kind === 'connector')) {
    el.push(`<rect x="${X(0)}" y="${Y(o.center[0] + o.size[0] / 2)}" width="${L.defaults.wall * s}" height="${o.size[0] * s}" fill="#e53e3e"/>`);
  }
  el.push(`<text x="${pad}" y="${H * s + 2 * pad + 12}">Top view, ${L.outer.join(' x ')} mm outside. Blue: parts. Red: wall openings.</text>`, '</svg>');
  return el.join('\n');
}

export function markdown(p, L) {
  const lines = [`# Enclosure layout: ${str(p.title) || p.project}`, '',
    'Generated by encl from project.yaml. It decides where parts go and which openings the box needs; the geometry is built in FreeCAD from `layout.yaml` and validated by cadkit.', '',
    `**Outside:** ${L.outer.join(' × ')} mm · **inside:** ${L.inner.join(' × ')} mm · wall ${L.defaults.wall}, floor ${L.defaults.floor}, lid ${L.defaults.lid} mm`, '',
    '![top view](layout.svg)', '', '## Parts inside', '', '| Part | Size from | Position (mm) | Turned | Standoffs | Reached from outside |', '|---|---|---|---|---|---|'];
  for (const x of L.parts) lines.push(`| ${x.id}: ${x.part} | ${x.size_from} | ${x.pos.join(', ')} | ${x.rot_z}° | ${x.standoff ? x.standoff + ' mm' : '-'} | ${x.access.join(', ') || '-'} |`);
  lines.push('', '## Openings', '', '| For | Where | What | Size (mm) |', '|---|---|---|---|');
  for (const o of L.openings) lines.push(`| ${o.for} | ${o.wall} | ${o.kind} | ${o.size.join(' × ')}${o.center ? ` at ${o.center.join(', ')}` : ''} |`);
  lines.push('', '## Notes', '', ...L.results.map((r) => `- **${r.level}** ${r.msg}`), '');
  return lines.join('\n');
}

function print(L) {
  console.log(`outer ${L.outer.join(' x ')} mm, inner ${L.inner.join(' x ')} mm`);
  for (const x of L.parts) console.log(`  ${x.id.padEnd(12)} pos ${x.pos.join(', ')}  rot ${x.rot_z}°${x.standoff ? `  standoff ${x.standoff}` : ''}${x.access.length ? `  -> ${x.access.join(', ')}` : ''}  (${x.size_from})`);
  for (const o of L.openings) console.log(`  opening ${o.wall.padEnd(4)} ${o.for}: ${o.kind} ${o.size.join(' x ')}${o.center ? ` at ${o.center.join(', ')}` : ''}`);
  for (const r of L.results) console.log(`${r.level.padEnd(10)} ${r.msg}`);
}

function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const flag = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] ?? true : null; };
  if (cmd !== 'plan') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
  const f = resolveFile(arg);
  if (!f || !fs.existsSync(f)) { console.error(`no project.yaml at ${arg}`); process.exit(2); }
  const p = load(f);
  let printer = str(p.mechanics && p.mechanics.printer);
  if (!printer) { try { const tol = loadConfig().tolerances; if (tol && fs.existsSync(tol)) printer = str(yaml.load(fs.readFileSync(tol, 'utf8')).printer); } catch { /* none */ } }
  const L = plan(p, { printer });
  const fails = L.results.some((r) => r.level === 'FAIL');
  if (rest.includes('--json')) console.log(JSON.stringify(L, null, 2)); else print(L);
  const out = flag('--write');
  if (typeof out === 'string') {
    const dir = path.resolve(out); fs.mkdirSync(dir, { recursive: true });
    const doc = { generated_by: 'encl from project.yaml - regenerate, do not edit', project: p.project, printer: printer || null, ...L, manifest_components: manifestComponents(L) };
    fs.writeFileSync(path.join(dir, 'layout.yaml'), yaml.dump(doc, { lineWidth: 140, noRefs: true }));
    fs.writeFileSync(path.join(dir, 'LAYOUT.md'), markdown(p, L));
    fs.writeFileSync(path.join(dir, 'layout.svg'), svg(L));
    console.log(`\nwrote ${path.join(dir, 'layout.yaml')}, LAYOUT.md, layout.svg`);
  }
  process.exit(fails ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
