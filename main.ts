// Token Radar, the program. Node 22, standard library only, no network.
//
// It reads the sealed snapshot (at /input in the grader's container, or
// wherever --input points), ranks every protocol that records no token yet
// with the model in lib/model.ts, and writes the handover into the output
// directory (/output, or MAKEFUN_OUTPUT_DIR, or --output):
//
//   board.json    the ranked board the gate checks
//   data.js       the same figures, as window.RADAR, for the dashboard
//   dashboard/    this repository's static page, copied across
//   screenshots/  this repository's three screenshots, copied across
//   dossier.json  the judge's summary, written by vendor/makefun-board.ts
//
// The program is deterministic: two runs over the same snapshot write the
// same bytes, because nothing in it reads a clock or a random source.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** Read --name value (or --name=value) from the arguments, else the fallback. */
function argument(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argument('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) fail(`the model produced a board the gate would refuse: ${issue}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files across, skipping dotfiles; returns the names copied. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

const pageFiles = copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html to hand in');

const PLAIN_IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const shots = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, up to 128 characters`);
}

// Written last, from the finished output, so the dossier describes exactly
// what is being handed in; the scorer rebuilds it and compares bytes.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

const top = radar.rows.slice(0, 3).map((r) => `#${r.rank} ${r.name}`).join(', ');
process.stdout.write(
  `token radar: scanned ${radar.scanned} protocols, set ${radar.live_size} with a token already trading aside, ` +
    `ranked ${radar.ranked} that record none (${radar.watchlist_size} of them on the watchlist)\n` +
    `token radar: head of the board: ${top}\n` +
    `token radar: wrote board.json (${radar.ranked} rows), data.js, dashboard/ (${pageFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json (${dossier.length} bytes) to ${outputDir}\n`,
);
