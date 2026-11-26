#!/usr/bin/env node
// projkit tests: node tests/run_tests.mjs   (no inventory, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, plan, load, normPin, wiringDoc } from '../projkit.mjs';

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

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
