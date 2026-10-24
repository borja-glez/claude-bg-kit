# CSP: hashes, inline scripts and figures

Confirm the exact key names against the installed Astro version with Context7 before editing the config.

## security.csp

`security.csp` in `astro.config.mjs` makes Astro emit a `<meta>` CSP with the hashes of each page. The one inline script you write yourself (the theme script, `is:inline`) lives in its own file; the config reads that file and puts its `sha256-` hash, in base64, in `scriptDirective.hashes`.

```js
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

const themeScript = readFileSync(new URL('./src/scripts/theme.inline.js', import.meta.url), 'utf8');
const themeHash = `sha256-${createHash('sha256').update(themeScript).digest('base64')}`;

export default defineConfig({
  security: {
    csp: {
      scriptDirective: {
        hashes: [themeHash],
      },
      // Only when a library writes style="" attributes:
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }],
      },
      // Only when the site has workers:
      directives: ["worker-src 'self' blob:"],
    },
  },
});
```

The `kind: 'attribute'` form limits `'unsafe-inline'` to style attributes, so `<style>` elements stay hashed. Add `worker-src 'self' blob:` as soon as a worker exists.

## Inline scripts

One file per `is:inline` script, imported with `?raw` in the layout so the file is the single source. A test reads the file, computes the hash and compares it with what the config puts in `scriptDirective.hashes`, so an edit to the script that forgets the hash fails the test instead of the page.

## Figures

Never `<style is:inline>` in a figure: its content needs its own hash and every figure would change the policy. Use a scoped `<style>` (Astro bundles it) and put the animation under the media query that enables it:

```css
@media (prefers-reduced-motion: no-preference) {
  .figure__line { animation: draw 1.2s ease-out both; }
}
```

The default state is still; motion is the opt-in.

## Check

An e2e test visits every page and asserts that the document has the CSP `<meta http-equiv="content-security-policy">`. `frame-ancestors` is not tested there: nginx sets it (see the deploy procedure).
