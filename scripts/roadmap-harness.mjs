// The local roadmap page plan 4b's Chrome trace runs on (spec §4.5, §7.3): the built template with the synthetic plan of
// tests/fixtures/big-plan.ts and a fake window.claude that serves its documents. It only writes the file it is given.
// Usage: npm run build && node scripts/roadmap-harness.mjs --out <file.html>
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const at = process.argv.indexOf('--out');
const out = at > 0 ? process.argv[at + 1] : undefined;
if (!out) {
  console.error('usage: node scripts/roadmap-harness.mjs --out <file.html>');
  process.exit(2);
}
const bundle = await build({ entryPoints: ['tests/fixtures/big-plan.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const template = await readFile('plugins/waypoint/assets/roadmap.template.html', 'utf8');
const file = path.resolve(out);
await mkdir(path.dirname(file), { recursive: true });
await writeFile(file, mod.harnessHtml(template));
console.log(file);
