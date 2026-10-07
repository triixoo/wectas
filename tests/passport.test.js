import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassport, verifyPassport, products, canonical } from '../dist/passport.js';

test('all demo passports survive JSON export and verify', async () => {
  for (const { product, events } of Object.values(products)) {
    const passport = await createPassport(product, events);
    const exported = JSON.parse(JSON.stringify(passport));
    assert.equal((await verifyPassport(exported)).valid, true);
    assert.equal(exported.records.length, 4);
    assert.equal(exported.network, null);
    assert.equal(exported.demo, true);
  }
});
test('event modification, header modification, and reordering are detected', async () => {
  const original = await createPassport(products.grain.product, products.grain.events);
  const changed = structuredClone(original); changed.records[0].event.location = 'Unknown';
  assert.deepEqual(await verifyPassport(changed), { valid: false, index: 0, reason: 'Целостность записи нарушена' });
  const header = structuredClone(original); header.product.origin = 'Unknown';
  assert.equal((await verifyPassport(header)).valid, false);
  const reordered = structuredClone(original); [reordered.records[0], reordered.records[1]] = [reordered.records[1], reordered.records[0]];
  assert.equal((await verifyPassport(reordered)).valid, false);
  assert.equal((await verifyPassport(original)).valid, true);
  const truncated = structuredClone(original); truncated.records.pop();
  assert.equal((await verifyPassport(truncated)).valid, false);
  truncated.eventCount = 3;
  assert.equal((await verifyPassport(truncated)).valid, false);
});
test('broken links and missing events are rejected', async () => {
  const passport = await createPassport(products.honey.product, products.honey.events);
  passport.records[2].previousHash = '0'.repeat(64);
  assert.equal((await verifyPassport(passport)).valid, false);
  assert.equal((await verifyPassport({})).valid, false);
  passport.records = [];
  assert.equal((await verifyPassport(passport)).valid, false);
});
test('canonical encoding makes hashes independent of object property order', async () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  const one = await createPassport(products.textile.product, products.textile.events);
  const two = await createPassport(Object.fromEntries(Object.entries(products.textile.product).reverse()), products.textile.events);
  assert.equal(one.records.at(-1).hash, two.records.at(-1).hash);
});
