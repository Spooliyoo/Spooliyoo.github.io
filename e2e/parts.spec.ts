import { expect, test } from "@playwright/test";

test("log a multi-part model in one print", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/spools/new/");
  await page.getByLabel("Spool ID").fill("PLA-9");
  await page.getByLabel("Display name").fill("Grey PLA");
  await page.getByLabel("Price (INR)").fill("1000");
  await page.getByLabel("Empty-spool weight (g)").fill("200");
  await page.getByRole("button", { name: "Add spool" }).click();
  await expect(page.getByRole("heading", { name: "Grey PLA" })).toBeVisible({ timeout: 60_000 });

  await page.goto("/prints/new/");
  await page.getByLabel("Model name").fill("Robot");
  await page.getByLabel("This model has several parts printed separately").check();

  // Part 1
  await page.locator("#parts\\.0\\.name").fill("Head");
  await page.locator("#parts\\.0\\.hours").fill("1");
  await page.locator("#lines\\.0\\.modelG").fill("40");

  // Part 2
  await page.getByRole("button", { name: "Add another part" }).click();
  await page.locator("#parts\\.1\\.name").fill("Body");
  await page.locator("#parts\\.1\\.mins").fill("45");
  await page.locator("#lines\\.1\\.modelG").fill("60");
  await expect(page.getByText(/2 parts · total 1:45/)).toBeVisible();

  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page.getByRole("heading", { name: "Robot" })).toBeVisible();
  await expect(page.getByText("Part 1 · Head")).toBeVisible();
  await expect(page.getByText("Part 2 · Body")).toBeVisible();

  // One entry in Prints, with a parts badge; grams deducted from the spool (40 + 5 purge + 60)
  await page.goto("/prints/");
  await expect(page.getByText("Robot")).toHaveCount(1);
  await expect(page.getByText("2 parts")).toBeVisible();
  await page.goto("/spools/");
  await expect(page.getByText("895 g").first()).toBeVisible();

  expect(errors).toEqual([]);
});
