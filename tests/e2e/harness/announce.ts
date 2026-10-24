import { announceLine, findClaude } from './claude-bin.js';

// A8: vitest globalSetup; names the claude the run uses, or says every scenario is skipped.
export default function announce(): void {
  console.log(announceLine(findClaude(process.env)));
}
