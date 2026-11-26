#!/usr/bin/env node
// projkit - the project file (project.yaml) that ties idea, electronics, CAD and firmware together.
//
//   node projkit.mjs new <folder> [--title "..."]   create <folder>/project.yaml from the template
//   node projkit.mjs check <folder|file> [--json]   sections, references, pins, power budget, phase gates
//   node projkit.mjs status <folder|file>            one line: phase, gate, next step
//   node projkit.mjs plan <folder|file> [--json]    build steps in order, what is next, what to buy
//   node projkit.mjs wiring <folder|file> [--write [F]] wiring tables + Mermaid diagram (default WIRING.md)
//   node projkit.mjs needs <folder|file> [--write F] the components as an inventory project file
//   node projkit.mjs boards                          the pin tables in boards/
//
// Exit codes: 0 no FAIL, 1 at least one FAIL, 2 usage or unreadable file.
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from './vendor/js-yaml.mjs';
import { loadConfig } from '../../cad-validation/cadkit/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARDS = path.join(HERE, 'boards');
const TEMPLATE = path.join(HERE, 'templates', 'project.yaml');

export const PHASES = ['idea', 'electronics', 'cad', 'firmware', 'build', 'done'];
const ALL_PHASES = [...PHASES, 'paused'];
const SECTIONS = ['project', 'title', 'phase', 'next_step', 'idea', 'concepts', 'chosen', 'functions',
  'controller', 'components', 'pins', 'power', 'mechanics', 'firmware', 'plan', 'open_questions', 'decisions'];
export const STEP_KINDS = ['buy', 'print', 'test', 'solder', 'wire', 'assemble', 'flash', 'calibrate', 'measure'];
const KINDS = ['sense', 'actuate', 'display', 'input', 'control', 'power', 'comms', 'structure'];
const STATUSES = ['CANDIDATE', 'DECIDED', 'OWNED', 'BOUGHT'];
const CAPS = ['digital', 'analog', 'pwm', 'interrupt', 'i2c', 'spi', 'uart'];
// Template text that means "not filled in".
const PLACEHOLDERS = [/^My project$/i, /^What is annoying, missing or fun\?/i, /^Something it must do$/i,
  /^The one concrete thing to do next\.?$/i, /^example-function$/, /^Know when X happens$/, /^One line$/];

