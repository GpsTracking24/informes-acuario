// scraping/session.js
const { chromium } = require("playwright");
const { login } = require("./login");

let browser;
let context;
let page;

let cookiesCache = null;
let cookiesAt = 0;
const COOKIES_TTL_MS = 8 * 60 * 1000; // 8 min (ajusta; 5-15 min es buena práctica)

async function ensurePage() {
  if (page) return page;

  browser = await chromium.launch({
    headless: true,
    // si necesitas ver el browser, pon false
  });

  context = await browser.newContext();
  page = await context.newPage();
  return page;
}

function cookiesLookValid(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  // buscamos al menos una cookie típica de sesión
  const names = new Set(cookies.map(c => c.name));
  return names.has("laravel_session") || names.has("PHPSESSID");
}

async function getMaponSessionCookies(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && cookiesCache && (now - cookiesAt) < COOKIES_TTL_MS) {
    return cookiesCache;
  }

  const p = await ensurePage();

  // hace login si hace falta (tu función ya detecta el form)
  await login(p);
await page.goto("https://mapon.com/pro/reports/activity", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800); // deja que setee cookies XSRF
  // importante: cookies de mapon.com (y subrutas)
  const cookies = await context.cookies("https://mapon.com");
  console.log("cookie names:", cookies.map(c => c.name));

  if (!cookiesLookValid(cookies)) {
    throw new Error("No se obtuvieron cookies válidas tras login");
  }

  cookiesCache = cookies;
  cookiesAt = now;
  return cookies;
}

async function closeSession() {
  try { await page?.close(); } catch {}
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  page = null; context = null; browser = null;
  cookiesCache = null; cookiesAt = 0;
}

module.exports = { getMaponSessionCookies, closeSession };