function formatRangeDDMMYYYY(desdeISO, hastaISO) {
  const [y1, m1, d1] = desdeISO.split("-").map(Number);
  const [y2, m2, d2] = hastaISO.split("-").map(Number);

  const f1 = `${String(d1).padStart(2, "0")}.${String(m1).padStart(2, "0")}.${y1}`;
  const f2 = `${String(d2).padStart(2, "0")}.${String(m2).padStart(2, "0")}.${y2}`;
  return `${f1} - ${f2}`;
}

function formatMMDDYYYY(desdeISO, hastaISO) {
  // para plugins que usan MM/DD/YYYY internamente
  const [y1, m1, d1] = desdeISO.split("-").map(Number);
  const [y2, m2, d2] = hastaISO.split("-").map(Number);
  const a = `${String(m1).padStart(2, "0")}/${String(d1).padStart(2, "0")}/${y1}`;
  const b = `${String(m2).padStart(2, "0")}/${String(d2).padStart(2, "0")}/${y2}`;
  return { a, b };
}

async function setDateRange(page, desdeISO, hastaISO) {
  const rangeText = formatRangeDDMMYYYY(desdeISO, hastaISO);
  const { a: mmddStart, b: mmddEnd } = formatMMDDYYYY(desdeISO, hastaISO);

  // abrir datepicker
  await page.waitForSelector("#periodInput", { state: "visible", timeout: 15000 });
  await page.click("#periodInput");

  // Esperar que el daterangepicker aparezca
  const drp = page.locator(".daterangepicker");
  await drp.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});

  // 1) Intento 1 (MEJOR): si existe jQuery + plugin, setear start/end y apply
  // Esto actualiza estado interno del daterangepicker.
  const didSetByPlugin = await page.evaluate(({ desdeISO, hastaISO, rangeText }) => {
    try {
      const input = document.querySelector("#periodInput");
      if (!input) return false;

      // Si existe jQuery y el plugin está enganchado
      const $ = window.jQuery || window.$;
      if (!$) return false;

      const inst = $(input).data("daterangepicker");
      if (!inst) return false;

      // El plugin suele usar moment.js internamente
      // pero admite strings parseables o moment si existe.
      inst.setStartDate(rangeText.split(" - ")[0]);
      inst.setEndDate(rangeText.split(" - ")[1]);

      // Refrescar input y aplicar
      $(input).val(rangeText).trigger("change");
      inst.clickApply(); // aplica
      return true;
    } catch (e) {
      return false;
    }
  }, { desdeISO, hastaISO, rangeText });

  if (didSetByPlugin) return;

  // 2) Intento 2: setear inputs internos si existen (algunos skins los muestran)
  // (No siempre existen, pero si existen funciona muy bien)
  const leftInput = page.locator(".daterangepicker input[name='daterangepicker_start'], .daterangepicker .drp-calendar.left input[type='text']").first();
  const rightInput = page.locator(".daterangepicker input[name='daterangepicker_end'], .daterangepicker .drp-calendar.right input[type='text']").first();

  if (await leftInput.count().catch(() => 0)) {
    await leftInput.fill(mmddStart).catch(() => {});
  }
  if (await rightInput.count().catch(() => 0)) {
    await rightInput.fill(mmddEnd).catch(() => {});
  }

  // 3) Fallback: setear value del input (tu método original)
  await page.locator("#periodInput").evaluate((el, val) => {
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, rangeText);

  // 4) Click apply/OK/Enter
  const applyBtn = page.locator(".daterangepicker .applyBtn, .daterangepicker button.applyBtn");
  if (await applyBtn.count()) {
    await applyBtn.first().click();
    return;
  }

  const okBtn = page.getByRole("button", { name: /^ok$/i });
  if (await okBtn.count()) {
    await okBtn.click();
    return;
  }

  await page.keyboard.press("Enter");
}

module.exports = { setDateRange, formatRangeDDMMYYYY };
