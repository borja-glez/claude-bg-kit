// lens's cards drawn in terminal cells: a rounded frame in the section's colour, a header with its chip, then each
// block. Bars, spinners and pulsing cells are `Client` instances (pulse.tsx) that animate on the drawing thread;
// where a surface has no `Client`, the same blocks are drawn still.
import type { ElementConstructor, BoxProps, TextProps, ClientProps, RenderElement } from 'claude-code';
import type { Block, Card } from './svg.js';
import { PALETTE, STATE_HUE, barParts, type Hue, type CellState } from './view.js';
import { cellsMax, fitCells, innerWidth, type PanelLayout } from './layout.js';
import { SEP, type BandPart } from '../mod/band-fit.js';

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

function cells(ui: TermUI, key: string, list: CellState[], max?: number): RenderElement {
  const { Box, Text, Client } = ui;
  // F-14: at most two rows of boxes around the first active or pending one; the rest summed up after them.
  const fit = max === undefined ? { cells: list, more: null } : fitCells(list, max);
  const shown = fit.cells;
  const inner = fit.more ? `${key}-c` : key;
  const colors = shown.map(s => hex(STATE_HUE[s]));
  const glyphs = shown.map(s => (s === 'pending' ? '□' : '■'));
  const active = shown.map(s => s === 'active');
  const boxes = Client && active.some(Boolean)
    ? <Client key={inner} module="./pulse.js" props={{ kind: 'cells', colors, active, dim: PALETTE.s1, glyphs }} />
    : (
        <Box key={inner} flexDirection="row" flexWrap="wrap">
          {shown.map((s, i) => <Text key={`${key}-${i}`} color={colors[i]}>{`${glyphs[i]} `}</Text>)}
        </Box>
      );
  if (!fit.more) return boxes;
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      {boxes}
      <Text dimColor>{fit.more}</Text>
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
    case 'cells': return cells(ui, key, b.cells, cellsMax(inner));
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
      // F-03: the dot, the tag and the right text never shrink; only the text between them does, down to nothing. An
      // agent under its task is indented; a row of another session's work, or of a finished one, is dim.
      return (
        <Box key={key} flexDirection="row" columnGap={1} paddingLeft={b.indent ? 2 : 0}>
          <Box flexShrink={0}>{b.spinning ? spinner(ui, `${key}-s`, b.dot) : <Text color={hex(b.dot)}>●</Text>}</Box>
          {b.tag ? <Box flexShrink={0}><Text color={PALETTE.base} backgroundColor={hex(b.tag.hue)} bold>{` ${b.tag.text} `}</Text></Box> : null}
          <Box flexGrow={1} flexShrink={1} minWidth={0}><Text wrap="truncate-end" dimColor={b.dim}>{b.text}</Text></Box>
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

/**
 * One card as the pane is laid out (F-07, F-08): framed in the section's colour where there is room for it (docked from
 * 56 columns, in fullscreen), else without a frame: its header in the section's colour and its blocks indented.
 */
export function termCard(ui: TermUI, key: string, card: Card, layout: PanelLayout): RenderElement {
  const { Box, Text } = ui;
  const inner = innerWidth(layout);
  const head = (
    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={0}><Text color={hex(card.hue)} bold>{card.icon}</Text></Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {layout.boxed
          ? <Text bold wrap="truncate-end">{card.title}</Text>
          : <Text bold color={hex(card.hue)} wrap="truncate-end">{card.title}</Text>}
      </Box>
      {card.chip ? <Box flexShrink={0}><Text color={PALETTE.base} backgroundColor={hex(card.chip.hue)} bold>{` ${card.chip.text} `}</Text></Box> : null}
    </Box>
  );
  const body = [
    ...(card.subtitle ? [<Text key={`${key}-sub`} dimColor wrap="truncate-end">{card.subtitle}</Text>] : []),
    ...card.blocks.map((b, i) => block(ui, `${key}-${i}`, b, inner)),
  ];
  if (layout.boxed) {
    return (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={hex(card.hue)} paddingX={1}>
        {head}
        {body}
      </Box>
    );
  }
  return (
    <Box key={key} flexDirection="column">
      {head}
      <Box flexDirection="column" paddingLeft={2}>{body}</Box>
    </Box>
  );
}

// The parts of a band line as one Text, each glued to the one before; a part with a tone is a Text of its own: the
// count in the section's colour, the dim ones dim, a warning amber and an alert red.
function partsLine(ui: TermUI, parts: readonly BandPart[], base: Hue): RenderElement {
  const { Text } = ui;
  return (
    <Text wrap="truncate-end">
      {parts.map((p, i) => {
        const text = `${i ? p.glue ?? SEP : ''}${p.text}`;
        if (p.hue === 'dim') return <Text key={`part-${p.key}`} dimColor>{text}</Text>;
        if (p.hue === 'accent') return <Text key={`part-${p.key}`} bold color={hex(base)}>{text}</Text>;
        if (p.hue === 'warn') return <Text key={`part-${p.key}`} color={PALETTE.yellow}>{text}</Text>;
        if (p.hue === 'alert') return <Text key={`part-${p.key}`} color={PALETTE.red}>{text}</Text>;
        return text;
      })}
    </Text>
  );
}

/**
 * The band's terminal row (F-09, F-12): the icon or a spinner, the parts already fitted to the width, and, where the
 * band has room for them (wide), a bar of the width left and the task boxes.
 */
export function termBand(ui: TermUI, o: { icon: string; hue: Hue; spin: boolean; parts: readonly BandPart[]; bar: { ratio: number; width: number; moving: boolean } | null; cells: CellState[] }): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box flexDirection="row" columnGap={1} flexShrink={1} minWidth={0}>
      <Box flexShrink={0}>{o.spin ? spinner(ui, 'band-spin', o.hue) : <Text color={hex(o.hue)}>{o.icon}</Text>}</Box>
      <Box key="band-line" flexShrink={1} minWidth={0}>{partsLine(ui, o.parts, o.hue)}</Box>
      {o.bar ? <Box flexShrink={0}>{bar(ui, 'band-bar', o.bar.ratio, o.bar.width, o.hue, o.bar.moving)}</Box> : null}
      {o.cells.length ? <Box flexShrink={0}>{cells(ui, 'band-cells', o.cells)}</Box> : null}
    </Box>
  );
}
