---
name: firmware
description: Write, compile, upload and test the Arduino code for a maker project from its project.yaml - pins.h generated from the wiring, a small test sketch per subsystem before the full program, compile with flash/RAM use, upload to the connected board, read the serial output. Use when the user runs /firmware, asks to "write the code", "programmera arduinon", "skriv koden", "ladda upp", "upload", "it doesn't work", "serial monitor", "kompilera", or a project reaches phase firmware or a breadboard test step in its plan.
model: sonnet
---

# /firmware: code that matches the wiring and is proven on the board

Input: `project.yaml` with `controller`, `pins`, `components` (and `WIRING.md`).
Output: a sketch in `firmware.sketch` that compiles, has been uploaded, and does
what each `idea.must` says, shown on the serial monitor. Answer in the user's language.

`<skill dir>` below is this skill's base directory, shown when the skill loads.
The tool: `node <skill dir>/fwkit/fwkit.mjs` (pins / compile / status / libs /
ports / upload / monitor). It finds arduino-cli by itself (PATH or the copy inside
Arduino IDE 2); `node <skill dir>/../cad-validation/cadkit/cadkit.mjs config` shows which.

## 0. Before code

- `node <skill dir>/../project/projkit/projkit.mjs check <project>` has **no FAIL**.
  Code on top of wrong wiring is wasted work: fix the wiring first (/electronics).
- In `project.yaml`: `firmware.fqbn` (from the board file, e.g. `arduino:avr:uno`;
  old-bootloader Nano clones: `arduino:avr:nano:cpu=atmega328old`), `firmware.sketch`
  (e.g. `firmware/<project>`; the folder name **is** the sketch name), `baud`, `libs`.
- The board's core must be installed: `arduino-cli core install arduino:avr`
  (ESP32: `esp32:esp32`, with the Espressif board-manager URL). Libraries:
  `fwkit libs <project>` installs `firmware.libs`. Pick the library the module's
  maker documents (Adafruit, SparkFun ...) and pin its version (`Name@1.2.3`).

## 1. pins.h is the only source of pin numbers

`fwkit pins <project>` (and every compile) writes `<sketch>/pins.h` from
`project.yaml`: `PIN_<PART>_<SIGNAL>`, `I2C_ADDR_<PART>`, `SERIAL_BAUD`. Every
source file includes `"pins.h"` and uses those names, never a literal number.
To change a pin, change `project.yaml` (and check it), never the code.

## 2. Test sketches first, then the program

For each subsystem (one sensor, the motor driver, the display), a minimal test
sketch: it prints what it reads or does on Serial, in plain words with units.
Put them in `firmware/test-<part>/` (each its own sketch folder, with its own
copy of the fqbn via a temporary project or the same project). They match the
`test` steps of `/plan`: the breadboard is proven before anything is soldered.

Then the real program, structured so it stays debuggable:

- `setup()` checks each module and prints `OK` / `FAILED: <part>` (e.g.
  `display.begin()` returns false, an I2C device does not answer at its address).
- `loop()` without long `delay()`s: `millis()` timing, so buttons and sensors are
  never missed. Debounce buttons (~30 ms).
- Thresholds and timings as named constants at the top, with units in the name
  (`DRY_THRESHOLD_RAW`, `PUMP_ON_MS`), so calibration is one edit.
- Motors and pumps start **off**, and the program cannot leave them on forever
  (a maximum on-time). Fail safe: a sensor that reads nonsense means "stop".
- `F("...")` around string literals on AVR (saves RAM).

## 3. Compile: automatic, and the gate

A hook compiles after every edit to a sketch file or the project.yaml and tells
you the result. A FAILED compile comes back as an error: fix it before anything
else. By hand: `fwkit compile <project>` (flash/RAM use, compiler warnings and
checks for literal pins, a `Serial.begin` that differs from `baud`, a missing
`#include "pins.h"`). RAM above ~75 % on an AVR board is a real risk: fix it.
Never say the code is done unless `fwkit status <project>` says OK.

## 4. Upload and watch

1. **Ask before uploading**: what is connected, and is it safe to run (motors
   free to turn, pump in water, nothing pinched)? The user plugs in the board.
2. `fwkit ports` → `fwkit upload <project> [--port COMx]`.
3. `fwkit monitor <project> --seconds 15` reads the serial output. Ask the user
   to press the button / cover the sensor while it runs, and compare what is
   printed with what should happen.
4. Fails to upload: wrong port, a monitor still open (close the Arduino IDE
   monitor), a charge-only USB cable, a CH340 driver missing, the old Nano bootloader.

## 5. Done

Every `idea.must` that the code serves has been seen working on the board
(say how: which output, which reading). Record calibrated values and library
versions in `decisions`, set `firmware` steps in the plan to `done`, and
`phase: build` when the projkit gate is open.

## Never

- Hard-code a pin number, or change a pin in the code instead of in project.yaml.
- Upload without asking what is connected.
- Say it works because it compiles: compiled is not tested.
