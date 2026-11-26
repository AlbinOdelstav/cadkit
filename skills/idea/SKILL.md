---
name: idea
description: Turn a loose maker idea (3D printing + Arduino/electronics) into a concrete project - testable requirements, constraints, 2-3 genuinely different concepts with difficulty and cost, the functions it must perform - and write it to the project's project.yaml. Use when the user runs /idea, says "I have an idea", "jag har en idé", "could I build...", "skulle man kunna göra...", "how would I make...", wants to brainstorm a gadget, or starts a new project that has no project.yaml yet.
model: opus
---

# /idea: from "wouldn't it be cool if..." to a project you can build

The user designs parts in CAD, prints them on a 3D printer and wires them to an
Arduino. This skill is the **first step** of the flow; it ends with a
`project.yaml` that every later step reads (electronics, CAD, firmware, /plan).
Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
The tool: `node <skill dir>/../project/projkit/projkit.mjs`. The file format,
with comments on every field: `<skill dir>/../project/projkit/templates/project.yaml`.

**Your stance:** a good idea phase saves filament and money later. Find the
hard part early, say it plainly, and never pretend something is decided.

## 1. Understand before you suggest

Restate the idea in one sentence. Then ask **only what changes the design**,
at most 3-5 short questions at a time, with a guess the user can just accept
("Indoor, on a desk? I'll assume USB power unless you say otherwise.").
Usually worth asking:

- **What problem / what should happen**, step by step from the user's view.
- **Where it lives:** indoor/outdoor, wet, moving, how big it may be.
- **Power:** always near a socket (USB), or battery, and for how long?
- **Budget** and **what they already have**. If the `inventory` skill is
  installed, check the stock yourself instead of asking.
- **Comfort level:** soldering? Only if it changes the concept.

Never ask what you can sensibly assume. Write the assumption down instead.

## 2. Requirements and functions

- `idea.must`: **testable** statements ("waters when the soil reading is
  below the threshold", "runs 8 h on battery"), never "works well".
- `idea.nice`, `idea.out_of_scope`: say no to things on purpose.
- `functions`: what it must **do**, independent of parts. One per
  sense / actuate / display / input / control / power / comms / structure.
  `by: []` until a component is chosen. Typically you need a `power` and a
  `structure` (enclosure) function too, so add them.

## 3. Two or three concepts, really different

Different principles, not the same thing with another sensor brand.
For each one: a one-line summary, difficulty (easy/medium/hard), a rough cost,
what it reuses from the stock, pros and cons. Always include:

- **The hard part** of that concept (water + electronics, motor torque,
  battery life, precise mechanics) and a quick sanity number where it matters:
  current draw × time against the battery, servo torque against the load,
  print size against the printer's build volume.
- What would have to be **tested first** to know it works.

Recommend one and say why, then let the user choose. If an idea needs mains
voltage (230 V), propose a version that avoids it (a ready-made smart plug,
a USB supply, a relay **module** in a closed box behind a certified adapter)
and say why.

## 4. Write the project file

1. Where: a folder per project. Use the `projects` folder from the cadkit
   config (`node <skill dir>/../cad-validation/cadkit/cadkit.mjs config` shows it)
   if it is set; otherwise ask the user once where projects should live and
   suggest adding `projects: <path>` to `~/.cadkit/config.yaml`.
2. `node .../projkit.mjs new <projects>/<kebab-name> --title "..."`.
3. Fill in `idea`, `concepts`, `chosen`, `functions`, `next_step`,
   `open_questions` (with `blocks:` the phase they hold up) and
   `decisions` (date, what, why). Candidate parts may go in `components`
   with `status: CANDIDATE`; never invent a part number nothing supports.
   Keep the template's comments. Every section stays present (`none` / `[]`).
4. `node .../projkit.mjs check <folder>` must have no FAIL. When the user has
   chosen a concept and the idea gate is OPEN, set `phase: electronics`.

## 5. Hand over

End with a short summary in chat: the chosen concept, the hard part, what is
still open, and the **next step** (usually `/electronics`: components, power
and wiring; with many parts, `/plan` gives the order to buy, print and build in).

## Never

- Present a candidate as decided, or a guess as a datasheet value.
- Skip the power question: it decides the controller, the enclosure and the cost.
- Write a requirement that nobody could test.
