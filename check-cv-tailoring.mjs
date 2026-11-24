#!/usr/bin/env node
/**
 * check-cv-tailoring.mjs — read-only audit that a tailored CV's Professional
 * Summary matches the framing its own evaluation report asked for.
 *
 * A tailored CV's summary is written at render time (modes/pdf.md), so it can
 * drift from the plan the report wrote for it. Report 205 asked Section E row 1
 * for a "Senior Full-Stack Product Engineer" frame; the shipped PDF opened with
 * "Distributed Systems Software Engineer … high-throughput Go microservices" —
 * the opposite signal for a product-engineering role. Nothing in the pipeline
 * compared the two, so the mismatch shipped silently.
 *
 * Zero-LLM, zero-network, never writes. Soft: findings never change the exit
 * code (the same convention as check-output-names.mjs).
 *
 * What is judged: an `output/*.html` tailored CV that names a report number,
 * against that report's Section E row 1 "Proposed change" (falling back to the
 * report's `**Archetype:**` when Section E is absent or empty). Legacy artifact
 * names with no report number, and reports with no Section E or archetype, are
 * ignored rather than guessed at.
 *
 * Findings:
 *   summary-mismatch  the summary opens in one archetype, the report asks for another
 *
 * Usage:
 *   node check-cv-tailoring.mjs [--json] [--summary] [--all] [--self-test]
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainModule } from './lib/is-main-module.mjs';

// Only the newest CV per report is judged by default: an older render is a
// superseded artifact, and warning about it every run is noise. `--all` audits
// the history too, which is how a tailoring regression is found after the fact.
const SUMMARY_HTML = /class="summary-text"[^>]*>([\s\S]*?)<\/div>/i;
// A CV copy rendered from the same payload: `-ats` (paste-ready) or `-canva`.
const VARIANT_SUFFIX = /-(?:ats|canva)\.html$/i;

// The summary's own opening noun phrase. Lead-first on purpose: cv.md's
// product-minded summary also mentions distributed systems further down, so a
// keyword bag would classify it as backend.
const LEAD_BUCKETS = [
  ['fullstack', /^(?:senior\s+)?(?:full[- ]?stack|product[- ]?minded|product engineer|founding)/i],
  ['backend', /^(?:senior\s+)?(?:distributed|back[- ]?end)/i],
  ['infra', /^(?:senior\s+)?(?:cloud|infrastructure|platform|site reliability|sre|devops)/i],
  ['ai', /^(?:senior\s+)?(?:applied ai|machine learning|ml engineer|ai engineer|llm)/i],
  ['mobile', /^(?:senior\s+)?(?:mobile|ios|android)/i],
  ['data', /^(?:senior\s+)?(?:data engineer|analytics engineer|data platform)/i],
];

// What a report's framing text asks for. Any bucket it mentions is acceptable,
// because a report can name a hybrid ("Backend & Distributed Systems Engineer /
// Full-Stack Engineer") and either framing is then honest.
const MENTION_BUCKETS = [
  ['fullstack', /\b(full[- ]?stack|product engineer|product-minded|founding engineer)\b/i],
  ['backend', /\b(distributed systems|back[- ]?end)\b/i],
  ['infra', /\b(cloud|infrastructure|platform reliability|sre|devops)\b/i],
  ['ai', /\b(applied ai|machine learning|ml engineer|ai engineer)\b/i],
  ['mobile', /\b(mobile|ios|android)\b/i],
  ['data', /\b(data engineer|analytics engineer)\b/i],
];

const LABELS = {
  fullstack: 'Full-Stack/Product',
  backend: 'Backend/Distributed',
  infra: 'Cloud/Infrastructure',
  ai: 'AI/ML',
  mobile: 'Mobile',
  data: 'Data',
};

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** The archetype a summary opens in, or null when it does not announce one. */
export function summaryBucket(summaryText) {
  const lead = String(summaryText || '').replace(/^[\s"'`]+/, '');
  for (const [bucket, re] of LEAD_BUCKETS) if (re.test(lead)) return bucket;
  return null;
}

/** Every archetype a report's framing text names. */
export function bucketsMentioned(text) {
  const s = String(text || '');
  const found = new Set();
  for (const [bucket, re] of MENTION_BUCKETS) if (re.test(s)) found.add(bucket);
  return found;
}

/** The Section E row 1 "Proposed change" cell, or '' when the report has none. */
function sectionEFraming(src) {
  const eMatch = /^##\s*E\)/m.exec(src);
  if (!eMatch) return '';
  const rest = src.slice(eMatch.index + eMatch[0].length);
  const nextHeading = /^##\s/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const row = /^\|\s*1\s*\|.*$/m.exec(section);
  if (!row) return '';
  const cells = row[0].split('|');
  return (cells[4] || '').trim();
}

/** The report file for one number, plus the framing it asks the summary to carry. */
export function readReportFraming(reportsDir, reportNumber) {
  if (!existsSync(reportsDir)) return null;
  const file = readdirSync(reportsDir).find((f) => new RegExp(`^${reportNumber}-`).test(f));
  if (!file) return null;
  const src = readFileSync(join(reportsDir, file), 'utf8');
  const archetype = /^\*\*Archetype:\*\*\s*(.+)$/m.exec(src)?.[1].trim() || '';
  return { file, archetype, sectionE: sectionEFraming(src) };
}

/**
 * The report number an artifact filename claims, or null. Only a 3-digit token
 * that actually has a report is accepted, which keeps a date (4 digits) and a
 * legacy name with no report number out of the judgement.
 */
function reportNumberFor(file, reportsDir) {
  if (!existsSync(reportsDir)) return null;
  const reports = new Set(readdirSync(reportsDir).map((f) => /^(\d{3})-/.exec(f)?.[1]).filter(Boolean));
  const hits = new Set([...file.matchAll(/(?:^|[-_])(\d{3})(?=[-_.])/g)].map((m) => m[1]));
  const known = [...hits].filter((n) => reports.has(n));
  return known.length === 1 ? known[0] : null;
}

/**
 * @param {string} outputDir  Absolute path to `output/`.
 * @param {string} reportsDir Absolute path to `reports/`.
 * @param {{all?: boolean}} [options]
 * @returns {{checked: number, findings: {file: string, report: string, code: string, summary: string, message: string}[]}}
 */
export function checkCvTailoring(outputDir, reportsDir, { all = false } = {}) {
  const findings = [];
  if (!existsSync(outputDir)) return { checked: 0, findings };

  const candidates = [];
  for (const file of readdirSync(outputDir).sort()) {
    if (!file.endsWith('.html')) continue;
    const report = reportNumberFor(file, reportsDir);
    if (!report) continue;
    const path = join(outputDir, file);
    candidates.push({ file, report, mtimeMs: statSync(path).mtimeMs, path });
  }

  // One representative per report by default: the styled render when there is
  // one, otherwise the newest variant. An `-ats`/`-canva` copy is rendered from
  // the same payload and would otherwise shadow the styled CV purely because it
  // was written second.
  const judged = all ? candidates : (() => {
    const picked = new Map();
    for (const c of candidates) {
      const prev = picked.get(c.report);
      if (!prev) { picked.set(c.report, c); continue; }
      const cStyled = !VARIANT_SUFFIX.test(c.file);
      const prevStyled = !VARIANT_SUFFIX.test(prev.file);
      if (cStyled !== prevStyled) { if (cStyled) picked.set(c.report, c); continue; }
      if (c.mtimeMs > prev.mtimeMs) picked.set(c.report, c);
    }
    return [...picked.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
  })();

  for (const c of judged) {
    const framing = readReportFraming(reportsDir, c.report);
    if (!framing) continue;
    const html = readFileSync(c.path, 'utf8');
    const rawSummary = SUMMARY_HTML.exec(html)?.[1];
    if (!rawSummary) continue;
    const summary = htmlToText(rawSummary);
    const actual = summaryBucket(summary);
    if (!actual) continue;
    let expected = bucketsMentioned(framing.sectionE);
    const fromSectionE = expected.size > 0;
    if (!fromSectionE) expected = bucketsMentioned(framing.archetype);
    if (expected.size === 0) continue;
    if (expected.has(actual)) continue;
    const asked = [...expected].map((b) => LABELS[b] || b).join(' / ');
    findings.push({
      file: c.file,
      report: c.report,
      code: 'summary-mismatch',
      summary: `${summary.slice(0, 90)}${summary.length > 90 ? '…' : ''}`,
      message: `summary opens as ${LABELS[actual] || actual}, but report ${c.report} asks for ${asked}` +
        (fromSectionE ? ' (Section E row 1)' : ` (Archetype: ${framing.archetype})`),
    });
  }

  return { checked: judged.length, findings };
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-check-cv-tailoring-'));
  let failed = 0;
  const expect = (cond, label) => {
    if (!cond) { failed++; console.error(`FAIL ${label}`); }
  };
  const cv = (summary) => `<div class="section"><div class="section-title">Professional Summary</div><div class="summary-text">${summary}</div></div>`;
  try {
    mkdirSync(join(dir, 'reports'));
    mkdirSync(join(dir, 'output'));
    writeFileSync(join(dir, 'reports', '001-product-co-2026-11-01.md'), [
      '# Evaluation',
      '',
      '**Archetype:** Full-Stack Engineer',
      '',
      '## E) Personalization Plan',
      '',
      '| # | Section | Current state | Proposed change | Why |',
      '|---|---|---|---|---|',
      '| 1 | Professional Title & Summary | Full-Stack Developer | Frame as `Senior Full-Stack Product Engineer` highlighting end-to-end ownership | Mirrors the role |',
      '',
      '## Job Description',
    ].join('\n'));
    writeFileSync(join(dir, 'reports', '002-backend-co-2026-11-01.md'), [
      '# Evaluation',
      '',
      '**Archetype:** Backend & Distributed Systems Engineer',
      '',
      '## Job Description',
    ].join('\n'));
    writeFileSync(join(dir, 'reports', '003-hybrid-co-2026-11-01.md'), [
      '# Evaluation',
      '',
      '**Archetype:** Backend & Distributed Systems Engineer / Full-Stack Engineer',
      '',
    ].join('\n'));

    writeFileSync(join(dir, 'output', 'cv-alice-001-product-co.html'),
      cv('Distributed Systems Software Engineer with 5+ years scaling high-concurrency platforms.'));
    writeFileSync(join(dir, 'output', 'cv-alice-002-backend-co.html'),
      cv('Distributed Systems Software Engineer with 5+ years scaling high-concurrency platforms.'));
    writeFileSync(join(dir, 'output', 'cv-alice-003-hybrid-co.html'),
      cv('Product-minded Software Developer with 5+ years shipping end-to-end SaaS.'));
    writeFileSync(join(dir, 'output', 'cv-alice-004-legacy-no-report.html'),
      cv('Distributed Systems Software Engineer with 5+ years.'));
    writeFileSync(join(dir, 'output', 'cv-alice-001-product-co-ats.html'),
      cv('Product-minded Software Developer with 5+ years shipping end-to-end SaaS.'));

    const r = checkCvTailoring(join(dir, 'output'), join(dir, 'reports'));
    expect(r.checked === 3, `checked=${r.checked}`);
    expect(r.findings.length === 1, `findings=${r.findings.length}`);
    expect(r.findings[0]?.file === 'cv-alice-001-product-co.html', 'flags the product report');
    expect(r.findings[0]?.summary.startsWith('Distributed Systems'), 'carries the summary excerpt');

    const all = checkCvTailoring(join(dir, 'output'), join(dir, 'reports'), { all: true });
    expect(all.checked === 4, `all checked=${all.checked}`);
    expect(all.findings.length === 1, `all findings=${all.findings.length}`);
    expect(checkCvTailoring(join(dir, 'missing'), join(dir, 'reports')).checked === 0, 'missing output dir');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed) { console.error(`${failed} self-test check(s) failed`); process.exit(1); }
  console.log('check-cv-tailoring self-test: ok');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const { getCareerOpsRoot } = await import('./path-resolver.mjs');
  const root = getCareerOpsRoot();
  const result = checkCvTailoring(join(root, 'output'), join(root, 'reports'), { all: args.includes('--all') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.findings.length === 0) {
    console.log(`cv tailoring: ${result.checked} report-numbered CV(s), summaries match their reports`);
    return;
  }
  const lines = args.includes('--summary')
    ? []
    : result.findings.map((f) => `  ${f.code}: ${f.file} — ${f.message}`);
  console.log(`cv tailoring: ${result.findings.length} of ${result.checked} report-numbered CV(s) need attention`);
  for (const l of lines) console.log(l);
}

const USAGE = `Usage:
  node check-cv-tailoring.mjs [--json] [--summary] [--all] [--self-test]

  --json        machine-readable findings
  --summary     counts only, no per-file lines
  --all         judge every CV, not only the newest render per report
  --self-test   run the built-in checks
  --help, -h    print this and exit`;

if (isMainModule(import.meta.url)) {
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  await main();
}
