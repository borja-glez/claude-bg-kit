Read from waypoint:design (`## new` step 2, `## rewrite` step 1, and whenever the body is written or a section is rewritten). `DESIGN` means what that skill says.

# Writing the body for the design page

The design page shows the body as prose about 72 characters wide, with tables, diagrams, charts and steps across the full width. Each `##` section is numbered and gets a card in the document map with its first sentence and its size. So:

- **Open each `##` with one sentence that says what the section decides.** That sentence is the section's card on the map.
- **Draw what the reader would otherwise have to picture.** When a paragraph describes a structure, a flow, a sequence or a set of numbers, put the matching block right after the sentence that states the decision. The block never replaces that sentence. A design with components or a flow has at least one diagram.

| When the text describes | Use |
|---|---|
| components and who calls whom, a pipeline, a decision tree | ` ```mermaid ` with `flowchart LR` (or `TD`) |
| an exchange between parts over time (session, CLI, agent) | ` ```mermaid ` with `sequenceDiagram` |
| the states of something and what moves it between them | ` ```mermaid ` with `stateDiagram-v2` |
| records and how they relate | ` ```mermaid ` with `erDiagram` |
| ordered phases or steps | ` ```steps ` |
| a few numbers to compare: costs, sizes, before and after | ` ```chart ` |
| options compared on several attributes | a table |
| a decision, a hard limit, a risk the reader must not miss | `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`, `> [!NOTE]` or `> [!TIP]` on the first line of a quote |

**chart.** YAML: optional `title`, `unit` and `note`, and `data`, a list of `{label, value}` (1 to 24 rows, numbers ≥ 0). With `series` (2 to 4 names) each row has `values`, one number per series:

```chart
title: Cost per task
unit: $
series: [Today, With the change]
data:
  - { label: Medium, values: [4.4, 3.1] }
  - { label: Large, values: [8, 5.6] }
note: Measured with scripts/usage-report.mjs over the same runs.
```

**steps.** YAML: a list of 2 to 8 steps, each `{title, text}` or just a title. Titles of a few words, the text one sentence; inline Markdown works (quote a text that starts with a backtick):

```steps
- title: Measure
  text: Baseline with `usage-report` before any change.
- title: Fixed effort
  text: Every agent declares `effort`.
- Review and rounds
```

**Rules.**
- Only numbers the design or its sources give go in a chart; never invent one to fill a picture.
- Mermaid: no `classDef`, `style` or colours (the page follows the reader's light or dark theme); short labels, `<br/>` for a second line; about 15 nodes at most, split a bigger diagram in two.
- Tables: short headers, at most 6 columns, a sentence at most per cell; write the unit in each cell of a column of quantities (`254 $`, `45 %`) and the page aligns it right.
- `waypoint design-validate DESIGN` checks the chart and steps blocks and empty diagrams, with the line of each problem: fix them before the snapshot. A spec imported with `design-import` keeps its body as it was written.
