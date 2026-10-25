export const ACTIONABLE: RegExp[];
export function isActionable(message: string): boolean;
/** The exit-2 messages of one source file, in source order. */
export function errorMessages(text: string): string[];
/** Every exit-2 message under src/forge, `file` repo-relative with `/`, files in path order. */
export function scanCliErrors(root: string): { file: string; message: string }[];
/** `<file> :: <message>` of each message that is not actionable, sorted (duplicates kept): the baseline's format. */
export function baselineEntries(root: string): string[];
