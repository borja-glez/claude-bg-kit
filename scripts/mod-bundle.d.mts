/** I-13: the bundle of a mod entry as build.mjs writes it: esbuild, then whitespace and syntax minified (identifiers
 *  kept), with `export const register = ` alone on its line. Throws when its shape is not the expected one. */
export function bundleMod(entry: string): Promise<string>;
