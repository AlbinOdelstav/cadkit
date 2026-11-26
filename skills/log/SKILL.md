---
name: log
description: Keep the maker project's log (LOG.md next to project.yaml) - what was done, measured values, problems and their fixes, decisions, parts bought and printed - and answer "what did we do last time?", "where was I?", "vad gjorde vi sist?", "vad mätte jag?", "what's still broken?". Use when the user runs /log, reports a result or a measurement, says something broke or got fixed, finishes a work session, or returns to a project after a break.
model: sonnet
---

# /log: the project's memory

Projects last weeks. The log keeps what happened between sessions: readings,
problems tried and solved, what was printed and bought. `project.yaml` holds the
current truth (parts, pins, decisions); `LOG.md` holds the history. Answer in the
user's language; write the log entries in the language the user writes in.

`<skill dir>` below is this skill's base directory, shown when the skill loads.

```
node <skill dir>/../project/projkit/projkit.mjs log <project> "what happened" --kind <kind>
node <skill dir>/../project/projkit/projkit.mjs log <project> [--last 30]     # latest entries + open problems
```

Kinds: `note` · `done` · `measured` · `problem` · `fixed` · `decided` · `bought` · `printed`.

## What to log, without being asked

- **measured**: every number from the real world, with units and conditions
  ("soil sensor 520 dry, 260 in a glass of water", "6.1 V at the driver while the motor starts").
- **problem** and **fixed**: what went wrong, then what fixed it, using the same
  key words, so `log` can tell which problems are still open.
- **done**: plan steps finished (also set `done: true` in the plan).
- **printed** (part, material, grams, settings that mattered) and **bought** (part, shop, price).
  For a project component add `--item <component id> [--qty n]`: the inventory gets the
  stock (through `inventory_cli`), then set the component's `status: BOUGHT`. A part that is
  new to the inventory has no `inventory: {id}` yet: add it with the inventory skill first,
  then write its id into project.yaml. Filament used for a print: `inv.mjs adjust <filament id> -<grams>`.
- **decided**: also write it in `project.yaml` `decisions`; the log entry says when.

One fact per entry, short, specific. Never log guesses as measurements.

## When the user comes back

The session start hook shows the last entry and open problems. For "where was I?":
read `log --last 30`, `projkit status`, and the plan, then answer with what was done
last, what is open, and the next step, in three or four lines.

## At the end of a work session

Log what was done and anything left half-finished (a `note`: "pump wired, not
tested yet"). Update `next_step` in `project.yaml`.
