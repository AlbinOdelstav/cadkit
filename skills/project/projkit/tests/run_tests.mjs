#!/usr/bin/env node
// projkit tests: node tests/run_tests.mjs   (no inventory, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, plan, load, normPin } from '../projkit.mjs';

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

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
