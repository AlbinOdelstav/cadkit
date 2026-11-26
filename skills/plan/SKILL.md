---
name: plan
description: Make or update a prioritised step-by-step build plan for a maker project (3D-printed parts + Arduino/electronics) - what to buy first, which parts to print in which batch, what to breadboard-test, when to solder and wire, what to assemble first, when to flash the firmware - and track what is done and what is next. Use when the user runs /plan, asks "what do I do first?", "vad gör jag nu?", "i vilken ordning?", "what's next?", "nästa steg", has many parts to print or build, or says a step is done.
model: sonnet
---

# /plan: the order to build it in

A project with many printed parts and components goes wrong in the **order**:
everything printed before one test fit, a module soldered before it was
tested, a part ordered last that takes two weeks to arrive. This skill writes
the `plan:` section of the project's `project.yaml` and keeps it current.
Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
The tool: `node <skill dir>/../project/projkit/projkit.mjs`. Step format: the
`plan:` comments in `<skill dir>/../project/projkit/templates/project.yaml`.

## 1. Gather

- `project.yaml`: components (status, qty), functions, pins, power, open questions.
- CAD, if any: `mechanics.cad` → the current `vN/cadkit.yaml` (parts, fasteners,
  `installed_before` = assembly order hints) and `vN/*/build_report.txt` (grams,
  print times). A `BOM.md` from `/bom` if there is one.
- **Stock:** `node .../projkit.mjs plan <folder>` checks the components against
  the inventory when `inventory_cli` is set in the cadkit config. It lists what is
  MISSING or SHORT. If it says "inventory not checked" and the `inventory` skill is
  installed, use that skill instead. If neither is available, say the stock was not checked.

## 2. Build the steps

Each step: `id`, `kind` (buy | print | test | solder | wire | assemble | flash |
calibrate | measure), `what` (one concrete action), `parts` (component ids and
printed part names), `after` (what must be done first), `why` when the order
is not obvious. Derive the order from these rules, in this priority:

1. **Buy first, grouped by shop**, and the longest delivery first. Everything
   MISSING or SHORT gets a buy step. Not decided yet? Then the step is
   "decide X" (kind `measure`/`test`) before the buy step, not a guess.
2. **Reduce risk before spending.** The part of the concept that might not work
   (the "hard part" from /idea) is tested first, as cheaply as possible:
   breadboard + test sketch, a test coupon for a tight fit, a single print
   of the key part.
3. **Electronics: loose → tested → permanent.** Breadboard each subsystem with
   a small test sketch (`flash` + `test`) → whole circuit on the breadboard →
   only then `solder`. Measure the supply voltage before connecting the board.
4. **Printing in batches:** test coupon or the part everything else mounts to
   first. Then batches that fit one plate and share material/colour (from the
   build reports), so the printer runs while you solder. Long prints overnight.
5. **Assembly inside-out:** what gets covered goes in first; a screw needs its
   driver path (`installed_before` in cadkit.yaml). Wiring goes in before the
   part that blocks access to it. Firmware is flashed and tested **before** the
   lid closes, while USB is still reachable.
6. Last: calibrate (thresholds, speeds), the final test against every
   `idea.must`, then close up.

Steps that do not depend on each other can run in parallel: give them the same
`after`, and say so ("while the chassis prints, solder the driver").

## 3. Check, write, show

1. Write `plan:` in `project.yaml` (keep earlier steps' `done: true`).
2. `node .../projkit.mjs plan <folder>` must have no FAIL. It catches loops,
   a part used before the step that buys/prints it, components that are
   missing with no buy step, soldering without a test before it, and many
   prints with no test fit first. Fix the plan, don't argue with it.
3. Show the user the plan as a numbered checklist, grouped in stages
   (Köp / Skriv ut / Testa / Löd / Montera / Kod), with the shopping list on
   top and **what to do now** in bold, plus what can run alongside it.
4. Update `next_step` in `project.yaml` to the first ready step.

## When a step is done

Set `done: true` on it, log it (`projkit log ... --kind done`, readings as `measured`), and put
decisions in `decisions`. For a `test` step on the breadboard, the bringup skill has the checklist.
Run `plan` again and tell the user what is next. If reality changed the plan
(a part did not fit, a module died), change the steps, don't just tick them.

## Never

- Put a buy step for something the inventory says the user has, or leave out one it lacks.
- Plan printing all parts before the riskiest fit has been tested.
- Plan soldering before the circuit has worked on a breadboard.
