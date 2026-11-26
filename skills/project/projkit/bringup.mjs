// Bring-up checklist from project.yaml: power the circuit up one piece at a time,
// with what to connect and what you should see at each step. Used by `projkit bringup`.
import { connections, normPin } from './projkit.mjs';

const isNone = (v) => v === undefined || v === null || v === 'none' || (Array.isArray(v) && v.length === 0);
const list = (v) => (isNone(v) ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const hex = (a) => (typeof a === 'number' ? '0x' + a.toString(16).toUpperCase().padStart(2, '0') : str(a));

// lowest risk first: things that only read, then things that show, then things that move
const RISK = { sensor: 1, input: 1, button: 1, display: 2, led: 2, buzzer: 2, 'led-strip': 3, module: 2, servo: 4, driver: 4, relay: 4, motor: 5, pump: 5, solenoid: 5, stepper: 5, power: 0 };

function expect(c, wiresTo) {
  const t = str(c.type);
  const addr = list(c.i2c_addr).map(hex);
  const i2c = wiresTo.some((w) => /\b(sda|scl)\b/i.test(w));
  const lines = [];
  if (i2c) lines.push(`Run an I2C scanner sketch: it must find ${addr.length ? addr.join(', ') : 'the device (note its address in project.yaml)'}. Nothing found = SDA/SCL swapped, no power, or no pull-ups on a bare chip.`);
  if (t === 'button' || t === 'input') lines.push(`Test sketch prints the input state: it must change exactly once per press (${c.pullup === 'internal' ? 'INPUT_PULLUP: reads HIGH released, LOW pressed' : 'with its pull resistor'}).`);
  if (t === 'sensor' && !i2c) lines.push('Test sketch prints the raw reading twice a second: note the value at rest and at both extremes (dry/wet, dark/light, cold/warm) in the log. These become the thresholds.');
  if (t === 'sensor' && i2c) lines.push('Print the readings with units: they must be plausible (room temperature ~20 °C, not 0 or -144).');
  if (t === 'display') lines.push('Test sketch shows one line of text. Blank = wrong address/driver, or contrast; garbage = wrong library for the controller chip.');
  if (t === 'led') lines.push(`LED blinks${c.resistor_ohm ? ` (through ${c.resistor_ohm} Ω)` : ''}. Dark: turned around (the long leg is +).`);
  if (t === 'led-strip') lines.push('Only a few LEDs at low brightness first. 1000 µF across the strip supply, 330 Ω in the data line.');
  if (t === 'servo') lines.push('Sweep slowly 0 → 180 → 0. If the board resets or the servo twitches, its supply sags: it must not run from the board 5V.');
  if (t === 'driver' || t === 'motor' || t === 'pump' || t === 'solenoid' || t === 'relay') {
    lines.push('Start at low PWM (~30 %), both directions if it can reverse. Keep a hand on the plug: it must be possible to cut power at once.');
    lines.push('Measure the supply voltage while it starts: a drop of more than ~10 % (or a board reset) means the supply or wiring is too weak.');
  }
  if (t === 'pump') lines.push('Pumps only run IN water: a dry run destroys most small pumps.');
  if (!lines.length) lines.push('Test sketch exercises it and prints what happens; compare with its datasheet.');
  return lines;
}

export function bringup(p) {
  const ctrl = str(p.controller);
  const comps = list(p.components);
  const conns = connections(p);
  const src = p.power && p.power.source;
  const steps = [];
  const step = (title, items, why = '') => steps.push({ title, items, why });

  step('Before anything gets power', [
    'Tools: multimeter, a USB cable that carries data (not charge-only), breadboard and jumper wires.',
    'Nothing is plugged in yet. Compare the breadboard with WIRING.md wire by wire (`projkit wiring <project> --write`).',
    'Multimeter on continuity/Ω: 5V ↔ GND and 3V3 ↔ GND on the board must NOT beep (no short).',
    ...(src && !isNone(src) ? ['Same between the supply + and − at the breadboard rails: no short.'] : []),
  ], 'A short found here costs nothing; found with power on it costs a board.');

  if (src && !isNone(src)) {
    step(`Supply: ${str(src.part) || 'the power source'}`, [
      `Measure it unloaded before connecting anything: expect ${src.v} V (± 5 %). Check the polarity (+ to the + rail).`,
      `It must give ${src.max_ma} mA; the project peaks at about ${list(p.components).reduce((s, c) => s + (Number(c.power && (c.power.peak_ma ?? c.power.ma)) || 0) * (Number(c.qty) || 1), 0)} mA.`,
      'Connect its GND to the board GND (common ground) before any signal wire.',
    ]);
  }

  step(`Controller alone (${ctrl || 'the board'})`, [
    'Only USB connected. `fwkit upload` a test sketch that blinks the on-board LED and prints "alive" on Serial; `fwkit monitor` must show it.',
    'Upload fails: the port (`fwkit ports`), the cable, a CH340 driver, or the old Nano bootloader (fqbn cpu=atmega328old).',
  ]);

  const others = comps.filter((c) => str(c.id) !== ctrl && str(c.type) !== 'passive')
    .sort((a, b) => (RISK[str(a.type)] ?? 3) - (RISK[str(b.type)] ?? 3));
  const done = new Set();
  for (const c of others) {
    if (done.has(c.id)) continue;
    // a driver and the motors on its outputs are brought up together
    const group = [c, ...others.filter((o) => o !== c && !done.has(o.id) && str(c.type) === 'driver' &&
      conns.some((k) => (k.a.startsWith(c.id + '.') && k.b.startsWith(o.id + '.')) || (k.b.startsWith(c.id + '.') && k.a.startsWith(o.id + '.'))))];
    group.forEach((g) => done.add(g.id));
    const ids = group.map((g) => g.id);
    const wires = conns.filter((k) => ids.includes(k.a.split('.')[0]) || ids.includes(k.b.split('.')[0]))
      .map((k) => { const fmt = (e) => (e.startsWith('board.') ? `${ctrl || 'board'} ${normPin(e.slice(6))}` : e.replace('.', ' ')); return `${fmt(k.b)} → ${fmt(k.a)}${k.note ? ` (${k.note})` : ''}`; });
    const power = wires.filter((w) => /\b(vcc|vdd|vin|vm|5v|3v3|gnd|\+|-)\b/i.test(w));
    const signal = wires.filter((w) => !power.includes(w));
    step(`${ids.join(' + ')}: ${group.map((g) => str(g.part)).join(' + ')}`, [
      'Power off (USB out) while wiring.',
      ...(power.length ? [`Power wires first: ${power.join('; ')}.`] : []),
      ...(signal.length ? [`Then signals: ${signal.join('; ')}.`] : ['Not wired in project.yaml yet: wire it there first (/electronics).']),
      'Power on; nothing gets hot (touch the chips for 2 s), nothing smells.',
      ...group.flatMap((g) => expect(g, wires)),
    ]);
  }

  const must = list(p.idea && p.idea.must);
  step('Everything together on the breadboard', [
    'Upload the real firmware. Every subsystem still works with all the others connected.',
    ...must.map((m) => `Requirement: "${m}": test it the way a user would, and log how it went.`),
    'Leave it running for 30 minutes (or a full cycle): no resets, nothing warm that should not be.',
  ]);
  step('Only now: solder and mount', [
    'Photograph the working breadboard (it is the reference when the soldered version misbehaves).',
    'After soldering: repeat the no-short check (5V ↔ GND) before power, then the "everything together" step.',
  ]);
  return steps;
}

export function bringupMarkdown(p, steps) {
  const out = [`# Bring-up: ${str(p.title) || p.project}`, '',
    'Generated by projkit from project.yaml. One step at a time: do not connect the next part until this one works. Log readings with `projkit log`.', ''];
  steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '');
    if (s.why) out.push(`_${s.why}_`, '');
    for (const it of s.items) out.push(`- [ ] ${it}`);
    out.push('');
  });
  return out.join('\n');
}
