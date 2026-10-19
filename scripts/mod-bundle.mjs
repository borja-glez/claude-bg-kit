import { build, transform } from 'esbuild';

/**
 * A mod's bundle (src/mod/register.tsx, src/lens/register.tsx) as the plugins ship it. 'claude-code' is the engine's own
 * module, resolved at load. The engine reads register off the module's source: it must be `export const register` at
 * the top level, alone on its line.
 *
 * I-13: two passes. The first bundles as before: esbuild writes register as var, let or const depending on its version,
 * then `export { register };`, and that becomes `export const register = `. The second minifies whitespace and syntax,
 * never identifiers (the engine's errors name the hooks' functions). In one pass esbuild may merge the declaration of
 * register into another one (`…,register=`). Throws when either shape is not the expected one, so the build fails.
 */
export async function bundleMod(entry) {
  const mod = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
    target: 'es2022', jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', external: ['claude-code'], write: false,
  });
  const plain = mod.outputFiles[0].text
    .replace(/^(?:var|let|const) register = /m, 'export const register = ')
    .replace(/^export \{\s*register\s*\};\s*$/m, '');
  if (!/^export const register = /m.test(plain) || /^export \{/m.test(plain)) throw new Error(`${entry}: unexpected bundle shape`);
  const { code } = await transform(plain, { loader: 'js', target: 'es2022', minifyWhitespace: true, minifySyntax: true });
  const parts = code.split('export const register=');
  if (parts.length !== 2 || /\bexport\s*\{/.test(code) || /\bexport\s+(?:default|function|class|let|var)\b/.test(code)) {
    throw new Error(`${entry}: unexpected minified shape`);
  }
  return `${parts[0]}\nexport const register = ${parts[1]}`;
}