const isNone = (v) => v === undefined || v === null || v === 'none' || (Array.isArray(v) && v.length === 0);
const list = (v) => (isNone(v) ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const placeholder = (v) => PLACEHOLDERS.some((re) => re.test(str(v)));

export function resolveFile(arg) {
  if (!arg) return null;
  const p = path.resolve(arg);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return path.join(p, 'project.yaml');
  return p;
}

export function load(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

export function loadBoard(id) {
  const f = path.join(BOARDS, `${id}.yaml`);
  return fs.existsSync(f) ? yaml.load(fs.readFileSync(f, 'utf8')) : null;
}

// "9" / "d9" / "D09" -> "D9"; "a0" -> "A0"; "5v" -> "5V"; "3.3V" -> "3V3"
export function normPin(p) {
  let s = str(p).toUpperCase().replace(/\s+/g, '');
  if (/^\d+$/.test(s)) s = 'D' + s;
  s = s.replace(/^([DA])0+(\d)/, '$1$2');
  if (s === '3.3V' || s === '3V') s = '3V3';
  return s;
}

// ---------------------------------------------------------------------------
export function check(p, file = '') {
  const R = [];
  const add = (level, area, msg) => R.push({ level, area, msg });
  const PASS = (a, m) => add('PASS', a, m), FAIL = (a, m) => add('FAIL', a, m),
    WARN = (a, m) => add('WARNING', a, m), NT = (a, m) => add('NOT TESTED', a, m);

  if (!p || typeof p !== 'object') { FAIL('file', 'not a YAML mapping'); return finish(R, p); }

  // --- sections
  const missing = SECTIONS.filter((s) => !(s in p));
  if (missing.length) FAIL('file', `missing sections: ${missing.join(', ')} (write "none" for an empty one)`);
  else PASS('file', 'all sections present');

  const dir = path.basename(path.dirname(file || '.'));
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(str(p.project))) FAIL('file', `project id "${str(p.project)}" is not kebab-case`);
  else if (file && dir !== p.project) WARN('file', `project id "${p.project}" differs from the folder name "${dir}"`);

  const phase = str(p.phase);
  if (!ALL_PHASES.includes(phase)) FAIL('phase', `phase "${phase}" is not one of ${ALL_PHASES.join(' | ')}`);
  for (const k of ['title', 'next_step']) if (placeholder(p[k]) || !str(p[k])) WARN('file', `${k} is still the template text`);

  // --- idea
  const idea = p.idea || {};
  const ideaProblems = [];
  if (!str(idea.problem) || placeholder(idea.problem)) ideaProblems.push('idea.problem is empty or template text');
  const must = list(idea.must).filter((m) => !placeholder(m));
  if (!must.length) ideaProblems.push('idea.must has no real requirement');
  const vague = must.filter((m) => /\b(works?( well)?|good|nice|fungerar( bra)?|bra|snygg)\s*$/i.test(str(m)));
  if (vague.length) WARN('idea', `must items that cannot be tested: ${vague.map((v) => `"${v}"`).join(', ')}`);
  const cons = idea.constraints || {};
  const unknownC = Object.entries(cons).filter(([, v]) => str(v) === 'unknown').map(([k]) => k);
  if (unknownC.length) WARN('idea', `constraints still unknown: ${unknownC.join(', ')}`);

  // --- concepts
  const concepts = list(p.concepts).filter((c) => c && !placeholder(c.summary));
  const cIds = concepts.map((c) => str(c.id));
  if (new Set(cIds).size !== cIds.length) FAIL('concepts', 'concept ids are not unique');
  if (concepts.length === 1) WARN('concepts', 'only one concept: was a genuinely different way considered?');
  const chosen = str(p.chosen);
  if (!isNone(p.chosen) && !cIds.includes(chosen)) FAIL('concepts', `chosen "${chosen}" is not a concept id`);
  if (isNone(p.chosen)) ideaProblems.push('no concept chosen');

  // --- components
  const comps = list(p.components);
  const byId = new Map();
  for (const c of comps) {
    const id = str(c && c.id);
    if (!id) { FAIL('components', `a component has no id: ${JSON.stringify(c)}`); continue; }
    if (byId.has(id)) FAIL('components', `duplicate component id "${id}"`);
    byId.set(id, c);
    if (!str(c.part)) FAIL('components', `${id}: no part`);
    else if ((str(c.part).match(/\(/g) || []).length !== (str(c.part).match(/\)/g) || []).length) WARN('components', `${id}: part "${c.part}" looks cut off: a comma inside {...} needs quotes around the name`);
    if (!STATUSES.includes(str(c.status))) FAIL('components', `${id}: status "${str(c.status)}" is not one of ${STATUSES.join(' | ')}`);
    for (const n of list(c.needs)) if (!CAPS.includes(str(n))) WARN('components', `${id}: unknown need "${n}"`);
  }

  // --- functions
  const funcs = list(p.functions).filter((f) => f && !placeholder(f.id));
  if (!funcs.length) ideaProblems.push('no functions listed');
  const unsolved = [];
  for (const f of funcs) {
    if (!KINDS.includes(str(f.kind))) FAIL('functions', `${f.id}: kind "${str(f.kind)}" is not one of ${KINDS.join(' | ')}`);
    const by = list(f.by);
    for (const b of by) if (!byId.has(str(b)) && str(f.kind) !== 'structure') FAIL('functions', `${f.id}: by "${b}" is not a component id`);
    if (!by.length && str(f.kind) !== 'structure') unsolved.push(f.id);
  }
  if (funcs.length && !unsolved.length) PASS('functions', `${funcs.length} functions, all have a component`);
  else if (unsolved.length) add(phaseAtLeast(phase, 'electronics') ? 'WARNING' : 'INFO', 'functions', `not solved yet: ${unsolved.join(', ')}`);

  // --- controller + board
  let board = null;
  const ctrlId = str(p.controller);
  if (!isNone(p.controller)) {
    const ctrl = byId.get(ctrlId);
    if (!ctrl) FAIL('controller', `controller "${ctrlId}" is not a component id`);
    else if (!ctrl.board) NT('pins', `${ctrlId} has no board: pin checks need a pin table (one of: ${boardIds().join(', ')})`);
    else if (!(board = loadBoard(str(ctrl.board)))) NT('pins', `no pin table boards/${ctrl.board}.yaml: pins are not checked (have: ${boardIds().join(', ')})`);
  }

  // --- pins
  const pins = list(p.pins);
  const usedSignal = new Map();
  const onPin = new Map(); // pin -> [to]
  for (const e of pins) {
    const pin = normPin(e && e.pin), to = str(e && e.to);
    const [cid, sig] = to.split('.');
    if (!byId.has(cid)) FAIL('pins', `${pin} -> "${to}": "${cid}" is not a component id`);
    if (!sig) WARN('pins', `${pin} -> "${to}": no signal name (write component.signal, e.g. ${cid}.sig)`);
    if (usedSignal.has(to)) FAIL('pins', `${to} is wired to both ${usedSignal.get(to)} and ${pin}`);
    usedSignal.set(to, pin);
    if (!onPin.has(pin)) onPin.set(pin, []);
    onPin.get(pin).push({ to, cid, sig: str(sig).toLowerCase(), as: str(e.as).toLowerCase() });
  }
  if (board) {
    const bus = board.buses || {};
    const i2cPins = new Set(Object.values(bus.i2c || {}).map(normPin));
    let pinFail = false;
    for (const [pin, uses] of onPin) {
      const power = board.power_pins && board.power_pins[pin];
      const caps = (board.pins && board.pins[pin]) || null;
      if (!caps && !power) { FAIL('pins', `${pin} does not exist on ${board.id}`); pinFail = true; continue; }
      if (power) continue; // shared rails are fine; the budget is checked below
      const allI2c = uses.every((u) => ['sda', 'scl'].includes(u.sig) || u.as === 'i2c');
      if (uses.length > 1 && !(allI2c && i2cPins.has(pin))) {
        FAIL('pins', `${pin} is used by ${uses.map((u) => u.to).join(' and ')}`); pinFail = true;
      }
      for (const u of uses) {
        const want = u.as || ({ sda: 'i2c', scl: 'i2c', mosi: 'spi', miso: 'spi', sck: 'spi', rx: 'uart', tx: 'uart' })[u.sig] || '';
        if (want && !caps.includes(want)) { FAIL('pins', `${u.to} needs ${want}, but ${pin} on ${board.id} has ${caps.join('/')}`); pinFail = true; }
        const cNeeds = list(byId.get(u.cid) && byId.get(u.cid).needs).map(str);
        if (!want && !caps.includes('digital') && caps.includes('analog') && !cNeeds.includes('analog')) {
          FAIL('pins', `${pin} is analog input ONLY on ${board.id}, but ${u.cid} does not need analog (it cannot output or read digital there)`); pinFail = true;
        }
      }
      if (caps.includes('uart') && !uses.some((u) => u.as === 'uart')) WARN('pins', `${pin}: ${board.notes && board.notes.uart || 'it is the USB serial port and clashes with upload and Serial'}`);
    }
    // components that need a capability: at least one of their pins must have it
    for (const c of comps) {
      if (str(c.id) === ctrlId) continue;
      const theirPins = [...onPin].filter(([pn, us]) => board.pins[pn] && us.some((u) => u.cid === c.id)).map(([pn]) => pn);
      for (const n of list(c.needs).map(str)) {
        if (!theirPins.length) continue;
        if (!theirPins.some((pn) => (board.pins[pn] || []).includes(n))) {
          FAIL('pins', `${c.id} needs ${n}, but none of its pins (${theirPins.join(', ')}) has it on ${board.id}`); pinFail = true;
        }
      }
    }
    const unwired = comps.filter((c) => str(c.id) !== ctrlId && list(c.needs).length && ![...usedSignal.keys()].some((t) => t.split('.')[0] === c.id));
    if (unwired.length) add(phaseAtLeast(phase, 'cad') ? 'FAIL' : 'INFO', 'pins', `no pins yet for: ${unwired.map((c) => c.id).join(', ')}`);
    if (pins.length && !pinFail) PASS('pins', `${pins.length} connections on ${board.id}: no clashes, capabilities match`);
  }

  // --- power
  const ctrlComp = byId.get(ctrlId);
  const ctrlLogic = Number((board && board.logic_v) || (ctrlComp && ctrlComp.power && ctrlComp.power.logic_v)) || null;
  let total = 0, known = true;
  const noData = [];
  for (const c of comps) {
    const pw = c.power || {};
    const ma = Number(pw.peak_ma ?? pw.ma);
    if (!Number.isFinite(ma)) { if (!['button', 'passive'].includes(str(c.type))) { known = false; noData.push(c.id); } continue; }
    total += ma * (Number(c.qty) || 1);
    if (str(pw.src) === 'ASSUMED') WARN('power', `${c.id}: ${ma} mA is ASSUMED - check the datasheet`);
    const lv = Number(pw.logic_v);
    if (ctrlLogic && lv && str(c.id) !== ctrlId && Math.abs(lv - ctrlLogic) > 0.5 && [...usedSignal.keys()].some((t) => t.split('.')[0] === c.id)) {
      WARN('power', `${c.id} has ${lv} V logic, the controller ${ctrlLogic} V: needs a level shifter unless its datasheet says ${ctrlLogic} V tolerant`);
    }
  }
  if (noData.length) NT('power', `no current for: ${noData.join(', ')} (power.ma / peak_ma)`);
  const src = p.power && p.power.source;
  if (comps.length) {
    if (!src || isNone(src)) add(phaseAtLeast(phase, 'electronics') ? 'WARNING' : 'INFO', 'power', `no power source yet (components peak ≈ ${total} mA${known ? '' : ' + unknown'})`);
    else {
      const max = Number(src.max_ma);
      if (!Number.isFinite(max)) NT('power', 'power.source.max_ma is missing');
      else if (total > max) FAIL('power', `peak ${total} mA > source ${max} mA (${src.part || 'source'})`);
      else if (total > 0.8 * max) WARN('power', `peak ${total} mA is ${Math.round((100 * total) / max)} % of the source's ${max} mA (keep under 80 %)`);
      else PASS('power', `peak ${total} mA${known ? '' : ' (+ unknown)'} of ${max} mA from ${src.part || 'the source'}`);
    }
  }
  // what hangs on the board's own rails (5V / 3V3 pins)
  if (board && board.limits && board.limits.rail_ma) {
    for (const [pin, uses] of onPin) {
      const pp = board.power_pins && board.power_pins[pin];
      if (!pp || !(pp.rail in board.limits.rail_ma)) continue;
      const lim = board.limits.rail_ma[pp.rail];
      const ids = [...new Set(uses.map((u) => u.cid))];
      let sum = 0; const unk = [];
      for (const id of ids) { const c = byId.get(id); const ma = Number(c && c.power && (c.power.peak_ma ?? c.power.ma)); if (Number.isFinite(ma)) sum += ma * (Number(c.qty) || 1); else unk.push(id); }
      if (sum > lim) FAIL('power', `${pin} pin of ${board.id} feeds ${ids.join(', ')}: peak ${sum} mA > ${lim} mA it can give. Power them from the supply, not the board`);
      else if (unk.length) NT('power', `${pin} pin load unknown for: ${unk.join(', ')}`);
      else PASS('power', `${pin} pin: ${sum} mA of ${lim} mA`);
    }
  }

  // --- electrical rules over every connection (board pins + wires)
  for (const r of electrical(p, { comps, byId, ctrlId, board })) R.push(r);

  // --- build plan (order only; stock is checked by `plan`)
  if (!isNone(p.plan)) for (const r of plan(p).results) if (r.level !== 'INFO') R.push(r);

  // --- open questions
  const qs = list(p.open_questions);
  const blocking = (ph) => qs.filter((q) => str(q && q.blocks) === ph).map((q) => str(q.q));

  // --- gates: what must be true to be past each phase
  const gates = {
    idea: [...ideaProblems, ...blocking('idea').map((q) => `open question: ${q}`)],
    electronics: [
      ...(isNone(p.controller) ? ['no controller chosen'] : []),
      ...(unsolved.length ? [`functions not solved: ${unsolved.join(', ')}`] : []),
      ...comps.filter((c) => str(c.status) === 'CANDIDATE').map((c) => `${c.id} is still a CANDIDATE`),
      ...(comps.length && (!src || isNone(src)) ? ['no power source'] : []),
      ...R.filter((r) => r.level === 'FAIL' && ['pins', 'power', 'wiring', 'controller', 'components'].includes(r.area)).map((r) => r.msg),
      ...blocking('electronics').map((q) => `open question: ${q}`),
    ],
    cad: [
      ...(isNone(p.mechanics && p.mechanics.cad) ? ['mechanics.cad is none (no CAD folder yet)'] : []),
      ...blocking('cad').map((q) => `open question: ${q}`),
    ],
    firmware: [
      ...(isNone(p.firmware && p.firmware.fqbn) ? ['firmware.fqbn is none'] : []),
      ...(isNone(p.firmware && p.firmware.sketch) ? ['firmware.sketch is none'] : []),
      ...blocking('firmware').map((q) => `open question: ${q}`),
    ],
    build: blocking('build').map((q) => `open question: ${q}`),
  };
  const cadDir = p.mechanics && !isNone(p.mechanics.cad) && file ? path.resolve(path.dirname(file), str(p.mechanics.cad)) : null;
  if (cadDir && !fs.existsSync(cadDir)) gates.cad.push(`mechanics.cad folder ${p.mechanics.cad} does not exist`);
  const sk = p.firmware && !isNone(p.firmware.sketch) && file ? path.resolve(path.dirname(file), str(p.firmware.sketch)) : null;
  if (sk && !fs.existsSync(sk)) gates.firmware.push(`firmware.sketch folder ${p.firmware.sketch} does not exist`);

  // A project in phase X must have passed every gate before X.
  const at = PHASES.indexOf(phase);
  for (let i = 0; i < at; i++) {
    const g = gates[PHASES[i]];
    if (g && g.length) FAIL('phase', `phase is "${phase}" but the ${PHASES[i]} gate is closed: ${g.join('; ')}`);
  }
  const current = gates[phase] || [];
  const next = PHASES[at + 1];
  const gate = phase === 'paused' || phase === 'done' ? null
    : { from: phase, to: next, open: current.length === 0, blockers: current };
  return finish(R, p, gate);
}

// ---------------------------------------------------------------------------
// Connections: `pins` (board pin <-> component.signal) and `wires` (anything else:
// component.signal <-> component.signal, or supply.<signal> for power.source).
const VCC = /^(vcc|vdd|v\+|vin|vm|vmot|5v|3v3|\+|\+5v|\+12v|pwr|power|red)$/i;
const GND = /^(gnd|-|v-|0v|black)$/i;
const INDUCTIVE = ['motor', 'pump', 'solenoid', 'relay'];
export const TYPES = ['controller', 'sensor', 'input', 'button', 'display', 'led', 'led-strip', 'motor', 'pump',
  'solenoid', 'relay', 'servo', 'stepper', 'driver', 'module', 'buzzer', 'power', 'passive'];

export function connections(p) {
  const out = [];
  for (const e of list(p.pins)) out.push({ a: `board.${normPin(e.pin)}`, b: str(e.to), how: 'pin' });
  for (const w of list(p.wires)) out.push({ a: str(w.from), b: str(w.to), how: 'wire', note: str(w.note) });
  return out;
}

function electrical(p, { comps, byId, ctrlId, board }) {
  const R = [];
  const add = (level, msg) => R.push({ level, area: 'wiring', msg });
  const conns = connections(p);
  const isNet = (end) => end.startsWith('board.') || end.startsWith('supply.');
  for (const w of list(p.wires)) {
    for (const end of [str(w.from), str(w.to)]) {
      const [cid, sig] = end.split('.');
      if (!sig) add('FAIL', `wire end "${end}" is not component.signal (or supply.<signal>)`);
      else if (cid !== 'supply' && cid !== 'board' && !byId.has(cid)) add('FAIL', `wire end "${end}": "${cid}" is not a component id`);
      if (cid === 'board' && board && !(board.pins[normPin(sig)] || board.power_pins[normPin(sig)])) add('FAIL', `wire end "${end}": ${normPin(sig)} does not exist on ${board.id}`);
      if (cid === 'supply' && isNone(p.power && p.power.source)) add('FAIL', `wire end "${end}" uses supply, but power.source is none`);
    }
  }
  for (const c of comps) if (c.type !== undefined && !TYPES.includes(str(c.type))) add('WARNING', `${c.id}: unknown type "${c.type}" (one of ${TYPES.join(', ')})`);

  // ground nets: union-find; all gnd-like signals of one component (and the board's GND) are one node
  const parent = new Map();
  const node = (end) => {
    const [cid, sig] = end.split('.');
    if (cid === 'board') return normPin(sig) === 'GND' ? 'GND:board' : `board.${normPin(sig)}`;
    if (cid === ctrlId && GND.test(sig || '')) return 'GND:board';
    return GND.test(sig || '') ? `GND:${cid}` : end;
  };
  const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const k of conns) union(node(k.a), node(k.b));
  const groundOk = (cid) => find(`GND:${cid}`) === find('GND:board');

  const talksToBoard = (cid) => conns.some((k) => k.how === 'pin' && k.b.split('.')[0] === cid && !(board && board.power_pins[k.a.slice(6)]));
  const usesSupply = conns.some((k) => k.a.startsWith('supply.') || k.b.startsWith('supply.'));
  if (usesSupply && board && find('GND:supply') !== find('GND:board')) add('FAIL', 'the supply\'s gnd is not connected to the board\'s GND: signals have no common reference');

  const RAIL_V = { '5v': 5, '3v3': 3.3 };
  for (const c of comps) {
    const id = str(c.id);
    if (id === ctrlId || str(c.type) === 'passive') continue;
    const mine = conns.filter((k) => k.a.split('.')[0] === id || k.b.split('.')[0] === id);
    if (!mine.length) continue;
    const sigOf = (k) => (k.a.split('.')[0] === id ? k.a : k.b).split('.')[1] || '';
    const other = (k) => (k.a.split('.')[0] === id ? k.b : k.a);
    const hasPower = mine.some((k) => VCC.test(sigOf(k)));
    const hasGnd = mine.some((k) => GND.test(sigOf(k)));
    const powered = c.power && (c.power.v !== undefined || c.power.ma !== undefined);
    if (powered && !hasPower && !['led', 'button'].includes(str(c.type))) add('WARNING', `${id}: no supply connection (vcc / v+ / vin ...): how is it powered?`);
    if (powered && !hasGnd) add('FAIL', `${id}: no gnd connection`);
    else if (talksToBoard(id) && !groundOk(id)) add('FAIL', `${id} gets signals from the board but its gnd is not on the board's GND net (common ground)`);

    // voltage on the rail it hangs from
    const v = Number(c.power && c.power.v);
    for (const k of mine) {
      if (!VCC.test(sigOf(k)) || !board) continue;
      const o = other(k);
      const pp = o.startsWith('board.') && board.power_pins[o.slice(6)];
      if (pp && RAIL_V[pp.rail] && Number.isFinite(v) && Math.abs(v - RAIL_V[pp.rail]) > 0.5) {
        add('FAIL', `${id} needs ${v} V but its ${sigOf(k)} is on the board's ${o.slice(6)} pin (${RAIL_V[pp.rail]} V)`);
      }
      if (o.startsWith('supply.') && Number.isFinite(v) && p.power.source.v && Math.abs(v - Number(p.power.source.v)) > 0.5 && str(c.type) !== 'driver' && str(c.type) !== 'power') {
        add('WARNING', `${id} needs ${v} V, the supply gives ${p.power.source.v} V: is there a regulator in between?`);
      }
    }
    // inductive loads straight on a signal pin
    if (INDUCTIVE.includes(str(c.type)) && mine.some((k) => k.how === 'pin' && !(board && board.power_pins[k.a.slice(6)]))) {
      add('FAIL', `${id} is a ${c.type} on a board signal pin: a pin gives ~20 mA and the coil kicks back. Use a driver/MOSFET (+ flyback diode) or a relay module`);
    }
    if (str(c.type) === 'button' && !c.pullup) add('WARNING', `${id}: button with no pullup (internal | external): the input floats when not pressed`);
    if (str(c.type) === 'led' && !c.resistor_ohm) add('WARNING', `${id}: LED with no resistor_ohm: a bare LED on a pin burns the LED or the pin`);
  }

  // I2C addresses
  const addrs = new Map();
  for (const c of comps) for (const a of list(c.i2c_addr).map(hexAddr)) {
    if (addrs.has(a)) add('FAIL', `${c.id} and ${addrs.get(a)} both use I2C address ${a}`);
    else addrs.set(a, c.id);
  }
  if (!R.some((r) => r.level === 'FAIL') && conns.length) R.push({ level: 'PASS', area: 'wiring', msg: `${conns.length} connections: grounds common, no coil on a pin, rail voltages match` });
  return R;
}

