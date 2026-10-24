# Islands, workers and MDX

## Preact islands

Preact does not repair attributes when it hydrates. Anything that depends on the client (`localStorage`, the theme, the viewport) differs from the server HTML and stays wrong. Paint it only after a `mounted` flag turns true:

```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
const theme = mounted ? readTheme() : 'light'; // server and first client render agree
return <div class="island" data-theme={theme} style="min-height: 22rem">{/* stable placeholder first */}</div>;
```

SSR islands used to grow when they hydrated (layout shift). Reserve their height with `min-height` and render a stable marker in the server HTML, so hydration swaps content without moving the page.

## Workers

Vite bundles a worker only when it sees this literal, whole, at the call site:

```ts
const worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
```

Put the `new URL(...)` inside the `new Worker(...)` call. With any indirection (a `spawn(url)` helper that receives the URL) Vite does not process the file, the `.ts` ends up embedded as a `data:video/mp2t` URL, and the CSP blocks it.

Guard it in `postbuild`: a script (for example `scripts/check-workers.mjs`) reads `dist` and fails if any built file contains an embedded worker (`data:video/mp2t` or another `data:` worker source). Wire it as `"postbuild": "node scripts/check-workers.mjs"` so `pnpm build` fails with it.

## MDX

Prose that carries components goes in `.mdx`, not in `.astro`: Astro swallows the whitespace between text and a component on the next line, so words glue together. In MDX, no line starts with `<Term`. Prettier treats a line that opens with an inline component as a block and inserts a blank line before it, which splits the sentence. Keep a test over the sources:

```ts
expect(source).not.toMatch(/^<Term\b/m);
```

If a sentence needs the component first, reword so a word comes before it.
