// Free text drawn on one line (the band, lens, a roadmap reason): C0 and C1 controls become spaces, bidi controls go
// (they reorder what a reader sees), runs of white space become one space, and the ends are trimmed. The bidi controls
// are built from their code points, so none is written in this file. Pure and without imports: the mods and the CLIs use it.
const BIDI = new RegExp(`[${[0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map(c => String.fromCharCode(c)).join('')}]`, 'g');
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** M1: `text` as one clean line, without control or bidi characters; not cut (each reader cuts it its own way). */
export const oneLine = (text: string): string => String(text).replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim();
