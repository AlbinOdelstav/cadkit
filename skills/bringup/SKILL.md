---
name: bringup
description: Guide the first power-up and the troubleshooting of a maker project's circuit, one part at a time - no-short check, supply voltage, the controller alone, then each sensor, display and actuator with what to connect and what you should see - and debug it when something does not work (nothing happens, resets when the motor starts, I2C device not found, garbage on serial, gets hot). Use when the user runs /bringup, says "I've wired it", "jag har kopplat", "nu ska jag testa", "it doesn't work", "det funkar inte", "den startar om", "inget händer", "something got hot", or a plan step of kind test is next.
model: opus
---

# /bringup: power it up without smoke

The moment parts get power for the first time is where boards die. This skill
walks the user through it in small steps and debugs from measurements, not
guesses. Answer in the user's language; the user does the physical work, you
say exactly what to connect and what to look for.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
- `node <skill dir>/../project/projkit/projkit.mjs bringup <project> --write` → `BRINGUP.md`,
  the checklist generated from `project.yaml` (wiring, supply, I2C addresses, requirements).
- `node <skill dir>/../project/projkit/projkit.mjs log <project> "..." --kind measured|problem|fixed`
- the firmware tools for test sketches, upload and serial (`/firmware`, `fwkit`).

## Before you start

`projkit check <project>` has no FAIL and `WIRING.md` is current (`projkit wiring --write`).
If the wiring on the table differs from project.yaml, project.yaml is updated first.

## The order (BRINGUP.md has it filled in)

1. **No power yet:** compare the wiring with WIRING.md, then the no-short check
   with a multimeter (5V ↔ GND, 3V3 ↔ GND, supply + ↔ −).
2. **Supply alone:** measure the voltage unloaded and its polarity. Common ground next.
3. **Controller alone:** upload a blink + "alive" sketch, see it on the monitor.
4. **One part at a time**, lowest risk first (sensors and inputs, then displays and LEDs,
   then servos, drivers and motors). For each: power off while wiring, power wires
   first, a test sketch, the expected result, then log the reading.
5. **Everything together**, then each `idea.must` tested the way a user would.
6. Only then solder and mount, and repeat the no-short check afterwards.

One step at a time: ask what the user sees before giving the next step. Log every
measured value (thresholds, voltages under load) with `--kind measured`: calibration
and the firmware constants come from there.

## When it does not work

Ask for **one measurement or one observation at a time**, and say what each
answer would mean. Start with the cheap, common causes:

| Symptom | Check first |
|---|---|
| Nothing at all | USB cable carries data? Board LED on? Correct port and fqbn? |
| Board resets / garbage when a motor, servo or pump starts | Supply sags: measure the voltage at the part while it starts. Not from the board 5V. Capacitor across the motor supply. Common ground. |
| I2C device not found | Power at the module, SDA/SCL swapped, address (scanner), 3.3 V module on 5 V, pull-ups on a bare chip |
| Garbage on the serial monitor | Baud (`firmware.baud` / SERIAL_BAUD), or the board resets (see above) |
| Button reads randomly | No pull-up (`INPUT_PULLUP`), button wired across the wrong legs |
| Analog value stuck at 0 or 1023 | Sensor not powered, wrong pin, signal shorted to GND/5V |
| Something gets hot | **Unplug now.** Then: a short, a part on the wrong voltage, a motor stalled, a regulator above its current |
| Works on USB, not on the battery/adapter | The supply's voltage under load, VIN vs 5V pin, common ground |

Log the problem (`--kind problem`) and the fix (`--kind fixed`), so a later session
knows what was tried. If the fix changes the circuit, update project.yaml and run
`check` again: the file must keep describing the real circuit.

## Never

- Tell the user to connect several new parts at once on the first power-up.
- Skip the no-short check, or wire with the power on.
- Guess a cause without asking for the measurement that would show it.
- Debug mains-powered parts: stop and send the user to a qualified person.
