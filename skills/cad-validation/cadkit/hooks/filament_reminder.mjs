#!/usr/bin/env node
// UserPromptSubmit hook: when the prompt names a filament that has no
// tolerance table yet, remind Claude what must be updated before designing
// for it. Silent otherwise. Never blocks the prompt.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.mjs';

const TOL = loadConfig().tolerances; // your tolerance profile (config key `tolerances`)
// name in the prompt -> material key in the tolerance profile
const MATERIALS = [
  [/\bPETG\b|\bPET-G\b/i, 'PETG'], [/\bABS\b/, 'ABS'], [/\bASA\b/, 'ASA'],
  [/\bTPU\b|\bTPE\b|flexfilament|flexible filament/i, 'TPU'],
  [/\bnylon\b|\bPA6\b|\bPA12\b|\bPA-?CF\b|\bPAHT\b/i, 'PA'],
  [/polykarbonat|polycarbonate|\bPC[- ]?(filament|ABS)\b/i, 'PC'],
  [/\bPLA-?CF\b|kolfiber|carbon fib/i, 'PLA-CF'], [/\bPETG-?CF\b/i, 'PETG-CF'],
  [/\bHIPS\b/, 'HIPS'], [/\bPVA\b/, 'PVA'], [/\bPP\b(?=.*(filament|print|skriv))/i, 'PP'],
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let prompt = '';
  try { prompt = JSON.parse(raw).prompt || ''; } catch { process.exit(0); }
  let known = [];
  try {
    const t = fs.readFileSync(TOL, 'utf8');
    const m = t.split(/\r?\n/);
    const i = m.findIndex((l) => /^materials:/.test(l));
    known = m.slice(i + 1).filter((l) => /^ {2}[A-Za-z0-9+-]+:\s*$/.test(l)).map((l) => l.trim().slice(0, -1).toUpperCase());
  } catch { /* no table: every material is new */ }
  const hits = [...new Set(MATERIALS.filter(([re]) => re.test(prompt)).map(([, k]) => k))]
    .filter((k) => !known.includes(k.toUpperCase()));
  if (!hits.length) process.exit(0);
  const msg = `Filament reminder: the user mentioned ${hits.join(', ')}, which has no tolerance table yet ` +
    `(calibrated: ${known.join(', ') || 'none'}). Before designing or validating for it, tell the user briefly what has to be updated:\n` +
    `1. The tolerance profile (${TOL ? path.basename(TOL) : 'not configured yet'}): add a materials.${hits[0]} block (copy PLA, mark every value DEFAULT). The validator FAILs any manifest with an uncalibrated material on purpose.\n` +
    `2. Print the calibration coupon in that material (cadkit/calibration, COUPON.md) and enter the results with source CALIBRATION.\n` +
    `3. print-settings: temperatures, cooling, plate, drying, enclosure; and shrinkage (ABS/ASA/PA shrink more: large parts warp, holes come out smaller).\n` +
    `4. The user's filament inventory, if they keep one: add the spool.\n` +
    `5. Design rules that change: TPU needs much bigger fit gaps and no small pilots; PETG strings and sticks to itself (print-in-place gaps +0.1); CF filaments are abrasive (hardened nozzle).\n` +
    `Mention this once, short, in the user's language; do not block their request.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg } }));
});
