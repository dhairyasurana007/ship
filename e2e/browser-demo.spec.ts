import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HTML = readFileSync(
  join(process.cwd(), "integrations/browser-demo/index.html"),
  "utf8",
);

async function serveDemo() {
  const server = createServer((req, res) => {
    if (!req.url || req.url.startsWith("/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start demo server");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/index.html`,
  };
}

test("browser SDK demo performs PKCE login and lists docs", async ({
  page,
}) => {
  const demo = await serveDemo();
  try {
    const apiBase = "https://ship-api-ysxi.onrender.com";

    await page.route("**/oauth/authorize**", async (route) => {
      if (route.request().method() === "GET") {
        const html = `<!DOCTYPE html>
<html>
  <body>
    <h2>Authorize Ship</h2>
    <form method="POST" action="/oauth/authorize">
      <input type="email" name="email" />
      <input type="password" name="password" />
      <button type="submit" name="action" value="approve">Approve</button>
    </form>
  </body>
</html>`;

        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "access-control-allow-origin": "*",
          },
          body: html,
        });
        return;
      }

      await route.fulfill({
        status: 302,
        headers: {
          location: `${demo.url}?code=demo-code`,
          "access-control-allow-origin": "*",
        },
        body: "",
      });
    });

    await page.route("**/oauth/token", async (route) => {
      const postBody = route.request().postData() ?? "";
      expect(postBody).toContain("grant_type=authorization_code");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
        },
        body: JSON.stringify({
          access_token: "demo-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      });
    });

    await page.route("**/api/v1/docs**", async (route) => {
      expect(route.request().headers()["authorization"]).toBe(
        "Bearer demo-token",
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
        },
        body: JSON.stringify({
          data: [{ id: "doc-1", title: "Demo Doc" }],
          next_cursor: null,
        }),
      });
    });

    await page.goto(`${demo.url}?client_id=demo-client`);
    await expect(page.locator("#status")).toHaveText("Not logged in");

    await page.click("#loginBtn");
    await expect(page).toHaveURL(/oauth\/authorize/);
    await page.fill('input[name="email"]', "dev@ship.local");
    await page.fill('input[name="password"]', "admin123");
    await page.click('button[value="approve"]');

    await expect(page.locator("#status")).toHaveText("Logged in");
    await expect(page.locator("#docs li")).toHaveText("Demo Doc");
  } finally {
    demo.server.close();
  }
});
