// Loads the built Chrome extension (dist/) into Chromium via a persistent
// context and drives the popup UI directly at its chrome-extension:// URL.
// No real Google/Anthropic credentials — this validates rendering and the
// expected failure path (chrome.identity has no signed-in account here).
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const EXT_PATH = path.resolve("dist");
const SHOT_DIR = path.resolve("screenshots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "catchup-ext-"));

// Pinned browser build for this sandbox only; on a normal machine, Playwright
// resolves its own downloaded browser and this path won't exist.
const SANDBOX_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const launchOptions = {
  headless: false,
  args: [
    "--headless=new",
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-sandbox",
  ],
};
if (fs.existsSync(SANDBOX_CHROME)) launchOptions.executablePath = SANDBOX_CHROME;

const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

const consoleErrors = [];

try {
  // Find the extension's ID via its MV3 service worker.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  console.log("Extension ID:", extensionId);

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.waitForSelector("text=Catch Up");
  await page.screenshot({ path: path.join(SHOT_DIR, "1-initial.png") });
  console.log("1-initial.png captured");

  // Toggle window selector: 3 days should become active (blue), 24h inactive.
  await page.click("text=3 days");
  const threeDaysClass = await page.getAttribute("button:has-text('3 days')", "class");
  const oneDayClass = await page.getAttribute("button:has-text('24h')", "class");
  console.log("3 days active?", threeDaysClass.includes("bg-blue-600"));
  console.log("24h inactive?", !oneDayClass.includes("bg-blue-600"));
  await page.screenshot({ path: path.join(SHOT_DIR, "2-window-selected.png") });
  console.log("2-window-selected.png captured");

  // Click "Catch me up" — expect loading state, then an error (no real
  // Google account signed into this sandboxed Chromium). The identity
  // rejection is near-instant here, so the loading state is transient;
  // race the two rather than requiring "Working…" to still be visible.
  const errorLocator = page.locator("div.rounded-md.bg-red-50");
  await Promise.all([
    page.click("text=Catch me up"),
    Promise.race([
      page.waitForSelector("text=Working…", { timeout: 5000 }).then(() =>
        console.log("Loading state observed (Working…)")
      ),
      errorLocator.waitFor({ timeout: 5000 }).then(() =>
        console.log("Loading state was too fast to catch — error already rendered")
      ),
    ]),
  ]);
  await page.screenshot({ path: path.join(SHOT_DIR, "3-loading-or-error.png") });
  console.log("3-loading-or-error.png captured");

  await errorLocator.waitFor({ timeout: 20000 });
  const errorText = await errorLocator.textContent();
  console.log("Error surfaced:", errorText);
  await page.screenshot({ path: path.join(SHOT_DIR, "4-error-state.png") });
  console.log("4-error-state.png captured");

  console.log("\nConsole errors during run:");
  console.log(consoleErrors.length ? consoleErrors.join("\n") : "(none)");
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
