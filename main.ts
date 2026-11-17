// Token Radar / ORBIT entrypoint.
//
// Reads the sealed DefiLlama snapshot, scores every launch candidate with lib/model.ts, writes the
// ranked board and the dashboard's data, copies the static dashboard and screenshots, and writes the
// official dossier. Node 22 standard library only; no network and no runtime dependencies.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_IMAGE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  return prefixed === undefined ? fallback : prefixed.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputPath = argument('input', '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount /input`);
}
const outputDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

function walk(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    const stat = statSync(source);
    if (stat.isDirectory()) {
      copied.push(...walk(source, join(to, name)).map((child) => `${name}/${child}`));
    } else if (stat.isFile()) {
      copyFileSync(source, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

function screenshotNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

const dashboardFiles = walk(join(ROOT, 'dashboard'), join(outputDir, 'dashboard'));
for (const required of ['index.html']) {
  if (!dashboardFiles.includes(required)) fail(`dashboard/${required} is missing`);
}
if (!dashboardFiles.some((name) => name.endsWith('.css'))) fail('dashboard/ has no .css file');
if (!dashboardFiles.some((name) => name.endsWith('.js'))) fail('dashboard/ has no .js file');

const shots = screenshotNames(join(ROOT, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length}; the entry needs the board, a detail view and a filtered view`);
}
if (shots.length > SCREENSHOT_CAPS.max) fail(`screenshots/ holds ${shots.length}, over the ${SCREENSHOT_CAPS.max} the gate reads`);
for (const name of shots) {
  if (!PLAIN_IMAGE.test(name)) fail(`screenshots/${name} has a name the dossier refuses`);
  const size = statSync(join(ROOT, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap`);
}
walk(join(ROOT, 'screenshots'), join(outputDir, 'screenshots'));

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

const top = board.slice(0, 3).map((row) => `${row.rank}. ${row.name} $${row.implied_value_usd.toLocaleString('en-US')}`).join(' | ');
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols in the snapshot; ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist covered; ${board.length} ranked (${radar.early_size} early, ${radar.live_size} live benchmarks)\n` +
    `token-radar: top of board: ${top}\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length}) and dossier.json\n`,
);
