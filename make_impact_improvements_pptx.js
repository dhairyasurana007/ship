const pptxgen = require("pptxgenjs");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Dhairya Surana";
pptx.company = "Ship";
pptx.subject = "Impact of Code Improvements";
pptx.title = "Ship Improvements Impact";
pptx.lang = "en-US";

const COLORS = {
  bg: "F7F4EC",
  title: "173A2E",
  text: "2A2A2A",
  accent: "3B7A57",
  card: "FFFFFF",
};

function addBaseSlide(title, subtitle) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };
  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.33,
    h: 0.7,
    fill: { color: COLORS.accent },
    line: { color: COLORS.accent },
  });
  s.addText(title, {
    x: 0.7,
    y: 0.95,
    w: 12.0,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 34,
    bold: true,
    color: COLORS.title,
  });
  if (subtitle) {
    s.addText(subtitle, {
      x: 0.7,
      y: 1.55,
      w: 12.0,
      h: 0.45,
      fontFace: "Aptos",
      fontSize: 18,
      color: COLORS.text,
    });
  }
  return s;
}

function addBullets(slide, items, x = 0.95, y = 2.1, w = 11.8, h = 4.5) {
  const runs = items.map((t) => ({ text: t, options: { bullet: { indent: 20 } } }));
  slide.addText(runs, {
    x,
    y,
    w,
    h,
    fontFace: "Aptos",
    fontSize: 22,
    color: COLORS.text,
    breakLine: true,
    paraSpaceAfterPt: 12,
  });
}

// Slide 1
{
  const s = addBaseSlide(
    "Ship Quality Improvements",
    "How the code changes improved reliability, speed, and maintainability"
  );
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.95,
    y: 2.3,
    w: 11.5,
    h: 2.6,
    fill: { color: COLORS.card },
    line: { color: "D9D1C7" },
    radius: 0.12,
  });
  addBullets(
    s,
    [
      "Focused on measurable product health improvements across core engineering categories.",
      "Prioritized changes that reduce risk in real user workflows.",
      "Validated outcomes with repeatable measurement workflows and saved evidence.",
    ],
    1.2,
    2.65,
    10.9,
    2.1
  );
}

// Slide 2
{
  const s = addBaseSlide("What Improved Most");
  addBullets(s, [
    "Type safety posture improved through targeted cleanup and stronger guardrails.",
    "Frontend payload behavior improved through chunking and lazy-loading strategy changes.",
    "Database query visibility improved with instrumentation and plan-level analysis.",
    "Runtime resilience improved through better error handling and recovery behavior.",
    "Accessibility posture improved through focused interaction and contrast fixes.",
  ]);
}

// Slide 3
{
  const s = addBaseSlide("Performance and Runtime Impact");
  addBullets(s, [
    "Request benchmarking now runs against live infrastructure and reflects real operating conditions.",
    "The team can now distinguish local assumptions from production behavior.",
    "Observed bottlenecks are clearer, which makes prioritization of backend work more defensible.",
    "Operational risk is lower because failure modes and edge cases are now explicitly tracked.",
  ]);
}

// Slide 4
{
  const s = addBaseSlide("Developer Workflow Impact");
  addBullets(s, [
    "Measurement collection moved toward a deterministic command-driven flow.",
    "Evidence capture is centralized, making follow-up comparisons easier.",
    "Documentation now maps implementation changes to practical product outcomes.",
    "The codebase is easier to reason about for future contributors.",
  ]);
}

// Slide 5
{
  const s = addBaseSlide("Reflection");
  addBullets(s, [
    "I learned to separate AI-assisted reasoning from measurement execution.",
    "For measurement quality, deterministic tooling produced more trustworthy outcomes than ad hoc runs.",
    "I would deploy earlier in future projects before MVP-level implementation to lock a stable baseline.",
    "After local environment instability, rerunning against the live app gave a truer picture of user-facing behavior.",
    "I also tested a new development workflow using CE skills to structure execution and synthesis.",
  ]);
}

// Slide 6
{
  const s = addBaseSlide("Close");
  addBullets(s, [
    "The changes improved system health, clarity, and confidence in decision-making.",
    "The next step is to continue tightening repeatability while reducing identified production bottlenecks.",
  ]);
}

pptx.writeFile({ fileName: "docs/dhairya_docs/Audit-via-codex/ship_improvements_impact_slides.pptx" });

