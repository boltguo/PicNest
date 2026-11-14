import { expect, test } from "@playwright/test";

test("upload, thumbnails, retry, copy formats, maintenance and mobile layout", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="password"]').fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New folder", exact: true }),
  ).toBeVisible();

  const image = async (color: string) =>
    Buffer.from(
      await page.evaluate((color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 800;
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 1000, 800);
        return canvas.toDataURL("image/png").split(",")[1];
      }, color),
      "base64",
    );
  const original = await image("#784d8a");
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "preview-test.png",
      mimeType: "image/png",
      buffer: original,
    });
  await expect(page.getByText("1 / 1 uploaded", { exact: true })).toBeVisible();
  const photo = page.getByAltText("preview-test.png", { exact: true });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(480);

  let fail = true;
  await page.route("**/api/upload?**", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 500,
        body: '{"error":"test failure"}',
        contentType: "application/json",
      });
    } else await route.continue();
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "retry-test.png",
      mimeType: "image/png",
      buffer: await image("#ffd9ba"),
    });
  await page.getByRole("button", { name: "Retry failed", exact: true }).click();
  await expect(page.getByText("2 / 2 uploaded", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse uploads", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand uploads", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand uploads", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear finished", exact: true })
    .click();

  await page.getByRole("button", { name: "Copy format", exact: true }).click();
  await page.getByText("Markdown", { exact: true }).click();
  await page
    .getByRole("button", { name: "More actions", exact: true })
    .first()
    .click();
  await page.getByText("Copy public link", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^!\[.*\]\(<http:\/\/localhost:5173\/f\//);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Copy format", exact: true }),
  ).toHaveText("Markdown");

  await page
    .getByRole("button", { name: "More actions", exact: true })
    .first()
    .click();
  await page.getByText("Share…", { exact: true }).click();
  await expect(
    page.getByText(/public direct link remains accessible/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Library maintenance", { exact: true }).click();
  await page.getByRole("button", { name: "Scan library", exact: true }).click();
  await expect(page.getByText(/Completed ·/)).toBeVisible();
  await expect(
    page.getByText("No issues found so far", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();

  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
