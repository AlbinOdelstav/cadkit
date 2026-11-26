---
name: electronics
description: Electronics design for an Arduino maker project - choose the controller and a component for every function (owned parts first), look up the datasheet currents and voltages, design the power supply (what runs from the board and what from the adapter or battery, drivers, regulators, common ground, capacitors, flyback diodes), assign the pins, and produce a checked wiring table and circuit diagram. Use when the user runs /electronics, asks "which components do I need?", "vilka komponenter?", "hur kopplar jag?", "kopplingsschema", "wiring diagram", "räcker strömmen?", "can the Arduino power this?", or a project in phase electronics needs its parts and wiring.
model: opus
---

# /electronics: parts, power and wiring that work the first time

Second step of the flow, after `/idea`. Input: the project's `project.yaml`
(functions, constraints, chosen concept). Output: `components`, `pins`, `wires`
and `power` filled in and **checked**, plus a `WIRING.md` with a table per
part and a diagram. Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
The tool: `node <skill dir>/../project/projkit/projkit.mjs`. The field format:
`<skill dir>/../project/projkit/templates/project.yaml`.

**Your stance:** wrong wiring kills parts and costs days. Every number comes
from a datasheet or a measurement, or it is marked ASSUMED and said out loud.
`check` decides whether the wiring is OK, not your impression.

## 1. One component per function, what the user owns first

For each function in `project.yaml` without a `by`:

1. **Stock first.** With the `inventory` skill (or `projkit plan`, which checks
   stock), look for something the user already has that does the job.
2. Otherwise pick something **common, cheap and well documented** with a
   maintained Arduino library, preferably a 5 V-friendly **module** over a
   bare chip. Give one alternative only if the trade-off matters.
3. Add it to `components` with `status: CANDIDATE`, `type`, `needs`
   (pwm / analog / i2c / interrupt ...), `qty`, `inventory` (id or match) and,
   for parts that go in the enclosure, `cad` (library id) or rough `dims_mm`.

**Controller:** count the needs. Uno or Nano by default (pin tables exist);
Nano when it has to be small. Mega only when pins or memory run out. ESP32 for
Wi-Fi/Bluetooth (DevKit V1 / DevKitC: `board: esp32-devkit-v1`), but it is 3.3 V
logic: 5 V parts need a level shifter, GPIO34-39 are inputs only, GPIO6-11 are
the flash, and strapping / ADC2 pins get warnings. Other ESP32 boards (S2, S3,
C3) have no pin table yet, so say that pin checks will be NOT TESTED.

## 2. Datasheet numbers, not memory

For every part: supply voltage `v`, logic voltage `logic_v`, typical current
`ma`, **peak** current `peak_ma` (motor stall, servo start, LED strip full
white, Wi-Fi transmit), with `src: DATASHEET` and a `datasheet:` link. Look them
up (web search: the module's product page or the chip's datasheet). A number
you could not find is `src: ASSUMED` and goes into the summary as something to
check. I2C parts get their `i2c_addr` (and whether it can be changed).

## 3. Power: decide it before the pins

Rules. `check` enforces the starred ones:

- ★ **Motors, pumps, servos, solenoids, relay coils and LED strips never run
  from a board pin, and not from the board's 5V pin** beyond what it can give
  (Uno/Nano: ~400 mA in total, 3V3: 50 mA). They get the adapter or battery
  directly, through a driver: a motor driver (TB6612FNG rather than L298N, which
  drops ~2 V), a **logic-level** MOSFET (IRLZ44N, AO3400; not IRF520 modules at
  5 V gate) with a flyback diode, or a relay **module**.
- ★ **Common ground:** the supply's gnd connects to the board's GND
  (`wires: - {from: supply.gnd, to: board.GND}`).
- ★ Voltages match the rail they hang from: no 3.3 V part on the 5V pin,
  no 12 V motor on 5 V. A 3.3 V-logic part on a 5 V board needs a level shifter
  unless it is a module with one built in.
- ★ The sum of peaks stays under 80 % of the source (`power.source.max_ma`).
- Capacitors: 100-470 µF across a servo/motor supply near the load, 1000 µF +
  a 330 Ω data resistor for addressable LED strips, 100 nF on bare chips.
- Battery: work out the runtime (mAh ÷ average mA × ~0.8) against `idea.must`.
  Li-ion only with protection: a TP4056 module **with** a protection IC, or a BMS
  for cells in series. Never an unprotected pack.
- Mains (230 V) stays outside the project: a certified adapter, or a ready-made
  smart plug. Never mains wiring on a breadboard.

Write `power.source` (part, `v`, `max_ma`) and `power.notes` for the design choices.

## 4. Pins and wires

- `pins`: every connection **on the controller**, signal **and** power
  (`5V`, `3V3`, `GND`). `wires`: every connection **not** on the controller:
  driver outputs to the motor, the supply to drivers, `supply.gnd` to `board.GND`.
- Pin choice: PWM pins for speed/brightness, interrupt pins (D2, D3) for
  encoders and buttons that must not be missed, analog pins for analog sensors,
  I2C on its fixed pins (several devices share them), SPI on its fixed pins.
  Keep D0/D1 (USB serial) free; D13 has the on-board LED.
- Buttons: `pullup: internal` (button to GND, `INPUT_PULLUP`) unless there is a
  reason not to. LEDs: `resistor_ohm` ((5 V − Vf) ÷ ~10 mA, e.g. 220-330 Ω).
- Quote names with commas: `part: "BME280 module (5 V, level shifted)"`.

## 5. Check, document, show

1. `node .../projkit.mjs check <folder>`: **no FAIL**. Fix the design, not the
   check. Explain each WARNING you keep, and give every NOT TESTED a value or a question.
2. `node .../projkit.mjs wiring <folder> --write` writes `WIRING.md` (a table per
   part + a Mermaid diagram that renders on GitHub and in VS Code).
3. Show the user: the parts list (owned / to buy), the power design in two or
   three sentences (what feeds what, and why), the wiring tables, and what was
   ASSUMED. Offer a visual diagram if they want one.
4. When the user agrees, set the components to `DECIDED` (or `OWNED`), write the
   choices in `decisions`, and check again. With the gate OPEN: set
   `phase: cad` (or `firmware` if nothing is printed), and update `next_step`.
   With many parts, suggest `/plan`: the breadboard test comes before soldering.
   The code comes next with `/firmware`, which builds `pins.h` from these pins, and
   the box with `/enclosure`, which needs a `cad:` or measured `dims_mm` per part.

## Never

- Power a motor, pump, servo or coil from a signal pin, or several from the board's 5V pin.
- Leave out the common ground between two supplies.
- Present an ASSUMED current as known, or skip the peak (stall) current.
- Design anything that connects to mains voltage.
