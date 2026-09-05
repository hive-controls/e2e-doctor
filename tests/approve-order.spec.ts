import { test, expect } from "@playwright/test";

/**
 * The baseline spec: sign in, pick an order, approve it.
 * The breakage corpus breaks the app under this spec three ways and measures what
 * Playwright's first-party Healer can repair unaided.
 */
test("approve an order end to end", async ({ page }) => {
  await page.goto("/");

  // Step 1 — sign in
  await page.fill("#email", "ops@example.test");
  await page.fill("#password", "fixture-password");
  await page.click("#signin-button");
  await expect(page.getByTestId("current-user")).toHaveText("ops@example.test");

  // Step 2 — open an order from the list
  await page.click('[data-order-id="SO-4472"]');
  await expect(page.getByTestId("detail-id")).toHaveText("SO-4472");
  await expect(page.getByTestId("detail-customer")).toHaveText("Contoso Rail");

  // Step 3 — approve it
  await page.fill("#note", "verified against PO 88120");
  await page.click("#approve-button");

  // Step 4 — confirmation
  await expect(page.getByTestId("confirmation")).toHaveText("Order approved");
  await expect(page.locator("#confirmation-detail")).toContainText(
    "SO-4472 approved",
  );
});
