---
name: enclosure
description: Design the 3D-printed enclosure around a maker project's electronics - decide what goes inside, on the lid, in the wall or outside, lay the parts out from their real dimensions (cadkit component library or measured sizes), work out the openings (USB, cable exits, display window, buttons, vents) and the box size, then build it in FreeCAD and hand it to cadkit validation. Use when the user runs /enclosure, asks for "a box/case/housing for this", "en låda", "ett hölje", "en kåpa", "where does everything go?", or a project reaches phase cad with electronics inside.
model: opus
---

# /enclosure: a box that fits what is really inside it

Input: `project.yaml` with decided components (electronics gate open, or close).
Output: a CAD version folder `vN/` with `layout.yaml` + `LAYOUT.md` + `layout.svg`
(where everything goes and why), a `cadkit.yaml` whose components come from that
layout, and the FreeCAD geometry, validated by cadkit. Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
Tools:
- `node <skill dir>/encl/encl.mjs plan <project> [--write <vN folder>]`: the layout
- `node <skill dir>/../cad-validation/cadkit/cadkit.mjs new|validate|gate <vN>`: manifest and validation
- the `cad-validation` skill (rules for building the geometry) and `cad-review` (before printing)

**Your stance:** a box is designed around measured parts, plugs and fingers, not
around a guess. A USB plug that cannot go in is the most common failed enclosure.

## 1. Sizes you can trust

Every part that goes **inside** or **on the lid** needs a size:

- `cad: <library id>` when the part is in the cadkit component library
  (`<skill dir>/../cad-validation/cadkit/library/components/`): envelope,
  mounting holes, connectors and the room their plugs need, all with sources.
- A board with mounting holes or connectors that is **not** in the library:
  add a library file (format: `<skill dir>/../cad-validation/cadkit/README.md`,
  "Adding a component"), with each dimension's source. Then use `cad:`.
- **The controller especially:** without a library file the USB position is unknown and
  encl makes no USB opening (it warns). Add the board to the library once it is measured.
- Resistors and capacitors (`type: passive`) ride on the wiring and are not placed.
- Otherwise `dims_mm: {v: [l, w, h], src: MEASURED}`: ask the user to measure
  with calipers. A DATASHEET size is fine for a first layout; an ASSUMED one is
  a WARNING that must be measured before the CAD is final.

## 2. Where each part goes (ask the user only what you cannot infer)

In `project.yaml`, per component:

- `mount`: `inside` (default) | `lid` (displays, buttons, LEDs the user looks at or
  presses) | `wall` (panel jacks, switches) | `outside` (probes, motors, sensors
  that must touch air/soil/light; only their cable comes in) | `none`.
- `access`: connectors that must be reachable with the lid on. The controller's
  USB is the default: the firmware must stay uploadable without opening the box.
- `exit`: which wall an outside part's cable leaves through (`+x`, `-x`, `+y`, `-y`).

Also `mechanics.printer` (build volume) and `mechanics.material`.
Think about: temperature and humidity sensors **away** from drivers and
regulators (they read their heat), a light sensor needs a window, a buzzer a
grille, an antenna no metal around it, heavy parts low, a battery reachable.

## 3. Layout

1. `node .../encl.mjs plan <project>`: no FAIL. It places the controller with its
   USB jack against the `-x` wall, the rest in rows with room for wires and fingers,
   boards with a solder side on standoffs, and adds height for jumper wires above
   the headers. It lists every opening and checks the build volume and
   `idea.constraints.size_mm`.
2. Look at the result critically and fix what the rows got wrong: a sensor next to
   the driver, the display not lined up with its lid window, a cable that crosses the
   box. Change `mount` / `access` / `exit`, the component order, or sizes, and run it
   again. Defaults (wall 2.4, gap 4, standoffs ≥ 5 mm, ...) are listed in `layout.yaml`.
3. Show the user the top view (`layout.svg`), the outer size, and the openings, and
   get an OK before building geometry.

## 4. Build it

1. Version folder: `<project>/<mechanics.cad>/vN` (next free N). Set `mechanics.cad`
   in `project.yaml` if it is `none`. `node .../cadkit.mjs new <vN>`, then
   `node .../encl.mjs plan <project> --write <vN>`.
2. `cadkit.yaml`: copy `manifest_components` from `layout.yaml` into `components`.
   Every cable exit, vent and window that is fastener-sized goes in
   `holes_not_fasteners` with its reason.
3. `build.py` + `params.py` (FreeCAD, exported with `lib/export.py`) read
   `layout.yaml`, so a layout change moves the geometry. Follow the
   `cad-validation` skill. Usually:
   - **base**: floor, walls, standoffs at the library's mounting holes (self-tap
     pilot or heat-set insert from the tolerance profile; skip holes the library
     notes as blocked), wall openings from `openings` (plug size + clearance,
     chamfered), vents as slots near the warm parts, strain relief at cable exits.
   - **lid**: windows and holes from the lid openings, a locating lip, screws into
     corner posts (or snap fits if the user wants no screws).
   - print poses: base open side up, lid outside face down (clean surface, no
     support for windows).
4. `node .../cadkit.mjs validate <vN>`, then `gate`. Fix every FAIL. Then
   `cad-review` before anything is printed. For a tight fit (USB opening, standoff
   pilot), a test coupon first: `/plan` puts it before the full print.

## 5. Hand over

Record the choices in `decisions` (why the USB is on that side, why the lid has
screws), add the print and assembly steps to the plan (`/plan`: coupon → base →
fit the board → lid), and update `next_step`.

## Never

- Place a part whose size is a guess without saying it must be measured.
- Close off the USB (or whatever reprograms the board) behind a screwed lid.
- Call the box ready to print without cadkit's gate and `cad-review`.
