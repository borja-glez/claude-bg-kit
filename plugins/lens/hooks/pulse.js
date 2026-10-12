// src/lens/pulse.tsx
var SPIN = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var EIGHTHS = ["", "\u258F", "\u258E", "\u258D", "\u258C", "\u258B", "\u258A", "\u2589"];
var FRAME_MS = 110;
var Pulse = (p, s) => {
  if (s.state === void 0) {
    s.setState(0);
    s.every(FRAME_MS, () => s.setState(((s.state ?? 0) + 1) % 1e5));
  }
  const f = s.state ?? 0;
  const { Box, Text } = s.elements;
  if (p.kind === "spin") return /* @__PURE__ */ h(Text, { color: p.color }, SPIN[f % SPIN.length]);
  if (p.kind === "bar") {
    const w = Math.max(1, Math.floor(p.width));
    const exact = Math.max(0, Math.min(1, p.ratio)) * w;
    const full = Math.floor(exact);
    const edge = full < w ? EIGHTHS[Math.round((exact - full) * 7)] : "";
    const rest = Math.max(0, w - full - (edge ? 1 : 0));
    const span = full + 6;
    const at = p.moving && full > 2 ? f % span - 3 : -10;
    const parts = [];
    for (let i = 0; i < full; i++) {
      const d = Math.abs(i - at);
      const color = d < 1 ? p.glow : d < 2 ? p.glow : p.color;
      const last = parts.at(-1);
      if (last && last.color === color) last.text += "\u2588";
      else parts.push({ text: "\u2588", color });
    }
    return /* @__PURE__ */ h(Box, { flexDirection: "row" }, parts.map((x, i) => /* @__PURE__ */ h(Text, { key: `f${i}`, color: x.color }, x.text)), edge ? /* @__PURE__ */ h(Text, { color: p.color, backgroundColor: p.track }, edge) : null, /* @__PURE__ */ h(Text, { color: p.track }, "\u2588".repeat(rest)));
  }
  return /* @__PURE__ */ h(Box, { flexDirection: "row", flexWrap: "wrap" }, p.colors.map((color, i) => {
    const on = !p.active[i] || (f + i) % 8 < 5;
    return /* @__PURE__ */ h(Text, { key: `c${i}`, color: on ? color : p.dim }, `${p.glyphs[i] ?? "\u25A0"} `);
  }));
};
var pulse_default = Pulse;
export {
  pulse_default as default
};
