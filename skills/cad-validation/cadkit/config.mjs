// Machine-specific settings for cadkit, resolved in this order:
//   1. environment variables (CADKIT_FREECADCMD, CADKIT_BAMBU, CADKIT_BAMBU_PRESETS,
//      CADKIT_TOLERANCES, CADKIT_INVENTORY_HARDWARE)
//   2. a config file: $CADKIT_CONFIG, else <plugin root>/config.yaml,
//      else ~/.cadkit/config.yaml  (flat `key: value` lines, see config.example.yaml)
//   3. auto-detection (FreeCAD and Bambu Studio in their default install folders)
// Nothing personal is ever hard-coded here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(KIT, '..', '..', '..'); // plugin root: skills/cad-validation/cadkit -> root

const ENV = {
  freecadcmd: 'CADKIT_FREECADCMD', bambu_studio: 'CADKIT_BAMBU', bambu_presets: 'CADKIT_BAMBU_PRESETS',
  tolerances: 'CADKIT_TOLERANCES', inventory_hardware: 'CADKIT_INVENTORY_HARDWARE',
  inventory_cli: 'CADKIT_INVENTORY_CLI', projects: 'CADKIT_PROJECTS',
};

export function configFile() {
  const c = [process.env.CADKIT_CONFIG, path.join(ROOT, 'config.yaml'), path.join(os.homedir(), '.cadkit', 'config.yaml')];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

function parseFlat(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*?)\s*(#.*)?$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (v !== '') out[m[1]] = v;
  }
  return out;
}

function expand(p, base) {
  if (!p) return p;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

function firstExisting(list) { return list.find((p) => p && fs.existsSync(p)) || null; }

function detectFreecad() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:/Program Files'].filter(Boolean);
  const found = [];
  for (const r of roots) {
    let names = [];
    try { names = fs.readdirSync(r).filter((n) => /^FreeCAD/i.test(n)); } catch { /* none */ }
    for (const n of names.sort().reverse()) found.push(path.join(r, n, 'bin', 'freecadcmd.exe'), path.join(r, n, 'bin', 'FreeCADCmd.exe'));
  }
  found.push('/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd', '/usr/bin/freecadcmd', '/usr/local/bin/freecadcmd');
  return firstExisting(found);
}

function detectBambu() {
  const roots = [process.env.ProgramFiles, 'C:/Program Files'].filter(Boolean);
  return firstExisting([...roots.map((r) => path.join(r, 'Bambu Studio', 'bambu-studio.exe')),
    '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio']);
}

function detectPresets() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return firstExisting([path.join(appdata, 'BambuStudio', 'system', 'BBL'),
    path.join(os.homedir(), 'Library', 'Application Support', 'BambuStudio', 'system', 'BBL')]);
}

export function loadConfig() {
  const file = configFile();
  const fromFile = file ? parseFlat(fs.readFileSync(file, 'utf8')) : {};
  const base = file ? path.dirname(file) : ROOT;
  const cfg = { _file: file };
  for (const [k, env] of Object.entries(ENV)) {
    cfg[k] = process.env[env] || (fromFile[k] ? expand(fromFile[k], base) : null);
  }
  cfg.freecadcmd ||= detectFreecad();
  cfg.bambu_studio ||= detectBambu();
  cfg.bambu_presets ||= detectPresets();
  return cfg;
}

// Environment for the FreeCAD-side scripts, so Python sees the same settings.
export function childEnv(cfg, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const [k, name] of Object.entries(ENV)) if (cfg[k] && !env[name]) env[name] = cfg[k];
  if (cfg._file && !env.CADKIT_CONFIG) env.CADKIT_CONFIG = cfg._file;
  return env;
}
