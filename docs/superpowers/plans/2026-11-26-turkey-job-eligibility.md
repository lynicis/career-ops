# Turkey-Based Job Eligibility Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter foreign on-site/hybrid postings unless their text explicitly offers both relocation and visa sponsorship, without changing remote-role eligibility or liveness results.

**Architecture:** Extend the existing `location_filter` pipeline with an opt-in `foreign_onsite_support` policy. Build it into `buildLocationFilter` so the CLI scanner, shared admission gate, Dayforce and full-ATS paths use the same decision. Reuse the candidate's `location.country` and existing visa phrase logic; report unsupported foreign on-site postings distinctly in scan summaries.

**Tech Stack:** Node.js ES modules, YAML, `node:test`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-turkey-job-eligibility-design.md`

## Global Constraints

- No changes to generic expired/active detection.
- No application submission or automated application action.
- No new external service/dependency.
- Eligibility policy is opt-in and configurable for other users.
- Remote roles keep their existing eligibility behavior.
- Foreign on-site/hybrid roles require explicit evidence of both relocation and visa sponsorship; missing or unclear evidence fails closed.
- Do not add authenticated LinkedIn access to the core scanner; LinkedIn MCP is an interactive source only.

## Review Focus

- Explicit sponsorship refusal alongside positive wording must reject; test refusal-first precedence.
- Relocation without sponsorship and sponsorship without relocation must each reject; test each one-sided case.
- A recognized remote job abroad must pass this new gate unchanged; test remote mode with foreign location.
- A foreign posting with missing/unknown work-mode or support text must fail closed; test missing fields and an unknown mode.
- The opt-in being absent/false must preserve prior decisions; test disabled and absent config.

---

### Task 1: Add the opt-in foreign on-site support policy

**Files:**
- Modify: `scan.mjs` — policy builder, `buildLocationFilter` integration, and the existing filtered-location summary/JSON counters.
- Modify: `validate-portals.mjs` — validate the new nested filter shape before network access.
- Modify: `templates/portals.example.yml` — document the opt-in setting and its defaults.
- Modify: `docs/WORKPLACE_GEOGRAPHY.md` — document the relocation/sponsorship exception and its conservative limits.
- Test: `tests/scan-foreign-onsite-support.test.mjs`
- Test: `tests/validate-portals-foreign-onsite-support.test.mjs`

**Interfaces:**
- `buildForeignOnsiteSupportFilter(config, candidateCountry)` returns a function `(offer) => { eligible: boolean, reason: string }`. It uses the existing `buildVisaFilter({ require_mention: true })` defaults for sponsorship-only matching.
- Config is `location_filter.foreign_onsite_support: { enabled: true, relocation_positive?: string[], relocation_negative?: string[] }`. Omitted/false config is a no-op. Default relocation positives: `relocation assistance`, `relocation support`, `relocation package`, `relocation provided`, `relocation available`, `assistance with relocation`, `support with relocation`. Default negatives include `no relocation`, `without relocation`, `relocation is not offered`, `relocation is not available`, and `relocation will not be provided`; negatives win. Sponsorship uses the existing visa vocabulary and refusal precedence, forced to require an explicit positive mention only for this gate.
- Recognized remote offers bypass this new gate. Recognized on-site/hybrid offers outside the candidate country pass only if both support checks pass. Foreign location with unknown work mode is treated conservatively as on-site; insufficient support text rejects.
- Expose the filter reason to `buildLocationFilter` callers without changing its boolean return contract. Main scan reports a separate foreign-on-site support rejection count; other admission paths retain their existing location-rejection behavior.

- [ ] **Step 1: Add failing unit cases** for disabled/absent config, local role, remote foreign role, both support statements, each missing support statement, visa refusal, relocation refusal, missing location/text, and unknown work mode in `tests/scan-foreign-onsite-support.test.mjs`.
- [ ] **Step 2: Run the new test file** with `node --test tests/scan-foreign-onsite-support.test.mjs`; confirm the targeted tests fail before implementation.
- [ ] **Step 3: Implement the policy builder and shared location-filter wiring** in `scan.mjs`, using `location.country` from the existing profile loader and the existing visa matcher with `require_mention: true` for this gate only.
- [ ] **Step 4: Add failing validation cases** for non-object config, non-boolean `enabled`, malformed relocation keyword lists, and valid opt-in config in `tests/validate-portals-foreign-onsite-support.test.mjs`.
- [ ] **Step 5: Run the validation test file** with `node --test tests/validate-portals-foreign-onsite-support.test.mjs`; confirm it fails on the unimplemented validation behavior.
- [ ] **Step 6: Validate the new config shape** in `validate-portals.mjs`; document defaults, fail-closed behavior and remote exception in the template and workplace-geography guide.
- [ ] **Step 7: Run focused checks**: `node --test tests/scan-foreign-onsite-support.test.mjs tests/validate-portals-foreign-onsite-support.test.mjs` and `node validate-portals.mjs --file templates/portals.example.yml`.

### Task 2: Apply the approved policy to the user's profile and portals

**Files:**
- Modify: `config/profile.yml` — state Turkey-only work authorization and sponsorship required outside Turkey.
- Modify: `portals.yml` — enable the new policy for this user's scans and configure relocation wording if needed.

**Interfaces:**
- `location.country` remains `Turkey`; `location.authorized_in` remains Turkey-only.
- Set `location.needs_sponsorship: true`; do not infer citizenship or change remote-role policy.
- Enable `location_filter.foreign_onsite_support` without adding a general location allow/block list.

- [ ] **Step 1: Enable the opt-in policy** in the active `portals.yml` while leaving existing location/remote rules unchanged.
- [ ] **Step 2: Correct the profile authorization flag** to require sponsorship outside Turkey, preserving the already configured Turkey-only authorization.
- [ ] **Step 3: Run the user's portal config validator** with `node validate-portals.mjs` and the focused scanner tests from Task 1.

## Execution Order

Task 1 must pass before Task 2 enables the filter, so malformed or incomplete implementation cannot silently alter the user's scan results. Liveness tests and code are intentionally untouched.