const hexAddr = (x) => (typeof x === 'number' ? '0x' + x.toString(16).toUpperCase().padStart(2, '0') : str(x).replace(/^0x/i, '0x').toUpperCase().replace(/^0X/, '0x'));

// Wiring table + Mermaid diagram, for WIRING.md
export function wiringDoc(p) {
  const conns = connections(p);
  const comps = list(p.components);
  const ctrl = str(p.controller);
  const label = (end) => {
    const [cid, sig] = end.split('.');
    if (cid === 'board') return `${ctrl || 'board'} ${sig}`;
    return `${cid} ${sig}`;
  };
  const lines = [`# Wiring: ${str(p.title) || p.project}`, '',
    `Generated by projkit from project.yaml (${str(p.updated)}). Regenerate, don't edit.`, ''];
  for (const c of comps) {
    if (str(c.id) === ctrl) continue;
    const mine = conns.filter((k) => k.a.split('.')[0] === c.id || k.b.split('.')[0] === c.id);
    lines.push(`## ${c.id}: ${str(c.part)}${Number(c.qty) > 1 ? ` (×${c.qty})` : ''}`, '');
    if (!mine.length) { lines.push('_Not wired yet._', ''); continue; }
    lines.push('| Pin on the part | Connects to | Note |', '|---|---|---|');
    for (const k of mine) {
      const [me, other] = k.a.split('.')[0] === c.id ? [k.a, k.b] : [k.b, k.a];
      lines.push(`| ${me.split('.')[1]} | ${label(other)} | ${k.note || ''} |`);
    }
    const extra = [c.pullup && `pull-up: ${c.pullup}`, c.resistor_ohm && `resistor: ${c.resistor_ohm} Ω`, list(c.i2c_addr).length && `I2C ${list(c.i2c_addr).map(hexAddr).join(', ')}`].filter(Boolean);
    lines.push('', ...(extra.length ? [extra.join(' · '), ''] : []));
  }
  // diagram: one box per component (+ board, supply), one edge per connection
  const id = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const boxes = new Set();
  const pairs = new Map(); // one line per pair of boxes, all their wires in the label
  const box = (end) => { const cid = end.split('.')[0]; const b = cid === 'board' ? (ctrl || 'board') : cid; boxes.add(b); return b; };
  for (const k of conns) {
    const A = box(k.a), B = box(k.b), key = `${A}|${B}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(`${k.a.split('.')[1]}→${k.b.split('.')[1]}`);
  }
  const edges = [...pairs].map(([key, ls]) => { const [A, B] = key.split('|'); return `  ${id(A)} ---|"${ls.join(', ')}"| ${id(B)}`; });
  if (edges.length) {
    const name = (b) => { const c = comps.find((x) => str(x.id) === b); return b === 'supply' ? str(p.power && p.power.source && p.power.source.part) || 'supply' : c ? `${b}: ${str(c.part)}` : b; };
    lines.push('## Diagram', '', '```mermaid', 'flowchart LR', ...[...boxes].map((b) => `  ${id(b)}["${name(b).replace(/"/g, "'")}"]`), ...edges, '```', '');
  }
  return lines.join('\n');
}

