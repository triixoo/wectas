import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPassport, verifyPassport, products } from '../dist/passport.js';
import { encodePassport, decodePassport, passportURL } from '../dist/share.js';
import qrcode from '../dist/vendor/qrcode.mjs';

test('compressed passport link roundtrips Cyrillic and verifies', async () => {
  const passport = await createPassport(products.honey.product, products.honey.events);
  const encoded = await encodePassport(passport);
  assert.match(encoded,/^[A-Za-z0-9_-]+$/);
  const decoded = await decodePassport(encoded);
  assert.deepEqual(decoded,passport);
  assert.equal((await verifyPassport(decoded)).valid,true);
  const url = passportURL(encoded,'https://triixoo.github.io/wectas/index.html');
  assert.equal(new URL(url).pathname,'/wectas/passport.html');
  const qr = qrcode(0,'L');qr.addData(url);qr.make();
  assert.match(qr.createSvgTag({cellSize:2,margin:8}),/^<svg/);
});
test('malformed, oversized and wrong-schema links fail clearly',async()=>{
  await assert.rejects(decodePassport('bad@link'));
  await assert.rejects(decodePassport('a'.repeat(20001)));
  await assert.rejects(decodePassport('abc'));
  await assert.rejects(encodePassport({format:'other'}));
});
test('user-created draft is still unanchored and tampering is rejected', async()=>{
  const draft = await createPassport(products.grain.product,[products.grain.events[0]],{demo:false});
  assert.equal(draft.demo,false);assert.equal(draft.network,null);
  assert.equal((await verifyPassport(draft)).valid,true);
  draft.records[0].event.actor = 'Другой производитель';
  assert.equal((await verifyPassport(draft)).valid,false);
});
