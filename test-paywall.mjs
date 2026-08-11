// Renders the popup against a stubbed backend to check the billing UI
// (allowance line + paywall) without needing Stripe, Google, or credits.
// Complements test-popup.mjs, which covers the real unauthenticated path.
import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import os from "os";

const EXT_PATH = path.resolve("dist");
const SHOT_DIR = path.resolve("screenshots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "catchup-paywall-"));

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

/** Replaces the extension's messaging with canned billing responses. */
function stubBackend(status) {
  return `(() => {
    const status = ${JSON.stringify(status)};
    const orig = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = () => Promise.resolve({});
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg.type === "getStatus") cb({ ok: true, status });
      else if (msg.type === "startCheckout") { window.__checkout = msg.kind; cb({ ok: true }); }
      else cb({ ok: false, error: "unexpected" });
    };
    void orig;
  })()`;
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;

  const errors = [];

  // Scenario 1: allowance remaining — expect the free-count line, no paywall.
  const withAllowance = await context.newPage();
  withAllowance.on("pageerror", (e) => errors.push(`allowance: ${e}`));
  await withAllowance.addInitScript(
    stubBackend({
      email: "test@example.com",
      subscribed: false,
      freeRemaining: 2,
      credits: 0,
      nextDrawsOn: "free",
    })
  );
  await withAllowance.goto(popupUrl);
  await withAllowance.waitForSelector("text=2 free left this month");
  const buttonEnabled = await withAllowance.isEnabled("button:has-text('Catch me up')");
  console.log("Allowance line shown; Catch me up enabled?", buttonEnabled);
  await withAllowance.screenshot({ path: path.join(SHOT_DIR, "5-allowance.png") });

  // Scenario 2: exhausted — expect the paywall with both purchase options.
  const paywalled = await context.newPage();
  paywalled.on("pageerror", (e) => errors.push(`paywall: ${e}`));
  await paywalled.addInitScript(
    stubBackend({
      email: "test@example.com",
      subscribed: false,
      freeRemaining: 0,
      credits: 0,
      nextDrawsOn: null,
    })
  );
  await paywalled.goto(popupUrl);
  await paywalled.waitForSelector("text=You've used your 3 free catch-ups");
  const blocked = await paywalled.isDisabled("button:has-text('Catch me up')");
  console.log("Paywall shown; Catch me up disabled?", blocked);
  await paywalled.screenshot({ path: path.join(SHOT_DIR, "6-paywall.png") });

  // Clicking a purchase option should dispatch the right checkout kind.
  await paywalled.click("button:has-text('1 catch-up')");
  await paywalled.waitForFunction("window.__checkout === 'single'", { timeout: 3000 });
  console.log("Single-purchase button dispatched kind=single");

  await paywalled.click("button:has-text('Unlimited')");
  await paywalled.waitForFunction("window.__checkout === 'subscription'", { timeout: 3000 });
  console.log("Subscription button dispatched kind=subscription");

  // Scenario 3: subscriber — expect "Unlimited", never the paywall.
  const subscriber = await context.newPage();
  subscriber.on("pageerror", (e) => errors.push(`subscriber: ${e}`));
  await subscriber.addInitScript(
    stubBackend({
      email: "test@example.com",
      subscribed: true,
      freeRemaining: 0,
      credits: 0,
      nextDrawsOn: "subscription",
    })
  );
  await subscriber.goto(popupUrl);
  await subscriber.waitForSelector("text=Unlimited · subscribed");
  console.log("Subscriber state shown");
  await subscriber.screenshot({ path: path.join(SHOT_DIR, "7-subscribed.png") });

  console.log("\nPage errors:", errors.length ? errors.join("\n") : "(none)");
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
