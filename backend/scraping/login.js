async function acceptCookieBotIfPresent(page) {
  const dialog = page.locator("#CybotCookiebotDialog");
  if ((await dialog.count()) === 0) return;

  const accept = page.locator(
    [
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
      "#CybotCookiebotDialogBodyButtonAccept",
      "button:has-text('Allow all')",
      "button:has-text('Accept all')",
      "button:has-text('Accept')",
      "button:has-text('Aceptar todo')",
      "button:has-text('Permitir todo')",
      "button:has-text('Aceptar')",
    ].join(", ")
  ).first();

  if ((await accept.count()) > 0) {
    await accept.click().catch(async () => accept.click({ force: true }));
    await dialog.first().waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  } else {
    await page.evaluate(() => {
      const el = document.querySelector("#CybotCookiebotDialog");
      if (el) el.style.display = "none";
      document.body.style.overflow = "auto";
    }).catch(() => {});
  }
}

async function login(page) {
  const baseUrl = process.env.BASE_URL || "https://mapon.com";
  const user = process.env.MAPON_USER;
  const pass = process.env.MAPON_PASS;

  if (!user || !pass) {
    throw new Error("Faltan MAPON_USER / MAPON_PASS en .env");
  }

  const targetUrl = `${baseUrl}/partner/client_list/`;

  const findFirst = async (selectors) => {
    for (const sel of selectors) {
      const loc = page.locator(sel);
      if ((await loc.count()) > 0) return loc.first();
    }
    return null;
  };

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  console.log("URL after goto target:", page.url());

  // Si ya estás autenticado y entraste a partner, salir
  if (page.url().includes("/partner/") && !page.url().includes("login")) {
    return;
  }

  await acceptCookieBotIfPresent(page);

  const userInput = await findFirst([
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="login"]',
    'input[placeholder*="Email" i]',
    'input[placeholder*="Correo" i]',
    'input[placeholder*="Usuario" i]',
    'input[placeholder*="Username" i]',
  ]);

  const passInput = await findFirst([
    'input[autocomplete="current-password"]',
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="Password" i]',
    'input[placeholder*="Contraseña" i]',
  ]);

  if (!userInput || !passInput) {
    throw new Error(`No encontré inputs de login. URL: ${page.url()}`);
  }

  await userInput.click();
  await userInput.fill("");
  await userInput.pressSequentially(user, { delay: 50 });

  await passInput.click();
  await passInput.fill("");
  await passInput.pressSequentially(pass, { delay: 50 });

  const typedUser = await userInput.inputValue().catch(() => "");
  const typedPassLen = await passInput.inputValue().then(v => v.length).catch(() => 0);

  console.log("typed user:", typedUser);
  console.log("typed pass length:", typedPassLen);

  await acceptCookieBotIfPresent(page);

  const loginBtn = await findFirst([
    "button#login",
    'button[name="login"]',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("LOGIN")',
    'button:has-text("Sign in")',
    'button:has-text("Iniciar")',
    'button:has-text("Ingresar")',
  ]);

  if (!loginBtn) {
    throw new Error("No encontré botón de login");
  }

  // Primero intenta Enter en password
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
    passInput.press("Enter").catch(() => {})
  ]);

  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle").catch(() => {});

  // Si sigue en login, intenta click al botón
  if (page.url().includes("login")) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}),
      loginBtn.click().catch(async () => loginBtn.click({ force: true }))
    ]);
  }

  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("URL after login submit:", page.url());

  // Fallback: submit manual del form si aún sigue en login
  if (page.url().includes("login")) {
    await page.evaluate(() => {
      const form = document.querySelector("form");
      if (form) form.submit();
    }).catch(() => {});

    await page.waitForTimeout(2000);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  // Probar acceso real a partner otra vez
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  console.log("URL after login -> target:", page.url());

  // Si no termina en partner, el login no quedó
  if (!page.url().includes("/partner/")) {
    const html = await page.locator("body").innerText().catch(() => "");
    console.log("LOGIN PAGE TEXT SAMPLE:", (html || "").slice(0, 1000));
    throw new Error(`Login no se completó. URL: ${page.url()}`);
  }
}

module.exports = { login };