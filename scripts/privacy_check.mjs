#!/usr/bin/env node
// Privacy check: refuse to commit anything personal.
//
//   node scripts/privacy_check.mjs        exit 1 on any hit
//
// Scans every file that is (or would be) in the repo: the staged version of
// tracked files, plus untracked files that .gitignore does not exclude, and
// every file NAME. Two pattern sets:
//   * built-in: user folders, e-mail addresses, keys and tokens
//   * your own: privacy-patterns.local.txt (ignored by git), one
//     case-insensitive regex per line - your name, project names, shops,
//     anything that must never be published. Keep it next to this repo's root.
// Install as a pre-commit hook with: node scripts/privacy_check.mjs --install
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/privacy_check.mjs';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 28 });

if (process.argv.includes('--install')) {
  const hook = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexec node scripts/privacy_check.mjs\n');
  try { fs.chmodSync(hook, 0o755); } catch { /* windows */ }
  console.log('pre-commit hook installed');
  process.exit(0);
}

const BUILTIN = [
  ['Windows user folder', /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}/],
  ['macOS user folder', /\/Users\/[A-Za-z]/],
  ['Linux home folder', /\/home\/[a-z]/],
  ['AppData path', /AppData[\\/]{1,2}(Local|Roaming)/i],
  ['e-mail address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]{2,}/],
  ['mail provider', /g[m]ail|hotm[a]il|outl[o]ok\.com/i],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['API key', /sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abpr]-[A-Za-z0-9-]{10,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Claude session data', /\.claude[\\/]{1,2}projects/],
];
// files that are personal by their kind, whatever they contain
const PERSONAL_FILE = /\.(jsonl|env|pem|key)$|(^|\/)(settings(\.local)?\.json|config\.yaml|privacy-patterns\.local\.txt)$|(^|\/)(memory|profiles\/local)\//i;

const localFile = path.join(ROOT, 'privacy-patterns.local.txt');
const PRIVATE = fs.existsSync(localFile)
  ? fs.readFileSync(localFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => [`private term /${l}/`, new RegExp(l, 'i')])
  : [];
if (!PRIVATE.length) console.warn('warning: no privacy-patterns.local.txt - only built-in patterns are checked');

const tracked = git('ls-files', '--cached', '-z').toString().split('\0').filter(Boolean);
const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
const files = [...tracked.map((f) => [f, 'staged']), ...untracked.map((f) => [f, 'untracked'])];

const hits = [];
for (const [f, kind] of files) {
  for (const [name, re] of PRIVATE) if (re.test(f)) hits.push(`${f}: file name matches ${name}`);
  if (PERSONAL_FILE.test(f)) hits.push(`${f}: personal file (settings, transcript, memory, key, local config or profile)`);
  let buf;
  try { buf = kind === 'staged' ? git('show', `:${f}`) : fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
  if (buf.includes(0)) { hits.push(`${f}: binary file - check it by hand or keep it out`); continue; }
  const lines = buf.toString('utf8').split(/\r?\n/);
  const sets = f === SELF ? PRIVATE : [...BUILTIN, ...PRIVATE];
  lines.forEach((line, i) => {
    for (const [name, re] of sets) if (re.test(line)) hits.push(`${f}:${i + 1}: ${name}`);
  });
}

console.log(`privacy check: ${files.length} files (${tracked.length} staged, ${untracked.length} untracked), ` +
  `${BUILTIN.length} built-in + ${PRIVATE.length} private patterns`);
if (hits.length) {
  console.log(`FAIL: ${hits.length} hit(s)\n` + hits.map((h) => '  ' + h).join('\n'));
  process.exit(1);
}
console.log('PASS: nothing personal found');