function phaseAtLeast(phase, ph) { return PHASES.indexOf(phase) >= PHASES.indexOf(ph); }
function boardIds() { try { return fs.readdirSync(BOARDS).filter((f) => f.endsWith('.yaml')).map((f) => f.slice(0, -5)); } catch { return []; } }
function finish(results, p, gate = null) {
  const fails = results.filter((r) => r.level === 'FAIL').length;
  return { project: p && p.project, phase: p && p.phase, next_step: p && str(p.next_step), results, gate, ok: fails === 0 };
}

// ---------------------------------------------------------------------------
// Build plan: order the steps, check the order makes sense, say what is next.
//   stock: optional { <component id>: 'OK' | 'SHORT' | 'MISSING' } from the inventory check
export function plan(p, stock = null) {
  const R = [];
  const add = (level, msg) => R.push({ level, area: 'plan', msg });
  const steps = list(p.plan).filter((s) => s && typeof s === 'object');
  const comps = list(p.components);
  const byId = new Map();
  for (const s of steps) {
    const id = str(s.id);
    if (!id) { add('FAIL', `a step has no id: ${JSON.stringify(s)}`); continue; }
    if (byId.has(id)) add('FAIL', `duplicate step id "${id}"`);
    byId.set(id, s);
    if (!STEP_KINDS.includes(str(s.kind))) add('FAIL', `${id}: kind "${str(s.kind)}" is not one of ${STEP_KINDS.join(' | ')}`);
    for (const a of list(s.after)) if (!byId.has(str(a)) && !steps.some((x) => str(x.id) === str(a))) add('FAIL', `${id}: after "${a}" is not a step id`);
  }

  // topological order, keeping file order where there is a choice
  const order = [], state = new Map();
  let cycle = null;
  const visit = (id, trail) => {
    if (state.get(id) === 2 || !byId.has(id)) return;
    if (state.get(id) === 1) { cycle ||= [...trail, id]; return; }
    state.set(id, 1);
    for (const a of list(byId.get(id).after)) visit(str(a), [...trail, id]);
    state.set(id, 2); order.push(id);
  };
  for (const id of byId.keys()) visit(id, []);
  if (cycle) add('FAIL', `steps wait for each other in a loop: ${cycle.join(' -> ')}`);

  const ancestors = (id, seen = new Set()) => {
    for (const a of list(byId.get(id) && byId.get(id).after).map(str)) if (!seen.has(a)) { seen.add(a); ancestors(a, seen); }
    return seen;
  };
  // who provides a part: buy steps for bought parts, print steps for printed parts
  const providers = new Map();
  for (const s of steps) if (['buy', 'print'].includes(str(s.kind))) for (const part of list(s.parts).map(str)) {
    if (!providers.has(part)) providers.set(part, []);
    providers.get(part).push(str(s.id));
  }
  for (const s of steps) {
    const id = str(s.id), anc = ancestors(id), kind = str(s.kind);
    if (['buy', 'print'].includes(kind)) continue;
    for (const part of list(s.parts).map(str)) {
      for (const pr of providers.get(part) || []) {
        if (pr !== id && !anc.has(pr)) add('FAIL', `${id} uses ${part}, but ${pr} (which provides it) is not before it: add it to after`);
      }
    }
    // solder only what has been tested loose first
    if (kind === 'solder') {
      const tested = new Set([...anc].filter((a) => str(byId.get(a) && byId.get(a).kind) === 'test').flatMap((a) => list(byId.get(a).parts).map(str)));
      const untested = list(s.parts).map(str).filter((x) => comps.some((c) => str(c.id) === x) && !tested.has(x));
      if (untested.length) add('WARNING', `${id} solders ${untested.join(', ')} without a test step before it (breadboard it first)`);
    }
  }
  // printing everything before any test fit is the expensive mistake
  const prints = steps.filter((s) => str(s.kind) === 'print');
  if (prints.length >= 3 && !steps.some((s) => ['test', 'measure'].includes(str(s.kind)) && prints.some((pr) => ancestors(str(pr.id)).has(str(s.id))))) {
    add('WARNING', `${prints.length} print steps and none waits for a test fit or measurement: print a coupon or the key part first`);
  }

  // every component must be owned or have a buy step
  const inBuy = new Set(steps.filter((s) => str(s.kind) === 'buy').flatMap((s) => list(s.parts).map(str)));
  for (const c of comps) {
    const id = str(c.id), st = stock && stock[id];
    const owned = st === 'OK' || ['OWNED', 'BOUGHT'].includes(str(c.status));
    if (stock && (st === 'MISSING' || st === 'SHORT') && !inBuy.has(id)) add('FAIL', `${id} (${c.part}) is ${st} in the inventory and no buy step has it`);
    else if (!stock && !owned && !inBuy.has(id)) add('WARNING', `${id} (${c.part}) is ${str(c.status) || 'not owned'} and no buy step has it (inventory not checked)`);
    if (st === 'OK' && inBuy.has(id)) add('INFO', `${id} is in a buy step, but the inventory says you have it`);
  }
  if (!steps.length) add('INFO', 'no plan yet');
  else if (!R.some((r) => r.level === 'FAIL')) add('PASS', `${steps.length} steps in a valid order`);

  const isDone = (id) => byId.get(id) && byId.get(id).done === true;
  const rows = order.map((id) => {
    const s = byId.get(id);
    const waiting = list(s.after).map(str).filter((a) => !isDone(a));
    return { id, kind: str(s.kind), what: str(s.what), why: str(s.why), done: isDone(id), ready: !isDone(id) && !waiting.length, waiting };
  });
  return { results: R, steps: rows, next: rows.filter((r) => r.ready).map((r) => r.id) };
}

