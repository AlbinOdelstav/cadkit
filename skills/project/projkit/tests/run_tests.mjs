#!/usr/bin/env node
// projkit tests: node tests/run_tests.mjs   (no inventory, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, plan, load, loadBoard, normPin, wiringDoc } from '../projkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => path.join(HERE, 'fixtures', n, 'project.yaml');
let failed = 0;
const t = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const has = (res, level, re) => res.results.some((r) => r.level === level && re.test(r.msg));

t('normPin', normPin('9') === 'D9' && normPin('d09') === 'D9' && normPin('a0') === 'A0' && normPin('3.3V') === '3V3');

// the template, as `new` writes it: no FAIL, idea gate closed
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projkit-'));
  const dir = path.join(tmp, 'fresh-proj');
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(HERE, '..', 'templates', 'project.yaml'), path.join(dir, 'project.yaml'));
  const txt = fs.readFileSync(path.join(dir, 'project.yaml'), 'utf8').replace('project: my-project', 'project: fresh-proj');
  fs.writeFileSync(path.join(dir, 'project.yaml'), txt);
  const r = check(load(path.join(dir, 'project.yaml')), path.join(dir, 'project.yaml'));
  t('template: no FAIL', r.ok);
  t('template: idea gate closed', r.gate && !r.gate.open && r.gate.blockers.some((b) => /no concept chosen/.test(b)));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// plant-bad: wiring and power mistakes on purpose
{
  const r = check(load(F('plant-bad')), F('plant-bad'));
  t('plant-bad: fails', !r.ok);
  t('pin used twice', has(r, 'FAIL', /D4 is used by pump\.in and oled\.dc/));
  t('pwm need on a non-pwm pin', has(r, 'FAIL', /pump needs pwm/));
  t('board 5V rail overload', has(r, 'FAIL', /5V pin of arduino-nano .* > 400 mA/));
  t('A6 analog-only is fine for an analog sensor', !has(r, 'FAIL', /A6 is analog input ONLY/));
  t('D1 = USB serial warning', has(r, 'WARNING', /D1: D0\/D1 are the USB serial/));
  t('3.3 V logic warning', has(r, 'WARNING', /oled has 3\.3 V logic/));
  t('untestable must', has(r, 'WARNING', /"Works well"/));
  t('phase past a closed gate', has(r, 'FAIL', /phase is "cad" but the electronics gate is closed/));
  t('supply budget passes', has(r, 'PASS', /peak 655 mA of 1000 mA/));
}

// robot-plan: build order mistakes on purpose
{
  const p = load(F('robot-plan'));
  const r = plan(p, { uno: 'OK', mega: 'MISSING', motors: 'OK', driver: 'MISSING', irbar: 'MISSING' });
  t('cycle found', r.results.some((x) => x.level === 'FAIL' && /loop-a -> loop-b -> loop-a/.test(x.msg)));
  t('use before print', r.results.some((x) => x.level === 'FAIL' && /assemble uses bracket, but print-bracket/.test(x.msg)));
  t('solder without test', r.results.some((x) => x.level === 'WARNING' && /solder-driver solders driver without a test/.test(x.msg)));
  t('prints without test fit', r.results.some((x) => x.level === 'WARNING' && /3 print steps/.test(x.msg)));
  t('missing in stock, no buy step', r.results.some((x) => x.level === 'FAIL' && /mega .* MISSING in the inventory and no buy step/.test(x.msg)));
  t('bought parts in a buy step are fine', !r.results.some((x) => /driver .* no buy step/.test(x.msg)));
  t('next = steps with nothing to wait for', JSON.stringify(r.next) === JSON.stringify(['buy', 'print-chassis', 'print-wheels', 'print-bracket']));
  const r2 = plan(p, null);
  t('without inventory: warn, not fail', r2.results.some((x) => x.level === 'WARNING' && /^mega .*\(inventory not checked\)/.test(x.msg)));
}

