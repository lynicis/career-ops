import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = 'https://jobs.ashbyhq.com/alan/4c7e8e0a-0be9-47b8-b962-204a1360f11f/application';
const CV = '/Users/lynicis/Projects/career-ops/output/276-alan-cv-ismail-emre-sirmali-2026-11-24.pdf';

const ANSWERS = {
  'First name': 'İsmail Emre',
  'Last name': 'Sırmalı',
  'Email': 'lynicis@protonmail.com',
  'Current location': 'Istanbul, Turkey',
  'Phone': '+90 530 783 3831',
  'LinkedIn': 'linkedin.com/in/emresirmali',
  'GitHub': 'github.com/lynicis',
  'Portfolio': 'https://lynicis.dev',
  'If you selected "Employee Referral" or "Other", could you please specify?': 'Remotive',
  'Additional information': "I answered \"no\" to the France work-authorization question: I am based in Istanbul and would need a French work permit. I am willing to relocate to Paris if the role supports it, and I would like to understand which entity would employ the role.",
  'We want team members who are passionate about our mission. If you’re excited about helping people live healthier and longer lives, tell us about a moment or experience that sparked your interest in healthcare.':
`I don't have a clinical background, so what draws me to healthcare is the cost of being wrong. Building Vorinfo, an AI assessment platform for students, taught me that a model which is 90% right in a demo and 90% right in production are different products. Students acted on the output, and a wrong answer had a real consequence, which pushed me toward evaluation, guardrails and human-in-the-loop design instead of impressive demos.

Healthcare is the hardest version of that problem: the stakes are higher, the data is messier, and the product has to earn trust from people who are not thinking about software at all. Mo interests me because it is not a chatbot bolted onto a website. It runs inside an insurer at real scale, so the hard engineering sits in safety, triage, and handing off to a human when the model is uncertain. That is the kind of problem I want to spend the next few years on.`,
  'Describe a specific project that you’re proud of where you had an impact across the stack. What made this project particularly meaningful or challenging for you as a full-stack developer?':
`Vorinfo, the AI-powered EdTech SaaS I built from zero to production in four months as its sole technical founder. I owned the whole stack: data modelling, a TypeScript/Node.js backend (Fastify, ConnectRPC), a Nuxt.js front end, a LangChain pipeline that generated assessments from source material, and the AWS infrastructure plus CI/CD that shipped it multiple times a day.

What made it hard was not any single layer. The LLM layer had to produce structured, gradable questions a teacher could use without rewriting them, which meant designing orchestration, validation and retries around the model instead of trusting a prompt. The product layer had to keep editing fast, because the real constraint was a teacher's time, and quiz creation ended up about 70% faster. The infrastructure had to stay boring enough that one person could operate it while also talking to users.

Building alone forces you to make every trade-off yourself and then live with it in production, which is exactly the part I want more of.`,
};

const RADIOS = [
  { question: 'Are you currently able to legally work for any employer in France', answer: 'No' },
  { question: 'If you join us, would you work from Paris?', answer: 'Yes' },
  { question: 'Do you have a minimum of 3 years of experience as a Software Engineer?', answer: 'Yes' },
];
const SOURCE = 'Other';

const browser = await chromium.launch({ chromiumSandbox: true, headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(250); }
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

const fieldContainer = (text) => page.locator('[class*="fieldEntry"], [data-field-entry]').filter({ hasText: text }).first();

async function fillField(labelText, value) {
  const container = fieldContainer(labelText);
  let target;
  if (await container.count()) {
    target = container.locator('textarea, input[type="text"], input[type="email"], input[type="tel"]').first();
  } else {
    target = page.getByLabel(labelText, { exact: true }).first();
  }
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await target.fill('');
  await target.pressSequentially(value, { delay: 3 });
  return target;
}

const results = [];
for (const [label, value] of Object.entries(ANSWERS)) {
  try {
    const t = await fillField(label, value);
    const got = await t.inputValue();
    results.push({ label, ok: got === value, got: got.slice(0, 60) });
  } catch (e) {
    results.push({ label, ok: false, error: e.message.split('\n')[0] });
  }
}

// File upload
try {
  const fileInput = page.locator('input[type="file"][required]').first();
  await fileInput.setInputFiles(CV);
  await page.waitForTimeout(1500);
  results.push({ label: 'Resume upload', ok: true });
} catch (e) {
  results.push({ label: 'Resume upload', ok: false, error: e.message.split('\n')[0] });
}

// Source of application radio
try {
  const srcBox = fieldContainer('How did you hear about opportunities at Alan');
  const radio = srcBox.locator(`label:has-text("${SOURCE}")`).first();
  await radio.scrollIntoViewIfNeeded();
  await radio.click();
  await page.waitForTimeout(400);
  const checked = await srcBox.locator('input[type="radio"]:checked').count();
  results.push({ label: `Source: ${SOURCE}`, ok: checked === 1 });
} catch (e) {
  results.push({ label: `Source: ${SOURCE}`, ok: false, error: e.message.split('\n')[0] });
}

// Knock-out + experience radios
const pick = async (box, answer) => {
  const opt = box.locator('div[class*="_option_"]').filter({ hasText: new RegExp(`^\\s*${answer}\\s*$`) }).first();
  await opt.scrollIntoViewIfNeeded();
  const input = opt.locator('input[type="radio"]');
  await input.check({ force: true });
  await page.waitForTimeout(300);
  if (!(await input.isChecked())) throw new Error('radio did not register');
  return opt.innerText();
};
for (const { question, answer } of RADIOS) {
  try {
    const box = page.locator('fieldset[class*="radio-group"]').filter({ hasText: question }).first();
    const got = await pick(box, answer);
    results.push({ label: question, ok: true, got: got.trim() });
  } catch (e) {
    results.push({ label: question, ok: false, error: e.message.split('\n')[0] });
  }
}

await page.screenshot({ path: 'tmp/alan-form-filled.png', fullPage: true });

// Required-field readback
const sweep = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    const t = el.type;
    if (['hidden', 'file', 'submit', 'button'].includes(t)) return;
    const req = el.required || el.getAttribute('aria-required') === 'true';
    const empty = t === 'radio' ? false : !el.value.trim();
    if (req && empty) out.push({ name: el.name || el.id, type: t, reason: 'empty' });
  });
  const groups = {};
  document.querySelectorAll('fieldset[class*="radio-group"]').forEach((fs) => {
    const q = fs.querySelector('label')?.innerText.trim();
    const picked = [...fs.querySelectorAll('input[type="radio"]:checked')].map((r) => r.closest('div[class*="_option_"]')?.innerText.trim());
    if (q) groups[q] = picked;
  });
  return { missing: out, groups };
});

fs.writeFileSync('tmp/alan-fill-report.json', JSON.stringify({ results, sweep }, null, 2));
console.log(JSON.stringify({ results, sweep }, null, 2));
console.log('READY_FOR_REVIEW');
if (process.env.HOLD === '1') {
  await page.waitForTimeout(45 * 60 * 1000);
} else {
  await page.waitForTimeout(1500);
}
await browser.close();
