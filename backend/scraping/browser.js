const { chromium } = require("playwright");

async function newBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
}

async function newContext(browser) {
  return browser.newContext({
    storageState: "auth.json",
    viewport: { width: 1280, height: 800 },
    locale: "es-ES",
    timezoneId: "America/Lima",
  });
}

module.exports = { newBrowser, newContext };