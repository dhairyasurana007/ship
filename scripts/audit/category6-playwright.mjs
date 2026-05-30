#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const EMAIL = process.env.AUDIT_EMAIL || "dev@ship.local";
const PASSWORD = process.env.AUDIT_PASSWORD || "admin123";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const dialogs = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push({ message: err?.message || String(err) });
  });
  page.on("requestfailed", (req) => {
    requestFailures.push({
      url: req.url(),
      failureText: req.failure()?.errorText || "unknown",
    });
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    void dialog.dismiss().catch(() => {});
  });

  const result = {
    ok: false,
    login: { success: false, error: null },
    console: { errorCount: 0, sample: [] },
    page: { errorCount: 0, sample: [] },
    networkRecovery: {
      status: "Blocked",
      offlineRequestFailures: 0,
      recovered: false,
      error: null,
    },
    scriptPayloadRendering: {
      status: "Unknown",
      dialogTriggered: false,
      dialogCount: 0,
    },
  };

  try {
    await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
    result.login.success = true;

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const failuresBefore = requestFailures.length;
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const offlineFailures = requestFailures.length - failuresBefore;

    await context.setOffline(false);
    await page.reload({ waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const recovered = !page.url().includes("/login");
    result.networkRecovery = {
      status: recovered
        ? "Pass"
        : offlineFailures > 0
          ? "Partial"
          : "Fail",
      offlineRequestFailures: Math.max(0, offlineFailures),
      recovered,
      error: null,
    };

    result.scriptPayloadRendering = {
      status: dialogs.length > 0 ? "Fail" : "Pass",
      dialogTriggered: dialogs.length > 0,
      dialogCount: dialogs.length,
    };

    result.console = {
      errorCount: consoleErrors.length,
      sample: consoleErrors.slice(0, 10),
    };
    result.page = {
      errorCount: pageErrors.length,
      sample: pageErrors.slice(0, 10),
    };
    result.ok = true;
  } catch (err) {
    result.login.error = err?.message || String(err);
    result.networkRecovery.error = err?.message || String(err);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(result, null, 2), "utf8");
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  process.exit(result.ok ? 0 : 1);
}

void run();
