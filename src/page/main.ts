import { start, type Snapshot } from './app.js';

async function boot() {
  let snapshot: Snapshot | null = null;
  try { snapshot = JSON.parse(document.getElementById('wp-snapshot')?.textContent ?? 'null'); } catch { snapshot = null; }
  let claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude ?? null;
  if (!claude) {
    await new Promise(r => (document.readyState === 'complete' ? r(null) : addEventListener('load', () => r(null), { once: true })));
    claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude ?? null;
  }
  // H-04: ?debug=1 lists what the normalizers dropped; the hash works too (an artifact frame may not see the query).
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  await start({ claude, snapshot, root: document.getElementById('app')!, debug });
}
void boot();
