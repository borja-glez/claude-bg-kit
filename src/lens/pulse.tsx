// lens's terminal animations, drawn on the drawing thread with their own frame clock: a spinner, a bar with a
// sheen running over its filled part, and a row of task cells whose active ones pulse. No $ and no state writes:
// the hooks module hands each instance plain props, and the instance keeps only its frame counter.
import type { ClientModule } from 'claude-code';

type Props =
  | { kind: 'spin'; color: string }
  | { kind: 'bar'; ratio: number; width: number; color: string; track: string; glow: string; moving: boolean }
  | { kind: 'cells'; colors: string[]; active: boolean[]; dim: string; glyphs: string[] };

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const FRAME_MS = 110;

const Pulse: ClientModule<Props, number> = (p, s) => {
  if (s.state === undefined) {
    s.setState(0);
    s.every(FRAME_MS, () => s.setState(((s.state ?? 0) + 1) % 100_000));
  }
  const f = s.state ?? 0;
  const { Box, Text } = s.elements;
  if (p.kind === 'spin') return <Text color={p.color}>{SPIN[f % SPIN.length]}</Text>;

  if (p.kind === 'bar') {
    const w = Math.max(1, Math.floor(p.width));
    const exact = Math.max(0, Math.min(1, p.ratio)) * w;
    const full = Math.floor(exact);
    const edge = full < w ? EIGHTHS[Math.round((exact - full) * 7)] : '';
    const rest = Math.max(0, w - full - (edge ? 1 : 0));
    // A three-cell sheen sweeps the filled part, then rests a beat before the next pass.
    const span = full + 6;
    const at = p.moving && full > 2 ? (f % span) - 3 : -10;
    const parts: { text: string; color: string }[] = [];
    for (let i = 0; i < full; i++) {
      const d = Math.abs(i - at);
      const color = d < 1 ? p.glow : d < 2 ? p.glow : p.color;
      const last = parts.at(-1);
      if (last && last.color === color) last.text += '█'; else parts.push({ text: '█', color });
    }
    return (
      <Box flexDirection="row">
        {parts.map((x, i) => <Text key={`f${i}`} color={x.color}>{x.text}</Text>)}
        {edge ? <Text color={p.color} backgroundColor={p.track}>{edge}</Text> : null}
        <Text color={p.track}>{'█'.repeat(rest)}</Text>
      </Box>
    );
  }

  // Cells: an active cell breathes between its colour and the dim one, each a little out of phase.
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {p.colors.map((color, i) => {
        const on = !p.active[i] || ((f + i) % 8) < 5;
        return <Text key={`c${i}`} color={on ? color : p.dim}>{`${p.glyphs[i] ?? '■'} `}</Text>;
      })}
    </Box>
  );
};

export default Pulse;
