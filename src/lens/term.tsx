// lens's cards drawn in terminal cells: a rounded frame in the section's colour, a header with its chip, then each
// block. Bars, spinners and pulsing cells are `Client` instances (pulse.tsx) that animate on the drawing thread;
// where a surface has no `Client`, the same blocks are drawn still.
import type { ElementConstructor, BoxProps, TextProps, ClientProps, RenderElement } from 'claude-code';
import type { Block, Card } from './svg.js';
import { PALETTE, STATE_HUE, barParts, type Hue, type CellState } from './view.js';

export type TermUI = {
  Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Client?: ElementConstructor<ClientProps>;
};

const hex = (h: Hue): string => PALETTE[h];
const STAGE_GLYPH = { done: '●', active: '◉', pending: '○' } as const;

function bar(ui: TermUI, key: string, r: number, width: number, hue: Hue, moving: boolean): RenderElement {
  const { Box, Text, Client } = ui;
  if (Client && moving) {
    return <Client key={key} module="./pulse.js" width={width} height={1} props={{ kind: 'bar', ratio: r, width, color: hex(hue), track: PALETTE.s0, glow: '#ffffff', moving }} />;
  }
  const { fill, rest } = barParts(r, width);
  return (
    <Box key={key} flexDirection="row">
      <Text color={hex(hue)}>{fill}</Text>
      <Text color={PALETTE.s0}>{rest.replace(/░/g, '█')}</Text>
    </Box>
  );
}

function cells(ui: TermUI, key: string, list: CellState[]): RenderElement {
  const { Box, Text, Client } = ui;
  const colors = list.map(s => hex(STATE_HUE[s]));
  const glyphs = list.map(s => (s === 'pending' ? '□' : '■'));
  const active = list.map(s => s === 'active');
  if (Client && active.some(Boolean)) {
    return <Client key={key} module="./pulse.js" props={{ kind: 'cells', colors, active, dim: PALETTE.s1, glyphs }} />;
  }
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap">
      {list.map((s, i) => <Text key={`${key}-${i}`} color={colors[i]}>{`${glyphs[i]} `}</Text>)}
    </Box>
  );
}

function spinner(ui: TermUI, key: string, hue: Hue): RenderElement {
  const { Text, Client } = ui;
  return Client
    ? <Client key={key} module="./pulse.js" width={1} height={1} props={{ kind: 'spin', color: hex(hue) }} />
    : <Text key={key} color={hex(hue)}>◐</Text>;
}

function block(ui: TermUI, key: string, b: Block, inner: number): RenderElement {
  const { Box, Text } = ui;
  switch (b.kind) {
    case 'bar': {
      const right = b.right ? ` ${b.right}` : '';
      const head = b.label || b.right
        ? (
            <Box key={`${key}-h`} flexDirection="row" justifyContent="space-between">
              <Box flexGrow={1} minWidth={0}><Text dimColor wrap="truncate-end">{b.label ?? ''}</Text></Box>
              <Box flexShrink={0}><Text bold>{right}</Text></Box>
            </Box>
          )
        : null;
      return (
        <Box key={key} flexDirection="column">
          {head}
          {bar(ui, `${key}-b`, b.ratio, Math.max(4, inner), b.hue, !!b.moving)}
        </Box>
      );
    }
    case 'cells': return cells(ui, key, b.cells);
    case 'stages':
      return (
        <Box key={key} flexDirection="row" flexWrap="wrap">
          {b.stages.map((s, i) => (
            <Box key={`${key}-${i}`} flexDirection="row">
              {i > 0 ? <Text color={s.state === 'pending' ? PALETTE.s1 : hex(b.hue)}>{'─'}</Text> : null}
              <Text color={s.state === 'pending' ? PALETTE.s2 : hex(b.hue)}>{STAGE_GLYPH[s.state]}</Text>
              <Text bold={s.state === 'active'} color={s.state === 'active' ? hex(b.hue) : undefined} dimColor={s.state === 'pending'}>{` ${s.name} `}</Text>
            </Box>
          ))}
        </Box>
      );
    case 'row':
      // F-03: the dot, the tag and the right text never shrink; only the text between them does, down to nothing.
      return (
        <Box key={key} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>{b.spinning ? spinner(ui, `${key}-s`, b.dot) : <Text color={hex(b.dot)}>●</Text>}</Box>
          {b.tag ? <Box flexShrink={0}><Text color={PALETTE.base} backgroundColor={hex(b.tag.hue)} bold>{` ${b.tag.text} `}</Text></Box> : null}
          <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end">{b.text}</Text></Box>
          {b.right ? <Box flexShrink={0}><Text dimColor>{b.right}</Text></Box> : null}
        </Box>
      );
    case 'text': return <Text key={key} color={b.hue ? hex(b.hue) : undefined} dimColor={b.dim} wrap="truncate-end">{b.text}</Text>;
    case 'chips':
      return (
        <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
          {b.chips.map((c, i) => <Text key={`${key}-${i}`} color={hex(c.hue)} bold>{`‹${c.text}›`}</Text>)}
        </Box>
      );
  }
}

/** One card, `width` columns wide (the frame included). */
export function termCard(ui: TermUI, key: string, card: Card, width: number): RenderElement {
  const { Box, Text } = ui;
  const inner = Math.max(6, width - 4);
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={hex(card.hue)} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}><Text color={hex(card.hue)} bold>{card.icon}</Text></Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}><Text bold wrap="truncate-end">{card.title}</Text></Box>
        {card.chip ? <Box flexShrink={0}><Text color={PALETTE.base} backgroundColor={hex(card.chip.hue)} bold>{` ${card.chip.text} `}</Text></Box> : null}
      </Box>
      {card.subtitle ? <Text dimColor wrap="truncate-end">{card.subtitle}</Text> : null}
      {card.blocks.map((b, i) => block(ui, `${key}-${i}`, b, inner))}
    </Box>
  );
}

/** The band's terminal row: icon and title, a bar, the cells and the count. */
export function termBand(ui: TermUI, o: { icon: string; title: string; detail: string; hue: Hue; ratio: number; label: string; moving: boolean; cells: CellState[]; columns: number; spin: boolean }): RenderElement {
  const { Box, Text } = ui;
  const titleW = Math.max(8, Math.min(28, o.title.length + 2, Math.floor(o.columns / 4)));
  const cellsW = Math.min(o.cells.length, 16) * 2;
  const barW = Math.max(6, Math.min(36, o.columns - titleW - cellsW - o.label.length - 30));
  return (
    <Box flexDirection="row" columnGap={1} flexShrink={1}>
      {o.spin ? spinner(ui, 'band-spin', o.hue) : <Text color={hex(o.hue)}>{o.icon}</Text>}
      <Box width={titleW} flexShrink={0}><Text bold wrap="truncate-end">{o.title}</Text></Box>
      {o.cells.length ? bar(ui, 'band-bar', o.ratio, barW, o.hue, o.moving) : null}
      {o.label ? <Text bold color={hex(o.hue)}>{o.label}</Text> : null}
      {o.cells.length ? cells(ui, 'band-cells', o.cells.slice(0, 16)) : null}
      {o.detail ? <Box flexShrink={1}><Text dimColor wrap="truncate-end">{o.detail}</Text></Box> : null}
    </Box>
  );
}