export function stockFromInventory(p, cli) {
  // run the inventory tool's check on the components; returns { id: status } or throws
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'projkit-')), 'needs.yaml');
  fs.writeFileSync(tmp, yaml.dump(toNeeds(p)));
  const r = spawnSync(process.execPath, [cli, 'check', tmp, '--json'], { encoding: 'utf8' });
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  if (r.status !== 0 && !r.stdout) throw new Error(r.stderr || `inventory check exited ${r.status}`);
  const out = {};
  for (const row of JSON.parse(r.stdout).rows || []) {
    const m = str(row.need).match(/^([^:]+):/);
    if (m) out[m[1]] = row.status;
  }
  return out;
}

export function toNeeds(p) {
  const needs = [];
  for (const c of list(p.components)) {
    const n = { name: `${c.id}: ${str(c.part) || c.id}`, qty: Number(c.qty) || 1 };
    if (c.inventory && c.inventory.id) n.id = c.inventory.id;
    else if (c.inventory && c.inventory.match) n.match = c.inventory.match;
    else n.match = { text: str(c.part) };
    if (str(c.status) === 'CANDIDATE') n.note = 'candidate, not decided';
    needs.push(n);
  }
  return { name: str(p.title) || p.project, status: str(p.phase) === 'idea' ? 'idea' : 'planning', needs };
}

