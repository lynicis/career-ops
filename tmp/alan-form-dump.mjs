import { chromium } from 'playwright';
import fs from 'node:fs';

const url = 'https://jobs.ashbyhq.com/alan/4c7e8e0a-0be9-47b8-b962-204a1360f11f/application';
const browser = await chromium.launch({ chromiumSandbox: true, headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
// scroll to render lazy content
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(300); }
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

const data = await page.evaluate(() => {
  const out = { title: document.title, url: location.href, fields: [], text: document.body.innerText };
  const labelFor = (el) => {
    if (el.labels && el.labels.length) return [...el.labels].map(l => l.innerText).join(' | ');
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    let p = el.closest('label');
    if (p) return p.innerText;
    // Ashby wraps: find nearest container with a label element
    const wrap = el.closest('[class*="field"], [class*="Field"], ._fieldEntry, form > div');
    if (wrap) {
      const lbl = wrap.querySelector('label, legend, [class*="label"]');
      if (lbl) return lbl.innerText;
    }
    return el.getAttribute('name') || el.getAttribute('placeholder') || null;
  };
  const nodes = document.querySelectorAll('input, textarea, select, [role="combobox"], [role="radiogroup"], button[type="submit"]');
  nodes.forEach((el, i) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    if (tag === 'input' && ['hidden', 'file'].includes(type)) {
      if (type === 'file') out.fields.push({ i, tag, type, label: labelFor(el), name: el.name, required: el.required });
      return;
    }
    const f = {
      i, tag, type: type || el.getAttribute('role') || null,
      label: labelFor(el),
      name: el.name || null,
      id: el.id || null,
      placeholder: el.getAttribute('placeholder'),
      required: el.required || el.getAttribute('aria-required') === 'true',
      value: (tag === 'select' || tag === 'input') ? el.value : null,
      checked: el.checked ?? null,
      maxlength: el.getAttribute('maxlength'),
      options: tag === 'select' ? [...el.options].map(o => o.text) : null,
    };
    out.fields.push(f);
  });
  return out;
});
fs.writeFileSync('tmp/alan-form-dump.json', JSON.stringify(data, null, 2));
await page.screenshot({ path: 'tmp/alan-form-top.png', fullPage: true });
console.log(JSON.stringify({ ok: true, fields: data.fields.length, title: data.title, url: data.url }));
await browser.close();
