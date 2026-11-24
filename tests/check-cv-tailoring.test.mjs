// tests/check-cv-tailoring.test.mjs — the tailored-CV summary audit.
//
// check-cv-tailoring.mjs is read-only and soft: it judges only report-numbered
// tailored CVs, against the framing their own report asked for, and never exits
// non-zero for a finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCvTailoring, summaryBucket, bucketsMentioned } from '../check-cv-tailoring.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const summaryHtml = (text) =>
  `<div class="section"><div class="section-title">Professional Summary</div><div class="summary-text">${text}</div></div>`;

function withTree(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-check-tailoring-'));
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
      '',
      'text',
    ].join('\n'));
    writeFileSync(join(dir, 'reports', '002-backend-co-2026-11-01.md'), [
      '# Evaluation',
      '',
      '**Archetype:** Backend & Distributed Systems Engineer',
      '',
      '## Job Description',
      '',
      'text',
    ].join('\n'));
    writeFileSync(join(dir, 'reports', '003-hybrid-co-2026-11-01.md'), [
      '# Evaluation',
      '',
      '**Archetype:** Backend & Distributed Systems Engineer / Full-Stack Engineer',
      '',
    ].join('\n'));
    return fn(join(dir, 'output'), join(dir, 'reports'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('summary bucketing reads the opening framing, not keywords further down', () => {
  assert.equal(summaryBucket('Distributed Systems Software Engineer with 5+ years'), 'backend');
  assert.equal(summaryBucket('Product-minded Software Developer with 5+ years'), 'fullstack');
  assert.equal(summaryBucket('Senior Full-Stack Product Engineer'), 'fullstack');
  assert.equal(summaryBucket('Cloud & Edge Infrastructure Engineer'), 'infra');
  // cv.md's own product summary mentions distributed systems in its second clause.
  assert.equal(
    summaryBucket('Product-minded engineer with 5+ years — TypeScript on the product side; Go services and Terraform on the infrastructure side.'),
    'fullstack',
  );
  assert.equal(summaryBucket('Wrote software for a decade'), null);
});

test('a report accepts any framing it names', () => {
  assert.deepEqual([...bucketsMentioned('Backend & Distributed Systems Engineer / Full-Stack Engineer')].sort(), ['backend', 'fullstack']);
  assert.deepEqual([...bucketsMentioned('Full-Stack Engineer / Founding Engineer')], ['fullstack']);
});

test('flags a summary that contradicts Section E row 1', () => {
  withTree((out, rep) => {
    writeFileSync(join(out, 'cv-alice-001-product-co.html'),
      summaryHtml('Distributed Systems Software Engineer with 5+ years scaling platforms.'));
    const r = checkCvTailoring(out, rep);
    assert.equal(r.checked, 1);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].file, 'cv-alice-001-product-co.html');
    assert.equal(r.findings[0].code, 'summary-mismatch');
    assert.match(r.findings[0].message, /report 001 asks for Full-Stack\/Product \(Section E row 1\)/);
  });
});

test('passes a matching summary, a hybrid report, and a legacy name with no report', () => {
  withTree((out, rep) => {
    writeFileSync(join(out, 'cv-alice-001-product-co.html'),
      summaryHtml('Product-minded Software Developer with 5+ years shipping end-to-end SaaS.'));
    writeFileSync(join(out, 'cv-alice-002-backend-co.html'),
      summaryHtml('Distributed Systems Software Engineer with 5+ years scaling platforms.'));
    writeFileSync(join(out, 'cv-alice-003-hybrid-co.html'),
      summaryHtml('Product-minded Software Developer with 5+ years shipping end-to-end SaaS.'));
    writeFileSync(join(out, 'cv-alice-legacy.html'),
      summaryHtml('Distributed Systems Software Engineer with 5+ years.'));
    const r = checkCvTailoring(out, rep);
    assert.equal(r.checked, 3);
    assert.deepEqual(r.findings, []);
  });
});

test('the styled render is judged when an -ats copy was written later', () => {
  withTree((out, rep) => {
    writeFileSync(join(out, 'cv-alice-001-product-co.html'),
      summaryHtml('Distributed Systems Software Engineer with 5+ years scaling platforms.'));
    writeFileSync(join(out, 'cv-alice-001-product-co-ats.html'),
      summaryHtml('Product-minded Software Developer with 5+ years shipping end-to-end SaaS.'));
    const r = checkCvTailoring(out, rep);
    assert.equal(r.checked, 1);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].file, 'cv-alice-001-product-co.html');
    assert.equal(checkCvTailoring(out, rep, { all: true }).checked, 2);
  });
});

test('CLI is soft and machine-readable', () => {
  const res = spawnSync(process.execPath, ['check-cv-tailoring.mjs', '--summary'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /^cv tailoring: /);
});
