# cadkit

A Claude Code plugin for maker projects that combine 3D-printed parts and
Arduino electronics, from the first idea to a working build. A **project
file** (`project.yaml`) keeps the idea, components, wiring, power budget and
build plan in one place and is checked like code. For the CAD side, cadkit
checks FreeCAD designs **before** you spend filament on them. Every printable version gets a design manifest
(`cadkit.yaml`). The validator measures the real geometry against it and
against **your printer's calibrated tolerances**, writes a report, and keeps
"ready to print" behind a gate.

Status: it works on one Windows setup (FreeCAD 1.1, Bambu Lab P1S, PLA). See
[Limits](#limits).

## What you get

| Skill / hook | What it does |
|---|---|
| `idea` | Turns a loose idea into testable requirements, 2-3 concepts with the hard part named, and a `project.yaml` |
| `electronics` | Picks a part per function (owned first), datasheet currents, power design (drivers, common ground, regulators), pins, and a checked `WIRING.md` with tables and a diagram |
| `project` | Keeps `project.yaml` current and checks it: pin clashes, pins without PWM/analog/I2C, overloaded 5V/3V3 board pins, power budget, 3.3 V vs 5 V logic, common ground, coils on signal pins, I2C address clashes, phase gates |
| `plan` | A prioritised build plan: buy (what the inventory lacks), test on a breadboard, print in batches, solder, assemble, flash, with dependencies and "what's next" |
| `cad-validation` | Buildability rules for the designer, plus **cadkit**: walls, mesh, export, screws along their axes, fits, clashes, bought-part clearances, access paths, motion sweeps |
| `cad-review` | A strict pre-print review that starts from the cadkit report |
| `print-settings` | A Bambu Studio settings sheet, issued only when the gate is open |
| `bom` | A bill of materials worked out from the geometry |
| Stop hook | If STLs were written without a current report, Claude must validate before it stops |
| Start hook | A session opened in a project folder gets the project's phase, gate and next step |
| Prompt hook | Mentioning a filament your profile has no tolerances for gives Claude a reminder of what to calibrate |

Every check ends as PASS, FAIL, WARNING or NOT TESTED. The verdict is one of
**NOT READY**, **COUPON FIRST** or **READY FOR TEST PRINT**. A dimension that
is only an estimate (ASSUMED or SCALED) never passes a critical fit. Instead
the report lists exactly what to measure.

## Install

```text
/plugin marketplace add <github-user>/cadkit
/plugin install cadkit@cadkit
```

A private repo needs a GitHub login that can read it (`gh auth login`). To
use a local checkout instead: `/plugin marketplace add C:/path/to/cadkit`.

### Requirements

- [FreeCAD](https://www.freecad.org/) 1.1, used headless (`freecadcmd`).
  It brings Python, numpy and PyYAML.
- Node.js 18 or newer.
- Optional: Bambu Studio 2.x, for `cadkit slice`.

## First-time setup

1. **Config.** Copy `config.example.yaml` to `~/.cadkit/config.yaml`.
   FreeCAD and Bambu Studio are auto-detected, so usually only `tolerances:`
   needs a value. Check what was found:

   ```text
   node <plugin>/skills/cad-validation/cadkit/cadkit.mjs config
   ```

2. **Tolerance profile.** Copy `profiles/example-p1s-pla.yaml` to the path
   you set in `tolerances:`. It holds generic starting values. **The
   validator refuses it until it says `calibrated: true`**, because fits that
   pass on someone else's printer jam on yours.

3. **Calibrate.** Build the coupon and print it (about 15 g, no support):

   ```text
   node <plugin>/skills/cad-validation/cadkit/cadkit.mjs coupon
   ```

   `calibration/out/COUPON.md` lists the 27 numbered features: clearance and
   pilot holes, peg fits, nut pockets, thin fins, horizontal holes and a
   bridge. Enter your results in the profile with
   `source: CALIBRATION <date>`, then set `calibrated: true`.

Your config and profile live outside the plugin folder, so plugin updates
never overwrite them.

## Use

Ask Claude to design or check a part. The skills run cadkit themselves. By
hand:

```text
node <cadkit>/cadkit.mjs new      path/to/project/v3   # manifest template
node <cadkit>/cadkit.mjs validate path/to/project/v3   # -> v3/validation/report.md
node <cadkit>/cadkit.mjs gate     path/to/project/v3   # open only on a current, non-failing report
node <cadkit>/cadkit.mjs slice    path/to/project/v3   # Bambu CLI: time, layers, grams
```

`<cadkit>` is `<plugin>/skills/cad-validation/cadkit`. Build scripts export
each part with `lib/export.py` (`export_part`), so the B-rep, the STL and the
print pose always match.

## Project file

One `project.yaml` per project folder. The template, with a comment on every
field: [skills/project/projkit/templates/project.yaml](skills/project/projkit/templates/project.yaml).
Phases go idea → electronics → cad → firmware → build → done, and each has a
gate: you can't be in `cad` while a component is still a candidate or a pin is
used twice.

```text
node <projkit>/projkit.mjs new    path/to/my-project     # from the template
node <projkit>/projkit.mjs check  path/to/my-project     # FAIL / WARNING / NOT TESTED / PASS + gate
node <projkit>/projkit.mjs status path/to/my-project     # one line
node <projkit>/projkit.mjs plan   path/to/my-project     # build steps in order, what to buy, what's next
node <projkit>/projkit.mjs wiring path/to/my-project --write  # WIRING.md: table per part + Mermaid diagram
node <projkit>/projkit.mjs needs  path/to/my-project     # components as an inventory project file
```

`<projkit>` is `<plugin>/skills/project/projkit`. Pin checks need a pin table
for the board in `projkit/boards/`: Arduino Uno, Arduino Nano and ESP32 DevKit V1 /
DevKitC (ESP32-WROOM-32) are included. On the ESP32 the check also fails
outputs on input-only GPIO34-39 and any use of the flash pins GPIO6-11, and
warns on strapping pins (0, 2, 5, 12, 15) and on analog reads from ADC2 pins
(no analogRead with Wi-Fi on). ESP32 pins are named `GPIO4`; `IO4`, `G4` and
`4` are accepted too. A part that only sends to an input-only pin is read from
its type (button), an analog need or the signal name (`out`, `ao`, `echo`, `int` ...);
otherwise mark the pin `as: input`.
`plan` checks the components against your stock when `inventory_cli` in the
config points at an inventory tool's
`inv.mjs`. YAML is read with a vendored copy of js-yaml (MIT,
`projkit/vendor/`), so projkit needs nothing but Node.

## Adding components and fasteners

Bought parts live in `skills/cad-validation/cadkit/library/components/` (an
Arduino Uno R3, a TT gear motor and an SG90 servo are included). Each
dimension records where it came from (STEP, drawing, datasheet, community,
assumed) and how uncertain it is. A fit passes only if it still holds after
that uncertainty. Details and the file format:
[cadkit/README.md](skills/cad-validation/cadkit/README.md#adding-a-component).
Fastener sizes go in `library/fasteners.yaml`. Their hole ranges go in your
profile.

## Tests

```text
node skills/cad-validation/cadkit/tests/run_tests.mjs
node skills/project/projkit/tests/run_tests.mjs     # project file: pins, power, wiring rules, gates, plan order
```

This builds an Arduino Uno enclosure in 19 variants, each with one seeded
defect, and checks that the validator catches every one. It also tests the
gate, the manifest rules and the profile rule. The tests use their own
tolerance table (`tests/fixtures/`), so the results don't depend on your
printer.

## Privacy

Personal files never belong in this repo. `.gitignore` excludes your config,
your profile, calibration results, generated output, settings, transcripts
and memory files. `scripts/privacy_check.mjs` scans everything that would be
committed for user folders, e-mail addresses, keys and tokens. It also checks
for your own private terms, which you list in `privacy-patterns.local.txt`
(ignored by git). Install it as a pre-commit hook:

```text
node scripts/privacy_check.mjs --install
```

## Limits

- **Tested only on Windows** with FreeCAD 1.1.3 and Bambu Studio 2.08.
  macOS and Linux paths are auto-detected but have never been run.
- `cadkit slice` uses Bambu's **system** presets for a P1S with a 0.4 nozzle.
  Times are estimates, and grams are computed from filament length.
- Strength is not analysed (no FEM). Wall thickness is sampled in 30 planes,
  not everywhere.
- Component models are boxes and cylinders, only as good as their dimensions.
- Only PLA has been calibrated in practice. Any other material needs its own
  block in your profile.
