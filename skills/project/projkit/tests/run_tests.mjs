#!/usr/bin/env node
// projkit tests: node tests/run_tests.mjs   (no inventory, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
  t('wiring doc: table + merged diagram edge', /\| pwma \| uno D5 \|/.test(doc) && /uno ---\|"D5→pwma, D7→ain1/.test(doc) && /\(2026-11-26\)/.test(doc));
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

// found in the pilot (ESP32 + TMC2209 stepper winches): shared nets, drivers, power modules
{
  const pilot = {
    ...load(F('esp32-weather')),
    controller: 'esp',
    components: [
      { id: 'esp', part: 'ESP32 DevKitC', status: 'DECIDED', type: 'controller', board: 'esp32-devkit-v1', power: { v: 5, logic_v: 3.3, ma: 120, src: 'DATASHEET' } },
      { id: 'buck', part: 'LM2596 module', status: 'DECIDED', type: 'power', power: { v: 12, ma: 0, src: 'DATASHEET' } },
      { id: 'd1', part: 'TMC2209', status: 'DECIDED', type: 'driver', power: { v: 12, logic_v: 3.3, ma: 5, src: 'DATASHEET' } },
      { id: 'd2', part: 'TMC2209', status: 'DECIDED', type: 'driver', power: { v: 12, logic_v: 3.3, ma: 5, src: 'DATASHEET' } },
      { id: 'm1', part: 'NEMA17', status: 'DECIDED', type: 'motor', power: { v: 12, ma: 300, src: 'DATASHEET' } },
    ],
    pins: [
      { pin: 'GPIO4', to: ['d1.en', 'd2.en'] },
      { pin: 'GPIO34', to: 'd1.diag', as: 'input' },
      { pin: '3V3', to: ['d1.vio', 'd2.vio'] },
      { pin: 'GND', to: ['d1.gnd', 'd2.gnd', 'buck.gnd'] },
    ],
    wires: [{ from: 'supply.gnd', to: 'board.GND' }, { from: 'supply.12v', to: 'buck.in' }, { from: 'buck.out', to: 'board.5V' },
      { from: 'supply.12v', to: 'd1.vm' }, { from: 'supply.12v', to: 'd2.vm' }, { from: 'd1.coil_a', to: 'm1.coil_a' }, { from: 'd1.coil_b', to: 'm1.coil_b' }],
    power: { source: { part: '12 V 5 A', v: 12, max_ma: 5000 } },
    functions: [{ id: 'move', kind: 'actuate', what: 'Move', by: ['m1', 'd1'] }], plan: 'none',
  };
  const r = check(pilot);
  t('pilot: a pin wired to a list of parts is a shared net, not a clash', !has(r, 'FAIL', /GPIO4 is used by/));
  t('pilot: shared pin without the list is still a clash', has(check({ ...pilot, pins: [...pilot.pins, { pin: 'GPIO5', to: 'd1.step' }, { pin: 'GPIO5', to: 'd2.step' }] }), 'FAIL', /GPIO5 is used by d1\.step and d2\.step/));
  t('pilot: as: input on an input-only pin is fine', !r.results.some((x) => x.level === 'FAIL' && /GPIO34/.test(x.msg)));
  t('pilot: a motor fed only by its driver needs no own gnd/vcc', !r.results.some((x) => /m1: no (gnd|supply)/.test(x.msg)));
  t('pilot: a power module powered through in/out', !r.results.some((x) => /buck: no supply/.test(x.msg)));
  t('pilot: no FAIL at all', r.ok);
  if (!r.ok) console.log('     ' + r.results.filter((x) => x.level === 'FAIL').map((x) => x.msg).join('\n     '));
  const assumed = check({ ...pilot, components: pilot.components.map((c) => ({ ...c, power: { ...c.power, src: 'ASSUMED' } })) });
  t('pilot: ASSUMED currents in one warning line', assumed.results.filter((x) => /ASSUMED/.test(x.msg)).length === 1);
}

// Arduino Nano ESP32: native USB (D0/D1 free), A2 strapping, ADC2 on A4-A7
{
  const nano = {
    ...load(F('esp32-weather')), controller: 'n',
    components: [
      { id: 'n', part: 'Arduino Nano ESP32', status: 'DECIDED', type: 'controller', board: 'arduino-nano-esp32', power: { v: 12, logic_v: 3.3, ma: 100, src: 'DATASHEET' } },
      { id: 'd', part: 'TMC2209', status: 'DECIDED', type: 'driver', power: { v: 12, logic_v: 3.3, ma: 5, src: 'DATASHEET' } },
      { id: 'ldr', part: 'LDR divider', status: 'DECIDED', type: 'sensor', needs: ['analog'], power: { v: 3.3, logic_v: 3.3, ma: 1, src: 'DATASHEET' } },
    ],
    pins: [{ pin: 'D0', to: 'd.pdn_uart', as: 'uart' }, { pin: 'D2', to: 'd.step' }, { pin: 'GND', to: ['d.gnd', 'ldr.gnd'] }, { pin: '3V3', to: ['d.vio', 'ldr.vcc'] }, { pin: 'A0', to: 'ldr.ao' }],
    wires: [], power: { source: { part: 'USB', v: 5, max_ma: 500 } }, functions: [{ id: 'x', kind: 'sense', what: 'x', by: ['ldr'] }], plan: 'none',
  };
  const r = check(nano);
  t('nano esp32: D0/D1 are not the USB serial port (native USB)', !r.results.some((x) => /D0: .*serial|USB serial/i.test(x.msg)));
  t('nano esp32: clean wiring passes', r.ok && has(r, 'PASS', /connections on arduino-nano-esp32/));
  const v = (pin, to) => check({ ...nano, pins: nano.pins.map((e) => (e.to === to ? { ...e, pin } : e)) });
  t('nano esp32: A2 (GPIO3) is a strapping pin', has(v('A2', 'd.step'), 'WARNING', /A2 .*GPIO3, a strapping pin/));
  t('nano esp32: analog read on A4 (ADC2) warns about Wi-Fi', has(v('A4', 'ldr.ao'), 'WARNING', /A4: .*ADC2/));
  t('nano esp32: analog read on A0 (ADC1) does not', !v('A0', 'ldr.ao').results.some((x) => /ADC2/.test(x.msg)));
  t('nano esp32: D14 does not exist', has(v('D14', 'd.step'), 'FAIL', /D14 does not exist on arduino-nano-esp32/));
}

// design steps (found in the pilot): they create parts, a print comes after them
{
  const base = { components: [], plan: [
    { id: 'design-a', kind: 'design', what: 'CAD of a', parts: ['a'], after: [] },
    { id: 'print-a', kind: 'print', what: 'print a', parts: ['a'], after: ['design-a'] },
    { id: 'fit-a', kind: 'test', what: 'fit a', parts: ['a'], after: ['print-a'] },
  ] };
  const ok = plan(base);
  t('design: design -> print -> test is a valid order', !ok.results.some((x) => x.level === 'FAIL'));
  const bad = plan({ ...base, plan: base.plan.map((s) => (s.id === 'print-a' ? { ...s, after: [] } : s)) });
  t('design: printing before the design is a FAIL', bad.results.some((x) => x.level === 'FAIL' && /print-a prints a before design-a/.test(x.msg)));
}

// bring-up checklist and project log
{
  const { bringup, bringupMarkdown } = await import('../bringup.mjs');
  const L = await import('../log.mjs');
  const steps = bringup(load(F('fan-good')));
  const titles = steps.map((s) => s.title);
  const at = (re) => titles.findIndex((x) => re.test(x));
  t('bring-up: no-short check first, then supply, then the board alone', at(/Before anything/) === 0 && at(/^Supply/) === 1 && at(/^Controller alone/) === 2);
  t('bring-up: sensors before the motor, driver and motor together', at(/^bme/) < at(/^driver \+ motor/) && at(/^driver \+ motor/) > at(/^oled/) && at(/^motor:/) === -1);
  const md = bringupMarkdown(load(F('fan-good')), steps);
  t('bring-up: wires, I2C address and the requirement tests', /bme sda → uno A4/.test(md) && /must find 0x76/.test(md) && /Requirement: "Fan speed changes/.test(md) && /- \[ \] /.test(md));
  // pilot findings: power vs signal by the pin's own name, motor last, steppers, power modules
  const drvStep = steps.find((s) => /^driver \+ motor/.test(s.title)).items.join('\n');
  t('bring-up: a dash in a part id does not make a signal a power wire', /Then signals: driver pwma → uno D5/.test(drvStep));
  t('bring-up: motor wires after the driver, with motor voltage off', /Then, with the motor voltage OFF, the motor: motor \+ → driver ao1/.test(drvStep));
  t('bring-up: no duplicated advice for driver + motor', (drvStep.match(/Start at low PWM/g) || []).length === 1);
  const stp = bringup({ ...load(F('fan-good')), components: [
    ...load(F('fan-good')).components.filter((c) => c.id !== 'motor'),
    { id: 'motor', part: 'NEMA17 17HS4401', qty: 1, status: 'DECIDED', type: 'motor', power: { v: 12, ma: 300 } },
    { id: 'buck2', part: 'LM2596', qty: 1, status: 'DECIDED', type: 'power', power: { v: 12, ma: 0 } },
  ], wires: [...load(F('fan-good')).wires, { from: 'supply.6v', to: 'buck2.in' }] });
  const stpText = stp.map((s) => s.items.join('\n')).join('\n');
  t('bring-up: steppers get current limit first and never hot-plug', /current limit .* BEFORE the motor is connected/.test(stpText) && /Never plug or unplug a stepper/.test(stpText) && !/low PWM/.test(stp.find((s) => /^driver/.test(s.title)).items.join()));
  t('bring-up: a power module is set and measured before its loads', /NOTHING on its output yet: set the output voltage/.test(stpText) && /Power wires first: buck2 in → supply 6v/.test(stpText));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projkit-log-'));
  const pf = path.join(tmp, 'project.yaml');
  fs.copyFileSync(F('fan-good'), pf);
  const p = load(pf);
  L.append(pf, p, 'Motor stutters when the display updates', 'problem', new Date(2026, 10, 26, 23, 50));
  L.append(pf, p, 'Display update moved out of the motor loop', 'fixed', new Date(2026, 10, 27, 9, 5));
  L.append(pf, p, 'Servo jitters at rest', 'problem', new Date(2026, 10, 27, 9, 30));
  const es = L.entries(pf);
  t('log: entries read back, local date (23:50 stays on the 26th)', es.length === 3 && es[0].day === '2026-11-26' && es[1].day === '2026-11-27');
  t('log: a problem with a later matching fix is closed', L.openProblems(es).map((e) => e.text).join() === 'Servo jitters at rest');
  let bad = false; try { L.append(pf, p, 'x', 'banana'); } catch { bad = true; }
  t('log: unknown kind refused', bad);
  const hook = spawnSync(process.execPath, [path.join(HERE, '..', 'hooks', 'session_status.mjs')], { input: JSON.stringify({ cwd: tmp }), encoding: 'utf8' });
  t('session hook: shows the last entry and open problems', /Last log entry \(2026-11-27\): problem: Servo jitters/.test(hook.stdout) && /Open problems in LOG\.md: Servo jitters at rest/.test(hook.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// a purchase updates the inventory through its CLI (a fake one here)
{
  const { recordPurchase } = await import('../projkit.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projkit-inv-'));
  const cli = path.join(tmp, 'inv.mjs');
  fs.writeFileSync(cli, "const [, , cmd, id, d] = process.argv; if (cmd !== 'adjust' || id !== 'arduino-uno') { console.error('no item'); process.exit(1); } console.log(JSON.stringify({ id, before: 1, after: 1 + Number(d), unit: 'pcs' }));\n");
  const p = load(F('robot-plan'));
  const ok = recordPurchase(p, 'uno', 2, cli);
  t('bought: inventory adjusted by the component qty', ok.ok && /arduino-uno 1 -> 3 pcs/.test(ok.msg));
  t('bought: component without inventory id explains what to do', /mega has no inventory: \{id/.test(recordPurchase(p, 'mega', null, cli).msg));
  t('bought: unknown component refused', !recordPurchase(p, 'nope', null, cli).ok);
  t('bought: no inventory_cli is said, not hidden', /inventory_cli is not set/.test(recordPurchase(p, 'uno', 1, null).msg));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
