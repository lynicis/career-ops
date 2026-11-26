import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePortalsConfig } from '../validate-portals.mjs';

const errorsFor = async (policy) => (await validatePortalsConfig({
  location_filter: { foreign_onsite_support: policy },
})).errors;

test('valid foreign-onsite support configuration is accepted', async () => {
  assert.deepEqual(await errorsFor({ enabled: true }), []);
  assert.deepEqual(await errorsFor({ enabled: true, relocation_positive: ['relocation assistance'], relocation_negative: ['no relocation'] }), []);
});

test('foreign-onsite support config must be an object with boolean enabled', async () => {
  assert.ok((await errorsFor('yes')).some(error => error.path === 'location_filter.foreign_onsite_support'));
  assert.ok((await errorsFor({ enabled: 'yes' })).some(error => error.path === 'location_filter.foreign_onsite_support.enabled'));
});

test('relocation keyword overrides must be lists of non-empty strings', async () => {
  for (const [key, value] of [['relocation_positive', 'relocation'], ['relocation_negative', [42]]]) {
    assert.ok((await errorsFor({ enabled: true, [key]: value })).some(error => error.path.startsWith(`location_filter.foreign_onsite_support.${key}`)), key);
  }
});
