# cadkit: automated validation for 3D-printed designs

Built for a FreeCAD + Bambu Lab P1S workflow. It sits inside the
`cad-validation` skill (cadcheck.py) and reuses `cad-review`'s
cadreview.py mesh helpers. Setup and install: see the README at the
plugin root.

**What it does:** given a version folder with exact parts (.brep), print
STLs and a **mandatory design manifest** (`cadkit.yaml`), it runs every
check it can, measured on the geometry, and writes a report in which each
check is PASS, FAIL, WARNING or NOT TESTED. The verdict is NOT READY,
COUPON FIRST or READY FOR TEST PRINT. A print gate and a Stop hook keep
"ready to print" from being claimed without a current report.

## Quick start

```powershell
# 1. In the build script: export each part
#    from lib.export import export_part  ->  parts/<name>.brep + stl/<name>.stl
# 2. Write the manifest
node <plugin>/skills/cad-validation/cadkit/cadkit.mjs new path/to/project/v3
# 3. Validate (about 20-60 s)
node <plugin>/skills/cad-validation/cadkit/cadkit.mjs validate path/to/project/v3
# 4. Before slicing / printing
node <plugin>/skills/cad-validation/cadkit/cadkit.mjs gate path/to/project/v3
node <plugin>/skills/cad-validation/cadkit/cadkit.mjs slice path/to/project/v3
```

Report: `v3/validation/report.md` (and `report.json`, with sha256 of every
checked file). Exit codes: 0 ready, 1 NOT READY, 2 COUPON FIRST, 3 tool error.

## Architecture

```
cad-validation/
  cadcheck.py            existing buildability functions (unchanged, reused)
  SKILL.md               designer rules + how to run cadkit
  cadkit/
    cadkit.mjs           launcher: validate | gate | scan | new | slice | coupon | config
    config.mjs           machine settings (config.yaml, env vars, auto-detection)
    validate.py          runs inside freecadcmd; no switches to skip checks
    slice.mjs            Bambu Studio CLI slicing
    lib/
      manifest.py        loads + enforces the manifest
      library.py         components, fasteners, tolerances, dim provenance
      geom.py            probes: free radius along an axis, sections, holes
      config.py          the same settings, Python side
      morph.py           numpy morphology + labelling (no scipy needed)
      checks_part.py     per part: solid, export vs model, mesh, bed, walls, slender, overhang
      checks_fast.py     every screw along its own axis
      checks_asm.py      clashes, bought-part clearance, keep-outs, fits, access, motion
      report.py          statuses, verdict, "measure these", markdown/json
      export.py          export_part() for build scripts
    library/
      fasteners.yaml     M2-M5: heads, nuts, washers, heat-set inserts
      components/*.yaml  bought parts with sourced, uncertain dimensions
    calibration/         coupon generator + COUPON.md
    templates/cadkit.yaml
    hooks/               filament_reminder.mjs, validation_gate.mjs
    tests/               seeded-defect suite (fixtures/: the tests' own tolerance table)
cad-review/cadreview.py  existing STL review (unchanged); cadkit imports its mesh helpers
```

The roles: **designer** = the normal session, following cad-validation's
SKILL.md. **Validator** = these scripts, which do not read anyone's claims,
only geometry and the manifest. **Engineer** = `cad-review` run as a
fresh-context subagent, reading the report, the manifest and the renders.

Why not an MCP tool: the FreeCAD MCP server needs the GUI and its RPC
add-on. Headless `freecadcmd` needs neither. Claude runs the launcher through the shell like any other tool.

Dependencies: none new. FreeCAD 1.1 (Part, Mesh, MeshPart, numpy, PyYAML),
Node for the launcher, Bambu Studio 2.08 for slicing.

## What is checked

| Area | Check | Catches |
|---|---|---|
| manifest | all sections present, material calibrated | forgotten fasteners looking like "no fasteners" |
| export | STL newer than sources; STL = model in print pose (size, volume) | stale exports, unit/scale errors, wrong pose |
| geometry | valid B-rep, ONE solid | lumps that touch but are not fused |
| mesh | one shell, watertight, manifold, outward normals, no self-intersection | broken STLs |
| print | bed fit, first-layer area, slender free-standing features, self-supporting (ledge/bridge per layer) | parts that topple, thin pins and bars that snap off, hovering features |
| walls | thinner than 0.8 (FAIL) / 1.2 (WARN), gaps that fuse; 30 sections in X, Y and Z. A small spot you accept on purpose goes under `thin_ok` (within 3 mm, max_area <= 5 mm2, always a WARNING) | walls the slicer drops |
| fasteners | per screw: reaches every joined part, head room, head bears, clearance hole, pilot size, thread engagement, free to its tip, hex nut fits (corners too), nut has a straight insertion path, screwdriver reaches, in stock | screws that join nothing, bottom out, bind, cannot be reached |
| fasteners | fastener-sized holes nobody declared | holes from an old design or a forgotten screw |
| assembly | every pair of parts, bought parts and screws | clashes nobody thought to test |
| components | clearance to printed parts beyond the dimension uncertainty | "fits" that rest on a guess |
| access | connector plugs, solder side, cable/tool paths | USB that cannot be plugged in |
| fits | gap per side in sections along the insertion axis, against the tolerance table | lids that jam or rattle |
| motion | sweep of a moving part over its range, longest clear run | mechanisms that foul mid-stroke |
| slicer | `cadkit slice`: Bambu CLI time, layers, filament, warnings | separate step, not in the gate |

