const pptxgen = require("pptxgenjs");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Dhairya Surana";
pptx.company = "Ship";
pptx.subject = "Ship Improvements Impact";
pptx.title = "Ship Improvements Impact";
pptx.lang = "en-US";

const C = {
  bg: "F6F2E9",
  title: "123B2F",
  text: "1F1F1F",
  accent: "2E7D5B",
  card: "FFFFFF",
  border: "D9D1C7",
};

function slideBase(title, subtitle = "") {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.33,
    h: 0.6,
    fill: { color: C.accent },
    line: { color: C.accent },
  });
  s.addText(title, {
    x: 0.7,
    y: 0.85,
    w: 12,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 34,
    bold: true,
    color: C.title,
  });
  if (subtitle) {
    s.addText(subtitle, {
      x: 0.7,
      y: 1.45,
      w: 12,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 18,
      color: C.text,
    });
  }
  return s;
}

function bullets(s, lines, y = 2.0) {
  const runs = lines.map((t) => ({ text: t, options: { bullet: { indent: 20 } } }));
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: y - 0.2,
    w: 11.9,
    h: 4.5,
    fill: { color: C.card },
    line: { color: C.border },
    radius: 0.08,
  });
  s.addText(runs, {
    x: 1.1,
    y,
    w: 11.2,
    h: 4.1,
    fontFace: "Aptos",
    fontSize: 22,
    color: C.text,
    breakLine: true,
    paraSpaceAfterPt: 12,
  });
}

{
  const s = slideBase(
    "Ship Improvements Impact",
    "How the code changes improved reliability, maintainability, and user experience"
  );
  bullets(s, [
    "Focused on practical engineering improvements across core quality areas.",
    "Emphasized changes that reduce operational risk in real workflows.",
    "Captured evidence in a repeatable, command-driven workflow.",
  ], 2.2);
}

{
  const s = slideBase("What Improved");
  bullets(s, [
    "Type safety improved through tighter constraints and cleaner patterns.",
    "Frontend loading behavior improved through targeted code splitting.",
    "Database behavior became easier to inspect and reason about.",
    "Runtime error handling improved for edge-case resilience.",
    "Accessibility and keyboard-first interaction improved across key views.",
  ]);
}

{
  const s = slideBase("Impact on Product Health");
  bullets(s, [
    "The app is more predictable under real usage conditions.",
    "Bottlenecks are easier to identify and prioritize.",
    "Failure modes are clearer, which shortens diagnosis cycles.",
    "Confidence increased because improvements are evidence-backed.",
  ]);
}

{
  const s = slideBase("Impact on Engineering Workflow");
  bullets(s, [
    "Measurements moved toward deterministic command-based execution.",
    "Evidence is centralized for easier reruns and comparisons.",
    "Instrumentation now supports faster root-cause analysis.",
    "Documentation is more tightly aligned with code changes and outcomes.",
  ]);
}

{
  const s = slideBase("Reflection");
  bullets(s, [
    "AI was useful for exploration and synthesis, but deterministic tooling was better for measurement execution.",
    "A command-based measurement workflow produced more trustworthy outputs.",
    "In hindsight, deploying earlier would have improved baseline capture quality.",
    "After local environment instability, live-environment measurements gave a truer user-facing picture.",
    "A CE-skills workflow helped structure execution and reflection across categories.",
  ]);
}

{
  const s = slideBase("Close");
  bullets(s, [
    "These changes improved system quality and team confidence.",
    "The codebase is now in a stronger state for future iteration.",
  ], 2.3);
}

pptx.writeFile({
  fileName: "docs/dhairya_docs/Audit-via-codex/ship_improvements_impact_slides.pptx",
});

