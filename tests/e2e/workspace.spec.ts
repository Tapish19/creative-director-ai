import { expect, test } from "@playwright/test";

test("unconfigured dashboard is honest and links to the actual sample brief", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good ideas start here." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Supabase credentials are needed");
  await expect(page.getByRole("heading", { name: "Your first story is waiting" })).toBeVisible();
  await page.getByRole("link", { name: "Try the MyHotelLine brief" }).click();
  await expect(page.getByLabel("Product or company name")).toHaveValue("MyHotelLine");
  await expect(page.getByRole("button", { name: "Create campaign", exact: true })).toBeDisabled();
});

test("brief can be edited, loaded from the sample, and switched to 30 seconds", async ({
  page,
}) => {
  await page.goto("/campaigns/new");
  await expect(page.getByLabel("Product or company name")).toBeEmpty();
  await page.getByRole("button", { name: "Use sample brief" }).click();
  await expect(page.getByLabel("Product or company name")).toHaveValue("MyHotelLine");
  await expect(page.getByLabel("What should viewers do next?")).toHaveValue(
    "Book a free product demo",
  );
  await page.getByRole("radio", { name: "30 seconds" }).check();
  await expect(page.getByRole("radio", { name: "30 seconds" })).toBeChecked();
  await page.getByLabel("How should it feel?").fill("Warm and approachable");
  await expect(page.getByLabel("How should it feel?")).toHaveValue("Warm and approachable");
});

test("setup and auth explain the required connection without a mock login", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Configuration needed", { exact: true })).toBeVisible();
  await expect(page.getByText("SUPABASE_PUBLISHABLE_KEY=…", { exact: false })).toBeVisible();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true }).last()).toBeDisabled();
  await page.getByRole("button", { name: "Create account", exact: true }).first().click();
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "new-password");
});

test("mobile layout keeps the form usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/campaigns/new?sample=myhotelline", "/settings", "/login"]) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("invalid campaign identifiers produce a not-found page", async ({ page }) => {
  await page.goto("/campaigns/not-a-uuid");
  // With a loading boundary, Next.js may stream a 200 before resolving notFound().
  await expect(page.getByRole("heading", { name: "This direction leads nowhere." })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
});

test("repeated or malformed filter parameters do not crash the dashboard", async ({ page }) => {
  await page.goto("/?q=first&q=second&page=bad&page=2");
  await expect(page.getByRole("heading", { name: "Good ideas start here." })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search campaign names" })).toBeEmpty();
});

test("generation polling rejects invalid IDs and reports missing configuration", async ({
  request,
}) => {
  const invalid = await request.get("/api/generations/not-a-uuid/status");
  expect(invalid.status()).toBe(400);
  const unavailable = await request.get(
    "/api/generations/10000000-0000-4000-8000-000000000001/status",
  );
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "Workspace is not configured." });
  expect(unavailable.headers()["cache-control"]).toContain("no-store");
});

test("settings explain the real Phase 2 worker setup", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Text worker setup" })).toBeVisible();
  await expect(page.getByText("SUPABASE_SERVICE_ROLE_KEY", { exact: true })).toBeVisible();
  await expect(page.getByText("npm run worker", { exact: true })).toBeVisible();
});

test("settings explain image generation and the separate image worker", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Image worker setup" })).toBeVisible();
  await expect(page.getByText("CLOUDFLARE_API_TOKEN", { exact: true })).toBeVisible();
  await expect(page.getByText("npm run worker:images", { exact: true })).toBeVisible();
});

test("settings explain both voice providers and local speech verification", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Voice worker setup" })).toBeVisible();
  await expect(page.getByText("npm run worker:voice", { exact: true })).toBeVisible();
  await expect(page.getByText("npm run voice:smoke", { exact: true })).toBeVisible();
  await expect(page.getByText("ELEVENLABS_VOICE_ID", { exact: true })).toBeVisible();
});

test("audio playback validates identifiers and requires workspace configuration", async ({
  request,
}) => {
  expect((await request.get("/api/generations/not-a-uuid/voice")).status()).toBe(400);
  const response = await request.get("/api/generations/10000000-0000-4000-8000-000000000001/voice");
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
});

test("private scene previews reject invalid identifiers and missing configuration", async ({
  request,
}) => {
  expect((await request.get("/api/scenes/not-a-uuid/image")).status()).toBe(400);
  const unavailable = await request.get("/api/scenes/10000000-0000-4000-8000-000000000001/image");
  expect(unavailable.status()).toBe(503);
  expect(unavailable.headers()["cache-control"]).toBe("private, no-store");
  expect(await unavailable.json()).toEqual({ error: "Workspace is not configured." });
});

test("settings document the real render worker and local verification", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Render worker setup" })).toBeVisible();
  await expect(page.getByText("npm run worker:render", { exact: true })).toBeVisible();
  await expect(page.getByText("npm run render:smoke", { exact: true })).toBeVisible();
});

test("video playback and downloads validate IDs and require configuration", async ({ request }) => {
  expect((await request.get("/api/generations/not-a-uuid/video")).status()).toBe(400);
  for (const suffix of ["", "?download=1"]) {
    const response = await request.get(
      `/api/generations/10000000-0000-4000-8000-000000000001/video${suffix}`,
    );
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
});

test("settings explain audiovisual review and the configurable threshold", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Review worker setup" })).toBeVisible();
  await expect(page.getByText("npm run worker:review", { exact: true })).toBeVisible();
  await expect(page.getByText("QUALITY_THRESHOLD", { exact: true })).toBeVisible();
});

test("settings expose the bounded automatic revision configuration", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("MAX_AUTOMATIC_REVISIONS", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Script edits and single-scene changes keep automatic rewrites off.", {
      exact: false,
    }),
  ).toBeVisible();
});
