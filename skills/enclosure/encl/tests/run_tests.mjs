#!/usr/bin/env node
// encl tests: node tests/run_tests.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, libPart, manifestComponents, svg, bedSize } from '../encl.mjs';
import { load } from '../../../project/projkit/projkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const p = load(path.join(HERE, 'fixtures', 'box-fan', 'project.yaml'));
let failed = 0;
const t = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const near = (a, b, e = 0.15) => Math.abs(a - b) <= e;

const uno = libPart('arduino-uno-r3');
t('library: Uno envelope includes the overhanging USB jack', near(uno.bodies.find((b) => b.name === 'usb_b jack').min[0], -6.34));
t('library: 4 mounting holes', uno.holes.length === 4 && near(uno.holes[0].d, 3.2));

const L = plan(p, { printer: 'Bambu Lab P1S' });
const D = L.defaults;
const u = L.parts.find((x) => x.id === 'uno');
t('controller placed with its USB toward -x, jack 0.5 mm from the inner wall', u.rot_z === 0 && near(u.pos[0] - 6.34, D.wall + D.connector_margin));
t('controller on standoffs above the floor', u.standoff >= 5 && near(u.pos[2], D.floor + u.standoff));
const o = L.openings.find((x) => x.for === 'uno.usb_b');
t('USB opening on -x, centred on the jack', o && o.wall === '-x' && near(o.center[0], (32.2 + 44.0) / 2 + u.pos[1]) && near(o.center[1], 1.57 + 11 / 2 + u.pos[2]));
t('lid openings for display, button, LED', ['oled', 'btn', 'led'].every((id) => L.openings.some((x) => x.for === id && x.wall === 'lid')));
t('cable exit for the outside sensor on its wall', L.openings.some((x) => x.for === 'bme' && x.wall === '+y'));
t('motor treated as outside (not packed in the box)', L.outside.includes('motor') && !L.parts.some((x) => x.id === 'motor'));
t('vents warned for the driver', L.results.some((r) => r.level === 'WARNING' && /vents needed: .*driver/.test(r.msg)));
t('unmeasured size warned', L.results.some((r) => /bme: size .* not measured/.test(r.msg)));
t('jumper headroom above the headers', L.inner[2] >= u.box.max[2] - D.floor);

// geometry sanity: inside the inner box, no overlaps
const inner = { min: [D.wall, D.wall, D.floor], max: [D.wall + L.inner[0], D.wall + L.inner[1], D.floor + L.inner[2]] };
t('all parts inside the inner box', L.parts.every((x) => x.box.min.every((v, i) => v >= inner.min[i] - 0.05) && x.box.max.every((v, i) => v <= inner.max[i] + 0.05)));
const overlap = (a, b) => [0, 1, 2].every((i) => a.box.min[i] < b.box.max[i] && b.box.min[i] < a.box.max[i]);
t('no two parts overlap', L.parts.every((a, i) => L.parts.slice(i + 1).every((b) => !overlap(a, b))));
t('outer = inner + walls', near(L.outer[0], L.inner[0] + 2 * D.wall) && near(L.outer[2], L.inner[2] + D.floor + D.lid));

const m = manifestComponents(L);
t('manifest block in cadkit format', m.length === 1 && m[0].ref === 'arduino-uno-r3' && m[0].connectors_used[0] === 'usb_b' && Array.isArray(m[0].placement.rot));
t('svg is one document with a rect per part', /^<svg[\s\S]*<\/svg>$/.test(svg(L)) && (svg(L).match(/fill="#cfe3ff"/g) || []).length === L.parts.length);

const big = plan({ ...p, idea: { ...p.idea, constraints: { ...p.idea.constraints, size_mm: [60, 60, 30] } } }, { printer: 'Bambu Lab A1 mini' });
t('size limit from idea.constraints enforced', big.results.some((r) => r.level === 'FAIL' && /exceeds idea\.constraints\.size_mm/.test(r.msg)));
t('printer volumes', bedSize('Bambu Lab A1 mini')[0] === 180 && bedSize('Bambu Lab P1S')[0] === 256 && bedSize('my own printer') === null);
const nosize = plan({ ...p, components: [...p.components, { id: 'mystery', part: 'Unknown board', status: 'DECIDED' }] });
t('a part without a size is a FAIL', nosize.results.some((r) => r.level === 'FAIL' && /mystery: no size/.test(r.msg)));

// found in the first pilot (ESP32 + stepper drivers, no library files)
{
  const pilot = {
    ...p, controller: 'esp',
    components: [
      { id: 'esp', part: 'ESP32 DevKitC', type: 'controller', dims_mm: { v: [55, 28, 13], src: 'MEASURED' } },
      { id: 'drv', part: 'TMC2209', type: 'driver', dims_mm: { v: [21, 15, 12], src: 'MEASURED' } },
      { id: 'mot', part: 'NEMA17', type: 'motor', power: { ma: 600 } },
      { id: 'r1', part: '1k resistor', type: 'passive' },
    ],
    pins: [{ pin: 'GPIO18', to: 'drv.step' }], wires: [{ from: 'drv.coil_a', to: 'mot.coil_a' }],
  };
  const P2 = plan(pilot, { printer: 'Bambu Lab P1S' });
  t('pilot: passive parts are not placed and do not FAIL', !P2.results.some((r) => r.level === 'FAIL') && !P2.parts.some((x) => x.id === 'r1'));
  t('pilot: a controller without a library file warns that there is no USB opening', P2.results.some((r) => r.level === 'WARNING' && /esp has no library file.*NO USB opening/.test(r.msg)));
  t('pilot: room for jumpers above a wired module without a library file', P2.parts.find((x) => x.id === 'drv').box.max[2] - P2.parts.find((x) => x.id === 'drv').box.min[2] >= 12 + 14 - 0.05);
  t('pilot: vents only for parts inside the box', !P2.results.some((r) => /vents needed: .*mot/.test(r.msg)));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
