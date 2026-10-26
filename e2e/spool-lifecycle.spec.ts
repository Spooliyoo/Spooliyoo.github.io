import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function selectByText(page: Page, label: string, text: string) {
  const select = page.getByLabel(label, { exact: true });
  const value = await select.locator("option", { hasText: text }).getAttribute("value");
  await select.selectOption(value!);
}

async function addSpool(page: Page, code: string, name: string) {
  await page.goto("/spools/new/");
  await page.getByLabel("Spool ID").fill(code);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Price (INR)").fill("1000");
  await page.getByLabel("Empty-spool weight (g)").fill("250");
  await page.getByRole("button", { name: "Add spool" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 60_000 });
}

test("weight correction, multi-spool print, edit, delete and backup restore", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await addSpool(page, "PETG-1", "Blue PETG");
  await addSpool(page, "PETG-2", "White PETG");

  // Weight correction: gross 1150 − tare 250 = 900 g
  await page.getByRole("button", { name: "Correct weight" }).click();
  await page.getByLabel("Scale reading (g)").fill("1150");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("900 g").first()).toBeVisible();
  await expect(page.getByText("Weight correction")).toBeVisible();

  // Two-spool print; purge defaults onto the first spool
  await page.goto("/prints/new/");
  await page.getByLabel("Model name").fill("Two-tone vase");
  await page.getByLabel("Print time (h:mm)").fill("2:00");
  await selectByText(page, "Spool", "PETG-1");
  await page.getByLabel("Model (g)").fill("50");
  await page.getByRole("button", { name: "Add another spool" }).click();
  await selectByText(page, "Spool 2", "PETG-2");
  await page.locator("#lines\\.1\\.modelG").fill("30");
  await page.getByRole("button", { name: "Save print" }).click();
  await expect(page.getByRole("heading", { name: "Two-tone vase" })).toBeVisible();
  await expect(page.getByText("85 g").first()).toBeVisible(); // 50 + 5 purge + 30

  // Edit: change model weight on spool 2
  await page.getByRole("link", { name: "Edit" }).click();
  await page.locator("#lines\\.1\\.modelG").fill("40");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("95 g").first()).toBeVisible();
  await page.getByRole("link", { name: /White PETG/ }).click();
  await expect(page.getByText("860 g").first()).toBeVisible(); // 900 after correction − 40

  // Export a backup, delete the print, then restore
  await page.goto("/settings/");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const backupPath = await (await dl).path();
  expect(JSON.parse(readFileSync(backupPath, "utf8")).data.prints).toHaveLength(1);

  await page.goto("/prints/");
  await page.getByText("Two-tone vase").click();
  await page.getByRole("button", { name: "Delete print" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText("No prints yet")).toBeVisible();

  await page.goto("/settings/");
  await page.getByLabel("Backup file").setInputFiles(backupPath);
  await expect(page.getByText("1 prints")).toBeVisible();
  await page.getByRole("button", { name: "Replace my data" }).click();
  await expect(page.getByText("Backup restored")).toBeVisible();
  await page.goto("/prints/");
  await expect(page.getByText("Two-tone vase")).toBeVisible();

  // Archive: spool with prints can't be deleted, only archived
  await page.goto("/spools/");
  await page.getByRole("link", { name: /White PETG/ }).click();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});
