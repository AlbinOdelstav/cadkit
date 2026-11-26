// Project log: LOG.md next to project.yaml, one section per day, newest last.
// Used by `projkit log` and the session-start hook.
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['note', 'done', 'measured', 'problem', 'fixed', 'decided', 'bought', 'printed'];

export function logFile(projectFile) { return path.join(path.dirname(projectFile), 'LOG.md'); }

export function append(projectFile, p, text, kind = 'note', when = new Date()) {
  if (!KINDS.includes(kind)) throw new Error(`kind "${kind}" is not one of ${KINDS.join(', ')}`);
  const f = logFile(projectFile);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`; // local date, like the time
  const time = when.toTimeString().slice(0, 5);
  let txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : `# Log: ${p.title || p.project}\n\nNewest at the bottom. Written with \`projkit log\`; edit freely.\n`;
  if (!txt.includes(`\n## ${day}`)) txt = txt.replace(/\n*$/, '\n') + `\n## ${day}\n\n`;
  txt = txt.replace(/\n*$/, '\n') + `- ${time} **${kind}** (${p.phase}) ${String(text).trim().replace(/\n+/g, ' ')}\n`;
  fs.writeFileSync(f, txt);
  return f;
}

export function entries(projectFile) {
  const f = logFile(projectFile);
  if (!fs.existsSync(f)) return [];
  const out = [];
  let day = '';
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const d = line.match(/^## (\d{4}-\d{2}-\d{2})/);
    if (d) { day = d[1]; continue; }
    const e = line.match(/^- (\d{2}:\d{2}) \*\*(\w+)\*\* \(([\w-]+)\) (.*)$/);
    if (e) out.push({ day, time: e[1], kind: e[2], phase: e[3], text: e[4] });
  }
  return out;
}

// what is still open: problems without a later "fixed" that mentions the same words
export function openProblems(es) {
  const probs = es.filter((e) => e.kind === 'problem');
  const fixes = es.filter((e) => e.kind === 'fixed');
  const words = (s) => new Set(s.toLowerCase().match(/[a-zåäö0-9]{4,}/g) || []);
  return probs.filter((pr) => {
    const w = words(pr.text);
    const after = fixes.filter((f) => `${f.day} ${f.time}` >= `${pr.day} ${pr.time}`);
    return !after.some((f) => [...words(f.text)].filter((x) => w.has(x)).length >= 2);
  });
}
