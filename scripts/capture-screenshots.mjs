import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.PREVIEW_URL || "http://127.0.0.1:3000";
await mkdir("docs/screenshots", { recursive: true });
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
  });
  await page.goto(baseURL);
  await page.getByRole("heading", { name: "Good ideas start here." }).waitFor();
  await page.screenshot({ path: "docs/screenshots/dashboard.png", fullPage: true });
  await page.goto(`${baseURL}/campaigns/new?sample=myhotelline`);
  await page.getByLabel("Product or company name").waitFor();
  await page.screenshot({ path: "docs/screenshots/campaign-brief.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/mobile-brief.png", fullPage: true });
} finally {
  await browser.close();
}
