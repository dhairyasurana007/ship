import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function importFromLocalOrGlobal(localSpecifier, globalParts) {
  try {
    return await import(localSpecifier);
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    const entry = path.join(globalRoot, ...globalParts);
    return await import(pathToFileURL(entry).href);
  }
}

async function main() {
  const { nvda } = await importFromLocalOrGlobal("@guidepup/guidepup", [
    "@guidepup",
    "guidepup",
    "dist",
    "index.js",
  ]);
  const { chromium } = await importFromLocalOrGlobal("@playwright/test", [
    "@playwright",
    "test",
    "index.mjs",
  ]);

  const baseUrl = process.env.SHIP_BASE_URL || "http://localhost:5173";
  const email = process.env.SHIP_EMAIL || "dev@ship.local";
  const password = process.env.SHIP_PASSWORD || "admin123";
  const outPath = path.resolve(
    "docs/dhairya_docs/Audit-via-codex/category7-screen-reader-evidence.json",
  );

  const evidence = {
    runAt: new Date().toISOString(),
    tool: "NVDA via Guidepup",
    baseUrl,
    login: null,
    routes: [],
    notes: [
      "Run uses Guidepup capture mode and stores spoken/item logs per route.",
    ],
  };

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    slowMo: 100,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const sampleSpeech = async (label) => {
    await page.waitForTimeout(350);
    const phrase = (await nvda.lastSpokenPhrase()) || "";
    return { label, phrase };
  };

  try {
    await nvda.start({ capture: true, retries: 3, timeout: 15000 });
    console.log("NVDA started");

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const loginSpeech = [];
    await nvda.clearSpokenPhraseLog();
    await nvda.clearItemTextLog();
    await nvda.next({ capture: true });
    loginSpeech.push(await sampleSpeech("login-page-loaded"));

    const emailLocator = page.locator('input[type="email"]');
    const passwordLocator = page.locator('input[type="password"]');
    await emailLocator.click();
    loginSpeech.push(await sampleSpeech("email-focused"));
    await emailLocator.fill(email);
    await passwordLocator.click();
    loginSpeech.push(await sampleSpeech("password-focused"));
    await passwordLocator.fill(password);
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")').first().click();
    await page.waitForTimeout(1500);
    const loginUrl = page.url();
    await nvda.next({ capture: true });
    loginSpeech.push(await sampleSpeech("post-login"));
    evidence.login = {
      success: !loginUrl.includes("/login"),
      finalUrl: loginUrl,
      speech: loginSpeech,
      spokenPhraseLog: await nvda.spokenPhraseLog(),
      itemTextLog: await nvda.itemTextLog(),
    };

    await page.goto(`${baseUrl}/documents`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const dynamicDocumentPath = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const match = anchors
        .map((a) => a.getAttribute("href"))
        .find((href) => typeof href === "string" && /^\/documents\/[^/]+$/.test(href));
      return match || null;
    });

    const routes = [
      "/login",
      "/setup",
      "/my-week",
      "/dashboard",
      "/docs",
      "/issues",
      "/projects",
      "/programs",
      dynamicDocumentPath || "/documents",
      "/team-allocation",
      "/team-directory",
      "/team-status",
      "/team-reviews",
      "/team-org-chart",
      "/admin",
      "/settings",
      "/settings/conversions",
    ];

    for (const route of routes) {
      const routeEvidence = {
        route,
        finalUrl: null,
        title: null,
        speech: [],
        focusSteps: [],
        spokenPhraseLog: [],
        itemTextLog: [],
      };
      await nvda.clearSpokenPhraseLog();
      await nvda.clearItemTextLog();
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      routeEvidence.finalUrl = page.url();
      routeEvidence.title = await page.title();
      await nvda.next({ capture: true });
      routeEvidence.speech.push(await sampleSpeech("route-loaded"));

      for (let i = 1; i <= 8; i++) {
        await page.keyboard.press("Tab");
        await nvda.next({ capture: true });
        const active = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          const text = (el.textContent || "").trim().slice(0, 80);
          return {
            tag: el.tagName,
            id: el.id || null,
            role: el.getAttribute("role"),
            label:
              el.getAttribute("aria-label") ||
              el.getAttribute("name") ||
              text ||
              null,
          };
        });
        routeEvidence.focusSteps.push({ step: i, active });
        routeEvidence.speech.push(await sampleSpeech(`tab-${i}`));
      }
      routeEvidence.spokenPhraseLog = await nvda.spokenPhraseLog();
      routeEvidence.itemTextLog = await nvda.itemTextLog();

      evidence.routes.push(routeEvidence);
    }
  } finally {
    try {
      await nvda.stop();
      console.log("NVDA stopped");
    } catch {}
    await browser.close();
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`Evidence written: ${outPath}`);
}

main().catch((error) => {
  console.error("Screen reader audit failed:", error);
  process.exit(1);
});
