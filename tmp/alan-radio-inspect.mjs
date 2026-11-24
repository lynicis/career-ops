import { chromium } from 'playwright';
const URL = 'https://jobs.ashbyhq.com/alan/4c7e8e0a-0be9-47b8-b962-204a1360f11f/application';
const browser = await chromium.launch({ chromiumSandbox: true, headless: false });
const page = await (await browser.newContext()).newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(200); }
const html = await page.evaluate(() => {
  const el = [...document.querySelectorAll('input[type="radio"]')];
  return el.slice(0, 4).map(r => ({ value: r.value, html: r.parentElement.parentElement.parentElement.outerHTML.slice(0, 1200) }));
});
console.log(JSON.stringify(html, null, 2));
await browser.close();
