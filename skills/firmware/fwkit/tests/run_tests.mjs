#!/usr/bin/env node
// fwkit tests: node tests/run_tests.mjs   (compile tests are skipped without arduino-cli + arduino:avr)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, pinsHeader, lint, compile, status } from '../fwkit.mjs';
import { loadConfig } from '../../../cad-validation/cadkit/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.join(HERE, 'fixtures', 'fw-fan');
const INO = path.join(PROJ, 'firmware', 'fw-fan', 'fw-fan.ino');
let failed = 0;
const t = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

const P = project(PROJ);
const h = pinsHeader(P);
t('pins.h: signal pins as constants', /PIN_DRIVER_PWMA = 5;/.test(h) && /PIN_BTN_A = 2;/.test(h));
t('pins.h: no power pins', !/PIN_\w+_VCC|PIN_\w+_GND/.test(h));
t('pins.h: I2C listed, not as constants', /oled\.sda on A4/.test(h) && !/PIN_OLED_SDA/.test(h));
t('pins.h: I2C addresses in hex', /I2C_ADDR_OLED = 0x3C;/.test(h));
t('pins.h: baud', /SERIAL_BAUD = 115200;/.test(h));
{
  const { loadBoard } = await import('../../../project/projkit/projkit.mjs');
  const esp = { p: { project: 'x', pins: [{ pin: 'IO4', to: 'led.k' }, { pin: 'G23', to: 'btn.a' }] }, board: loadBoard('esp32-devkit-v1'), baud: 115200 };
  const eh = pinsHeader(esp);
  t('pins.h: ESP32 pin names (IO4, G23) become GPIO numbers', /PIN_LED_K = 4;/.test(eh) && /PIN_BTN_A = 23;/.test(eh));
}

const orig = fs.readFileSync(INO, 'utf8');
try {
  fs.writeFileSync(INO, orig.replace('Serial.begin(SERIAL_BAUD);', 'Serial.begin(9600);\n  pinMode(13, OUTPUT);'));
  const l = lint(P);
  t('lint: literal pin', l.some((x) => /pinMode\(13\) uses a literal pin/.test(x.msg)));
  t('lint: baud mismatch', l.some((x) => /Serial\.begin\(9600\) but firmware\.baud is 115200/.test(x.msg)));
  fs.writeFileSync(INO, orig);
  t('lint: clean sketch', lint(P).filter((x) => x.level !== 'INFO').length === 0);

  const cli = loadConfig().arduino_cli;
  if (!cli || !fs.existsSync(cli)) console.log('skip compile tests: arduino-cli not found');
  else {
    const ok = compile(P);
    t('compile: passes, reports flash and RAM', ok.ok && ok.usage.flash && ok.usage.ram && ok.usage.flash.max > 0);
    t('status: current after compile', status(P).ok);
    const ph = path.join(P.sketch, 'pins.h');
    fs.writeFileSync(ph, fs.readFileSync(ph, 'utf8').replace(/\r?\n/g, '\r\n'));
    fs.writeFileSync(INO, orig.replace(/\r?\n/g, '\r\n'));
    t('status: a CRLF checkout is not an edit', status(P).ok);
    fs.writeFileSync(INO, orig);
    fs.writeFileSync(INO, orig.replace('was = now;', 'was = now'));
    t('status: stale after an edit', !status(P).current);
    const bad = compile(P);
    t('compile: syntax error fails with the line', !bad.ok && /fw-fan\.ino:\d+:\d+: error/.test(bad.errors));
    fs.writeFileSync(INO, orig);
    compile(P);
  }
} finally { fs.writeFileSync(INO, orig); }

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