function print(res) {
  const order = { FAIL: 0, WARNING: 1, 'NOT TESTED': 2, INFO: 3, PASS: 4 };
  for (const r of [...res.results].sort((a, b) => order[a.level] - order[b.level])) {
    console.log(`${r.level.padEnd(10)} ${r.area.padEnd(11)} ${r.msg}`);
  }
  if (res.gate) {
    console.log(`\nGATE ${res.gate.from} -> ${res.gate.to}: ${res.gate.open ? 'OPEN' : 'CLOSED'}`);
    for (const b of res.gate.blockers) console.log(`  - ${b}`);
  }
  if (res.next_step) console.log(`\nNext step: ${res.next_step}`);
}

// ---------------------------------------------------------------------------
async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const flag = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] ?? true : null; };
  const readOr2 = (a) => {
    const f = resolveFile(a);
    if (!f || !fs.existsSync(f)) { console.error(`no project.yaml at ${a || '(nothing given)'}: create one with  node projkit.mjs new <folder>`); process.exit(2); }
    try { return [f, load(f)]; } catch (e) { console.error(`${f}: ${e.message}`); process.exit(2); }
  };
  if (cmd === 'new') {
    if (!arg) { console.error('usage: node projkit.mjs new <folder> [--title "..."]'); process.exit(2); }
    const dir = path.resolve(arg), dst = path.join(dir, 'project.yaml');
    if (fs.existsSync(dst)) { console.error(`${dst} already exists - not overwritten`); process.exit(2); }
    fs.mkdirSync(dir, { recursive: true });
    const id = path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const today = new Date().toISOString().slice(0, 10);
    let t = fs.readFileSync(TEMPLATE, 'utf8')
      .replace(/^project: my-project(.*)$/m, `project: ${id}$1`)
      .replace(/^updated: .*$/m, `updated: ${today}`);
    const title = flag('--title');
    if (typeof title === 'string') t = t.replace(/^title: My project$/m, `title: ${JSON.stringify(title)}`);
    fs.writeFileSync(dst, t);
    console.log(`created ${dst}`);
  } else if (cmd === 'check') {
    const [f, p] = readOr2(arg);
    const res = check(p, f);
    if (rest.includes('--json')) console.log(JSON.stringify(res, null, 2)); else print(res);
    process.exit(res.ok ? 0 : 1);
  } else if (cmd === 'status') {
    const [f, p] = readOr2(arg);
    const res = check(p, f);
    const fails = res.results.filter((r) => r.level === 'FAIL').length;
    const g = res.gate ? ` | gate to ${res.gate.to}: ${res.gate.open ? 'OPEN' : `CLOSED (${res.gate.blockers.length})`}` : '';
    console.log(`${p.title || p.project} | phase ${p.phase}${g}${fails ? ` | ${fails} FAIL` : ''} | next: ${res.next_step || '-'}`);
  } else if (cmd === 'plan') {
    const [, p] = readOr2(arg);
    const cli = loadConfig().inventory_cli;
    let stock = null, note = 'inventory not checked (set inventory_cli in the cadkit config to check stock)';
    if (cli && fs.existsSync(cli)) {
      try { stock = stockFromInventory(p, cli); note = 'stock checked against the inventory'; } catch (e) { note = `inventory check failed: ${e.message.trim()}`; }
    }
    const res = plan(p, stock);
    if (rest.includes('--json')) { console.log(JSON.stringify({ ...res, stock, note }, null, 2)); process.exit(res.results.some((r) => r.level === 'FAIL') ? 1 : 0); }
    res.steps.forEach((s, i) => {
      const mark = s.done ? '[x]' : s.ready ? '[>]' : '[ ]';
      console.log(`${mark} ${String(i + 1).padStart(2)}. ${s.kind.padEnd(9)} ${s.what || s.id}${s.waiting.length && !s.done ? `   (waits for: ${s.waiting.join(', ')})` : ''}`);
    });
    if (res.steps.length) console.log('');
    for (const r of res.results) console.log(`${r.level.padEnd(10)} ${r.msg}`);
    console.log(`
${note}`);
    if (stock) { const buy = Object.entries(stock).filter(([, v]) => v !== 'OK'); console.log(buy.length ? `not in stock: ${buy.map(([k, v]) => `${k} (${v})`).join(', ')}` : 'everything is in stock'); }
    if (res.next.length) console.log(`next: ${res.next.join(', ')}`);
    process.exit(res.results.some((r) => r.level === 'FAIL') ? 1 : 0);
  } else if (cmd === 'wiring') {
    const [f, p] = readOr2(arg);
    const doc = wiringDoc(p);
    const w = flag('--write');
    if (w) { const out = typeof w === 'string' ? path.resolve(w) : path.join(path.dirname(f), 'WIRING.md'); fs.writeFileSync(out, doc); console.log(`wrote ${out}`); }
    else process.stdout.write(doc);
  } else if (cmd === 'needs') {
    const [, p] = readOr2(arg);
    const out = yaml.dump(toNeeds(p), { lineWidth: 120 });
    const w = flag('--write');
    if (typeof w === 'string') { fs.writeFileSync(w, `# Generated by projkit from ${p.project}/project.yaml - regenerate, don't edit\n${out}`); console.log(`wrote ${w}`); }
    else process.stdout.write(out);
  } else if (cmd === 'boards') {
    for (const id of boardIds()) { const b = loadBoard(id); console.log(`${id.padEnd(16)} ${b.fqbn.padEnd(20)} ${b.logic_v} V  ${b.name}`); }
  } else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