// fan-good / fan-bad: electrical rules
{
  const g = check(load(F('fan-good')), F('fan-good'));
  t('fan-good: no FAIL, no wiring warning', g.ok && !g.results.some((x) => x.area === 'wiring' && x.level !== 'PASS'));
  t('fan-good: electronics gate open', g.gate && g.gate.open);
  const b = check(load(F('fan-bad')), F('fan-bad'));
  t('no common ground', has(b, 'FAIL', /supply's gnd is not connected/));
  t('3.3 V part on the 5V pin', has(b, 'FAIL', /bme needs 3.3 V but its vcc is on the board's 5V pin/));
  t('motor on a signal pin', has(b, 'FAIL', /fan2 is a motor on a board signal pin/));
  t('I2C address clash shown as hex', has(b, 'FAIL', /both use I2C address 0x3C/));
  t('floating button', has(b, 'WARNING', /btn: button with no pullup/));
  t('LED without resistor', has(b, 'WARNING', /led: LED with no resistor_ohm/));
  t('fan-bad: gate closed', b.gate && !b.gate.open);
  const doc = wiringDoc(load(F('fan-good')));
  t('wiring doc: table + merged diagram edge', /| pwma | uno D5 |/.test(doc) && /uno ---|"D5→pwma, D7→ain1/.test(doc) && /(2026-11-26)/.test(doc));
  t('cut-off part name warned', check({ ...load(F('fan-good')), components: [{ id: 'x', part: 'BME280 (5 V', status: 'DECIDED' }] }).results.some((x) => /looks cut off/.test(x.msg)));
}

// esp32-weather: correct ESP32 wiring, then one mistake at a time
{
  const esp = loadBoard('esp32-devkit-v1');
  t('normPin ESP32: 4 / IO4 / G4 / gpio04 -> GPIO4, VP -> GPIO36',
    ['4', 'IO4', 'G4', 'gpio04', 'GPIO4'].every((x) => normPin(x, esp) === 'GPIO4') && normPin('VP', esp) === 'GPIO36' && normPin('3.3V', esp) === '3V3');
  t('normPin AVR unchanged with a board', normPin('4', loadBoard('arduino-uno')) === 'D4');
  const base = load(F('esp32-weather'));
  const g = check(base, F('esp32-weather'));
  t('esp32-weather: no FAIL, no warning', g.ok && !g.results.some((x) => x.level === 'WARNING'));
  t('esp32-weather: pins checked against the ESP32 table', has(g, 'PASS', /connections on esp32-devkit-v1/));
  t('esp32-weather: electronics gate open', g.gate && g.gate.open);
  // move one connection to another pin (or change a component)
  const variant = (to, pin, comp = {}) => {
    const p = structuredClone(base);
    if (to) p.pins = p.pins.map((e) => (e.to === to ? { ...e, pin } : e));
    p.components = p.components.map((c) => (comp[c.id] ? { ...c, ...comp[c.id] } : c));
    return check(p);
  };
  t('LED on input-only GPIO35 fails', has(variant('led.anode', 'GPIO35'), 'FAIL', /GPIO35 is input only .* led\.anode needs an output/));
  t('analog sensor on input-only GPIO34 is fine', !has(g, 'FAIL', /input only/));
  t('button on GPIO36 with internal pullup fails (no pull-up there)', has(variant('btn.a', '36'), 'FAIL', /GPIO36 has no internal pull-up/));
  t('button on GPIO36 is not an output', !has(variant('btn.a', '36'), 'FAIL', /input only/));
  t('flash pin GPIO6 fails', has(variant('btn.a', 'IO6'), 'FAIL', /GPIO6 .* not usable .* SPI flash/));
  t('strapping GPIO12 warns about flash voltage', has(variant('led.anode', '12'), 'WARNING', /GPIO12 .*1\.8 V/));
  t('strapping GPIO0 warns about boot mode', has(variant('btn.a', 'G0'), 'WARNING', /GPIO0 .*download mode/));
  t('analog read on ADC2 GPIO25 warns about Wi-Fi', has(variant('ldr.ao', 'GPIO25'), 'WARNING', /GPIO25: .*ADC2.*Wi-Fi/));
  t('digital use of ADC2 GPIO4 does not warn', !variant('btn.a', 'GPIO4').results.some((x) => x.level === 'WARNING'));
  t('GPIO1 = USB serial warning', has(variant('btn.a', 'GPIO1'), 'WARNING', /GPIO1: GPIO1\/GPIO3 are UART0/));
  t('5 V logic part on the 3.3 V board warns', has(variant(null, null, { bme: { power: { v: 5, logic_v: 5, ma: 1, src: 'DATASHEET' } } }), 'WARNING', /bme has 5 V logic, the controller 3\.3 V/));
  t('pin missing from the table fails', has(variant('btn.a', 'GPIO24'), 'FAIL', /GPIO24 does not exist on esp32-devkit-v1/));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
