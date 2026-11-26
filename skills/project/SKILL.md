---
name: project
description: Read and keep up to date the project.yaml that ties a maker project together (idea, components, pins, power budget, CAD folder, firmware, build plan, decisions) and check it with projkit - pin clashes, pins without PWM/analog/I2C, overloaded 5V/3V3 board pins, power budget against the supply, 3.3 V vs 5 V logic, phase gates. Use when the user asks "where am I in the project?", "var är jag?", "status", "is the wiring OK?", "räcker strömmen?", when components, pins or power change, when a phase is finished, or whenever another step needs the project's facts.
---

# The project file

One `project.yaml` per project, in the project's root folder: the facts every
step shares. `/idea` writes the idea; component choice fills `components`,
`pins` and `power`; CAD reads component dimensions; firmware reads `controller`
and `pins`; `/plan` writes `plan`. Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.

```
node <skill dir>/projkit/projkit.mjs new <folder> [--title "..."]
node <skill dir>/projkit/projkit.mjs check <folder>     # FAIL / WARNING / NOT TESTED / PASS + the phase gate
node <skill dir>/projkit/projkit.mjs status <folder>    # one line
node <skill dir>/projkit/projkit.mjs plan <folder>      # build order + stock (see the plan skill)
node <skill dir>/projkit/projkit.mjs needs <folder>     # components as an inventory project file
node <skill dir>/projkit/projkit.mjs boards             # boards with a pin table
```

The format, with a comment on every field: `<skill dir>/projkit/templates/project.yaml`.

## Rules

- **The file is the truth, chat is not.** When something is decided, measured
  or changed, write it into the file in the same turn (`decisions` gets the
  date, what and why) and bump `updated`.
- **Run `check` after every change** and fix FAILs before you say anything
  about the wiring or power being fine. A NOT TESTED line is not a pass: say
  what is missing (a board without a pin table, a current nobody looked up).
- **Sources:** `power.src` is DATASHEET, MEASURED or ASSUMED. An ASSUMED
  current is a question to the user or a datasheet lookup, not a fact.
- **Component status:** CANDIDATE (proposed) → DECIDED (chosen) → OWNED/BOUGHT.
  A CANDIDATE closes the electronics gate.
- **Phases** go idea → electronics → cad → firmware → build → done. Only move
  `phase` forward when `check` says the current gate is OPEN; a phase past a
  closed gate is a FAIL.
- `pins` lists both signal pins (`D5 -> driver.pwma`) and power pins
  (`5V -> servo.vcc`), so the check can add up what hangs on the board's own
  5V/3V3 pins. A motor or servo on the board's 5V pin is the classic brown-out.
- A board with no file in `projkit/boards/` gets no pin checks. Add a pin table
  (copy `arduino-uno.yaml`, cite the source) rather than skipping it.

## "Where am I?"

Run `status` (or `check` for detail) and answer with: the phase, what closes
the gate, the next step and what can be done alongside it. If the project has
many steps, use the plan skill.
