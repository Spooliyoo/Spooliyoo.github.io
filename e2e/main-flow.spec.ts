import { expect, test } from "@playwright/test";

test("add a spool, log a print, see grams deducted, then use it offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 60_000 });

  // Add a spool
  await page.getByRole("link", { name: "Add spool" }).first().click();
  await page.getByLabel("Spool ID").fill("PLA-001");
  await page.getByLabel("Display name").fill("Matte Black PLA");
  await page.getByLabel("Price (INR)").fill("1200");
  await page.getByLabel("Empty-spool weight (g)").fill("200");
  await page.getByRole("button", { name: "Add spool" }).click();
  await expect(page.getByRole("heading", { name: "Matte Black PLA" })).toBeVisible();
  await expect(page.getByText("1,000 g").first()).toBeVisible();

  // Duplicate IDs are rejected
  await page.goto("/spools/new/");
  await page.getByLabel("Spool ID").fill(" pla-001 ");
  await page.getByLabel("Display name").fill("Dup");
  await page.getByLabel("Price (INR)").fill("1");
  await page.getByLabel("Empty-spool weight (g)").fill("1");
  await page.getByRole("button", { name: "Add spool" }).click();
  await expect(page.getByText(/already used/)).toBeVisible();

  // Log a print (spool is pre-selected)
  await page.goto("/prints/new/");
  await page.getByLabel("Model name").fill("Benchy");
  await page.getByLabel("Hours", { exact: true }).fill("1");
  await page.getByLabel("Minutes", { exact: true }).fill("30");
  await page.getByLabel("Model (g)").fill("100");
  await expect(page.getByLabel("Purge (g)")).toHaveValue("5");
  // live price: 105 g × 1.2 = 126.00 filament
  await expect(page.getByText("₹126.00")).toBeVisible();
  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page.getByRole("heading", { name: "Benchy" })).toBeVisible();

  // Spool now shows 895 g
  await page.getByRole("link", { name: /Matte Black PLA/ }).click();
  await expect(page.getByText("895 g").first()).toBeVisible();

  // Over-use warning
  await page.goto("/prints/new/");
  await page.getByLabel("Model (g)").fill("2000");
  await expect(page.getByText(/has 895 g left but this print needs/)).toBeVisible();

  // History search
  await page.goto("/prints/");
  await expect(page.getByText("Benchy")).toBeVisible();

  // Backup export downloads a file
  await page.goto("/settings/");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/^spooliyoo-backup-.*\.json$/);

  // Offline: wait for the service worker to take control, then reload with no network
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
      );
    return reg.active?.state;
  });
  // let precaching finish
  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      for (const k of keys) {
        const c = await caches.open(k);
        const reqs = await c.keys();
        const urls = reqs.map((r) => r.url);
        const ready =
          urls.some((u) => /pglite.*\.wasm/.test(u)) &&
          urls.some((u) => /initdb.*\.wasm/.test(u)) &&
          urls.some((u) => /pglite.*\.data/.test(u)) &&
          urls.some((u) => u.endsWith("/spools/"));
        if (ready) return true;
      }
      return false;
    },
    null,
    { timeout: 60_000 },
  );
  // Leave the page first so its database lock is released before the offline load.
  await page.goto("about:blank");
  await context.setOffline(true);
  await page.goto("/spools/");
  await expect(page.getByText("Matte Black PLA")).toBeVisible({ timeout: 60_000 });
  await page.goto("about:blank");
  await page.goto("/prints/");
  await expect(page.getByText("Benchy")).toBeVisible();
  await page.goto("/spools/view/?id=not-a-real-id");
  await expect(page.getByText("Spool not found")).toBeVisible();
  await context.setOffline(false);

  expect(errors).toEqual([]);
});
