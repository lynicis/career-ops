import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForeignOnsiteSupportFilter, buildLocationFilter } from '../scan.mjs';

const policy = { enabled: true };
const filter = buildForeignOnsiteSupportFilter(policy, 'Turkey');
const supported = {
  location: 'Berlin, Germany',
  workplaceType: 'onsite',
  description: 'We offer relocation assistance and visa sponsorship for this role.',
};

test('disabled or absent foreign-onsite policy preserves prior behavior', () => {
  for (const config of [undefined, {}, { enabled: false }]) {
    assert.equal(buildForeignOnsiteSupportFilter(config, 'Turkey')({ ...supported, description: '' }).eligible, true);
  }
});

test('local and foreign remote jobs bypass the foreign onsite support requirement', () => {
  assert.equal(filter({ ...supported, location: 'Istanbul, Turkey', description: '' }).eligible, true);
  assert.equal(filter({ ...supported, workplaceType: 'remote', description: '' }).eligible, true);
  assert.equal(filter({ ...supported, workplaceType: undefined, location: 'Remote - Germany', title: 'Senior Engineer - Remote', description: '' }).eligible, true);
});

test('location filter uses positional location when offer objects omit it', () => {
  const locationFilter = buildLocationFilter({ foreign_onsite_support: policy }, 'Turkey');
  assert.equal(locationFilter('Istanbul, Turkey', '', 'Engineer'), true);
  assert.equal(locationFilter('Istanbul, Turkey', '', 'Engineer', { description: '' }), true);
});

test('foreign onsite job passes only when relocation and sponsorship are explicit', () => {
  assert.equal(filter(supported).eligible, true);
  assert.equal(filter({ ...supported, description: 'Visa sponsorship is offered.' }).eligible, false);
  assert.equal(filter({ ...supported, description: 'Relocation assistance is provided.' }).eligible, false);
});

test('explicit refusals win over positive relocation and sponsorship wording', () => {
  assert.equal(filter({ ...supported, description: 'Relocation assistance is available, but no relocation is offered. Visa sponsorship is available.' }).eligible, false);
  assert.equal(filter({ ...supported, description: 'Relocation assistance is available. Visa sponsorship is available, but sponsorship is not offered for this position.' }).eligible, false);
  assert.equal(filter({ ...supported, description: 'Relocation assistance is not provided. We offer visa sponsorship.' }).eligible, false);
  assert.equal(filter({ ...supported, description: 'We do not provide a relocation package. Visa sponsorship is available.' }).eligible, false);
  assert.equal(filter({ ...supported, description: 'Relocation support is not offered. Visa sponsorship is available.' }).eligible, false);
  assert.equal(filter({ ...supported, description: "Relocation assistance isn't included for this role. Visa sponsorship is offered." }).eligible, false);
});

test('foreign jobs with missing support evidence or unknown work mode fail closed', () => {
  for (const offer of [
    { ...supported, description: '' },
    { ...supported, location: '' },
    { ...supported, workplaceType: 'unspecified' },
    { ...supported, visaText: 'visa sponsorship', description: '' },
  ]) assert.equal(filter(offer).eligible, false, JSON.stringify(offer));
});

test('location filter reports foreign-on-site rejection without changing boolean API', () => {
  const locationFilter = buildLocationFilter({ foreign_onsite_support: policy }, 'Turkey');
  const offer = { ...supported, description: '' };
  assert.equal(locationFilter(offer.location, '', offer.title, offer), false);
  assert.equal(locationFilter.foreignOnsiteSupport(offer).reason, 'missing_relocation_support');
});
