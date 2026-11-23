# cadkit

A Claude Code plugin that checks FreeCAD designs **before** you spend
filament on them. Every printable version gets a design manifest
(`cadkit.yaml`). The validator measures the real geometry against it and
against **your printer's calibrated tolerances**, writes a report, and keeps
"ready to print" behind a gate.

Status: it works on one Windows setup (FreeCAD 1.1, Bambu Lab P1S, PLA). See
[Limits](#limits).

## What you get

| Skill / hook | What it does |
|---|---|
| `cad-validation` | Buildability rules for the designer, plus **cadkit**: walls, mesh, export, screws along their axes, fits, clashes, bought-part clearances, access paths, motion sweeps |
| `cad-review` | A strict pre-print review that starts from the cadkit report |
| `print-settings` | A Bambu Studio settings sheet, issued only when the gate is open |
| `bom` | A bill of materials worked out from the geometry |
| Stop hook | If STLs were written without a current report, Claude must validate before it stops |
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