**Never checked** (always listed under "Not verified"): strength (no FEM:
FDM layer adhesion and infill make a linear FEM misleading), the order of
assembly beyond `installed_before` / `nut_before`, nut paths that are not straight lines, anything about a
bought part that its library file does not model.

## Uncertainty model (risk-based measuring)

Every component dimension has `src` and `unc` (±mm):

| src | default ± | meaning |
|---|---|---|
| MEASURED / CALIBRATION / STEP | 0.1 | calipers, coupon, manufacturer 3D model |
| DRAWING | 0.2 | official dimensioned drawing / board file |
| DATASHEET | 0.3 | datasheet table |
| DISTRIBUTOR | 0.4 | Adafruit/DFRobot/Digikey drawings |
| COMMUNITY | 0.6 | forums, measurements by others |
| SCALED / ASSUMED | 1.0 / 1.5 | never PASS a critical check |

A clearance PASSes only when it still holds after subtracting the
uncertainty of the dimensions it rests on. When it doesn't, the check is a
WARNING and the report's **"Measure these"** lists exactly those dimensions.
You measure only what a real fit depends on. Put the result in the
manifest:

```yaml
components:
  - id: uno
    ref: arduino-uno-r3
    measured: {h3_x: {v: 66.0, unc: 0.05}, h4_x: {v: 66.0, unc: 0.05}}
```

Bodies can say which dims their clearance depends on (`unc_from`), so a
USB plug's uncertain LENGTH does not count against the clearance around it.

## Adding a component

1. Copy `library/components/arduino-uno-r3.yaml` to `<id>.yaml`.
2. `dims`: every number with `v`, `src`, `unc`, `ref`, plus `label` (en/sv)
   and `group` (used by inventory tools that show dimensions). Prefer official files (Arduino CAD
   zip, manufacturer STEP) and record the source under `sources`.
3. `bodies` (solid), `keepouts` (space that must stay empty), `connectors`
   (plug keep-outs, active when the manifest lists them in `connectors_used`).
   Boxes `{min, size}` and cylinders `{base, dir, d, h}`; values can be
   arithmetic over dim names. `holes:` cut through a body.
4. `inventory_ids`: optional ids of matching rows in your own inventory.
5. `confirm`: what to measure on your own part if a check asks.
6. Smoke test: build it in a test manifest and run validate.

Claude asks before downloading a manufacturer STEP/zip. STEP bodies can
replace boxes later (not implemented yet: today the shapes are primitives).

## Adding a fastener size

Add the thread to `library/fasteners.yaml` (d, pitch, heads with dk/k/driver_d,
nut, washer, insert), then its hole ranges per material in
your tolerance profile (`holes.clearance`, `holes.self_tap_pilot`).

## Tolerances and calibration

Tolerances live in YOUR profile (config key `tolerances`), per material,
starting from `profiles/example-p1s-pla.yaml` (generic DEFAULT values).
The validator refuses a profile until it says `calibrated: true`. Calibrate:

1. `node cadkit.mjs coupon` makes `calibration/out/coupon_plate.stl`
   + `coupon_pegs.stl` (~15 g) and `COUPON.md`.
2. Print, test each row as COUPON.md says, enter the values, set
   `source: CALIBRATION <date>`, then `calibrated: true`.

A **new material** (one your profile has no block for) has no table, so every manifest using it
FAILs until a block is added and calibrated. The `filament_reminder` hook
reminds Claude whenever another filament is mentioned.

## Hooks (registered by the plugin, hooks/hooks.json)

- `UserPromptSubmit` → `hooks/filament_reminder.mjs`: an uncalibrated filament
  is named → a reminder of what to update.
- `Stop` → `hooks/validation_gate.mjs`: STLs written during this session in a
  folder under the session's cwd without a current, non-failing report →
  Claude is told to validate before it stops (once per stop, cannot loop).

## Tests

```powershell
node tests/run_tests.mjs          # builds the test design, then -> tests/RESULTS.md
```

`uno_box` is an Arduino Uno enclosure in 19 variants, each with ONE seeded
defect, plus gate, manifest and profile tests. The tests use their own
tolerance table (`tests/fixtures/`), not yours. Run them after every change
to the checks.

## Known limitations

- Wall thickness is sampled in 30 planes, not everywhere; features thinner
  than ~0.3 mm2 per section are ignored (corner noise).
- Fits are checked in sections normal to one axis; rounded or conical fits
  are measured at the sampled depths only.
- Free-radius probing reads ±0.25 mm in depth (probe step); hole diameters
  are exact on the B-rep.
- The slicer step uses Bambu's system presets; its grams are computed from
  filament length, and supports are not evaluated by it.
- Component models are boxes and cylinders, as good as their dims.
- Uncertainty is one number per body (the worst dim it uses), not per
  direction.
