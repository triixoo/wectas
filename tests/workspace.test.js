import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, unlockIdentity, encryptJSON, decryptJSON, validProfile } from '../dist/identity.js';
import { createV2, appendEvent } from '../dist/passport-v2.js';
import { verifyPassport, hasValidSchema } from '../dist/passport.js';
import { encodePassport, decodePassport, passportURL } from '../dist/share.js';
import { sha256, hashBytes, hex } from '../dist/core.js';
import { prepareDocument, validateBackup } from '../dist/storage.js';
import { sendAnchor, verifyAnchor, anchorData, CHAIN_ID } from '../dist/anchor.js';
import { pilotMessage, telegramDraft } from '../dist/contact.js';

const product = { name: 'Тестовый мёд', batch: 'TEST-001', origin: 'Казахстан', category: 'Мёд' };
const event = { title: 'Создана партия', actor: 'Тестовый производитель', location: 'Алматы', date: '2026-10-07', role: 'Производитель', type: 'Создание партии', documents: [] };
const password = 'test-only-password-123';
const identity = await createIdentity(event.actor, password);
const original = await createV2(product, event, identity);

test('participant signatures survive handoff and append without rewriting signed history', async () => {
  const buyer = await createIdentity('Тестовый покупатель', password);
  const received = JSON.parse(JSON.stringify(original));
  const next = await appendEvent(received, { ...event, title: 'Получена партия', actor: buyer.profile.name, role: 'Покупатель', type: 'Приёмка' }, buyer);
  assert.deepEqual(next.records[0], original.records[0]);
  assert.equal((await verifyPassport(next)).signedCount, 2);
  assert.equal(next.id, original.id);
  assert.equal(original.records.length, 1);
  assert.equal(JSON.stringify(next).includes('encrypted'), false);
});

test('fully recomputed altered chain cannot reuse participant signatures', async () => {
  const changed = structuredClone(original); changed.product.origin = 'Другое происхождение';
  const record = changed.records[0];
  record.hash = await sha256({ format: changed.format, id: changed.id, demo: changed.demo, network: changed.network, product: changed.product,
    index: record.index, event: record.event, previousHash: record.previousHash, signer: record.signer });
  assert.match((await verifyPassport(changed)).reason, /Подпись/);
  const transplanted = structuredClone(original); transplanted.id = crypto.randomUUID();
  assert.equal((await verifyPassport(transplanted)).valid, false);
  const signature = structuredClone(original); signature.records[0].signature = '00'.repeat(64);
  assert.equal((await verifyPassport(signature)).valid, false);
});

test('invalid dates, earlier events, wrong roles, repeated documents and broken schemas are rejected', async () => {
  await assert.rejects(createV2(product, { ...event, date: '2026-02-30' }));
  await assert.rejects(appendEvent(original, { ...event, date: '2026-10-06' }));
  await assert.rejects(appendEvent(original, { ...event, role: 'Admin' }));
  const reference = { sha256: 'a'.repeat(64), type: 'Сертификат' };
  await assert.rejects(appendEvent(original, { ...event, documents: [reference, reference] }));
  const extra = structuredClone(original); extra.records[0].event.privateData = 'must not share';
  assert.equal(hasValidSchema(extra), false);
});

test('unsigned drafts are reported as unsigned, not trusted manufacturers', async () => {
  const draft = await createV2(product, event);
  assert.equal((await verifyPassport(draft)).signedCount, 0);
  assert.equal(draft.network, null);
  assert.deepEqual(draft.anchors, []);
});

test('extra metadata from imported passports is excluded from share URLs', async () => {
  const imported = { ...structuredClone(original), customerDocument: 'private file', contactEmail: 'private@example.test' };
  const shared = await decodePassport(await encodePassport(imported));
  assert.deepEqual(shared, original);
  assert.equal((await verifyPassport(shared)).valid, true);
});

test('large Unicode histories stop at the import byte limit without changing the saved version', async () => {
  const large = { ...event, title: '界'.repeat(240), actor: '界'.repeat(240), location: '界'.repeat(240) };
  let current = await createV2(product, large);
  let rejected = false;
  for (let index = 1; index < 50; index++) {
    try { current = await appendEvent(current, large); }
    catch (error) { assert.match(error.message, /100 КБ/); rejected = true; break; }
  }
  assert.equal(rejected, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(current)).length <= 100_000);
  assert.equal((await verifyPassport(current)).valid, true);
});

test('password-protected keys restore the same signer; wrong passwords and tampering fail', async () => {
  assert.equal(validProfile(identity.profile), true);
  const privateKey = await unlockIdentity(identity.profile, password);
  const next = await appendEvent(original, { ...event, title: 'Подписано восстановленным ключом' }, { profile: identity.profile, privateKey });
  assert.equal((await verifyPassport(next)).signedCount, 2);
  await assert.rejects(unlockIdentity(identity.profile, 'wrong-password-123'));
  const tampered = structuredClone(identity.profile); tampered.encrypted.ciphertext = tampered.encrypted.ciphertext.replace(/^../, 'ff');
  await assert.rejects(unlockIdentity(tampered, password));
  await assert.rejects(createIdentity('Компания', 'short'));
});

test('documents share only their type and byte hash; signed passport link roundtrips', async () => {
  const file = new File(['confidential example document'], 'PRIVATE-CUSTOMER-NAME.pdf');
  const prepared = await prepareDocument(file, 'Сертификат');
  assert.equal(prepared.reference.sha256, await hashBytes(await file.arrayBuffer()));
  const next = await appendEvent(original, { ...event, title: 'Документ приложен', documents: [prepared.reference] }, identity);
  assert.equal(JSON.stringify(next).includes('PRIVATE-CUSTOMER'), false);
  assert.equal(JSON.stringify(next).includes('confidential'), false);
  const encoded = await encodePassport(next);
  assert.deepEqual(await decodePassport(encoded), next);
  assert.equal(new URL(passportURL(encoded, 'https://triixoo.github.io/wectas/')).pathname, '/wectas/passport.html');
  await assert.rejects(prepareDocument(new File([], 'empty.pdf'), 'Фото'));
});

test('encrypted backups authenticate contents and validate documents before any write', async () => {
  const bytes = new TextEncoder().encode('private file'), hash = await hashBytes(bytes);
  const backup = { format: 'wectas-backup-v1', passports: [{ key: original.id + ':' + original.records.at(-1).hash, savedAt: new Date().toISOString(), passport: original }],
    profiles: [{ key: identity.profile.fingerprint, profile: identity.profile }], trusted: [], documents: [{ key: hash, name: 'local.txt', bytes: hex(bytes) }] };
  const encrypted = await encryptJSON(backup, password);
  assert.equal(JSON.stringify(encrypted).includes('local.txt'), false);
  assert.equal((await validateBackup(await decryptJSON(encrypted, password))).length, 3);
  await assert.rejects(decryptJSON(encrypted, 'wrong-password-123'));
  const bad = structuredClone(backup); bad.documents[0].bytes = '00';
  await assert.rejects(validateBackup(bad));
  const corrupt = structuredClone(backup); corrupt.passports[0].passport.records[0].event.actor = 'Злоумышленник';
  await assert.rejects(validateBackup(corrupt));
});

const address = '0x' + '1'.repeat(40), txHash = '0x' + '2'.repeat(64), blockHash = '0x' + '3'.repeat(64);
function provider({ chain = CHAIN_ID, status = '0x1', input, finalized = '0x10', pending = false, badBlock = false } = {}) {
  const calls = [];
  return { calls, async request({ method, params }) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_requestAccounts') return [address];
    if (method === 'eth_sendTransaction') return txHash;
    if (method === 'eth_getTransactionByHash') return pending ? null : { hash: txHash, from: address, to: address, value: '0x0', input: input ?? anchorData(original.records.at(-1).hash), blockHash, chainId: chain };
    if (method === 'eth_getTransactionReceipt') return pending ? null : { transactionHash: txHash, status, blockHash, blockNumber: '0x10' };
    if (method === 'eth_getBlockByNumber') return params[0] === 'finalized' ? { number: finalized } : { hash: badBlock ? '0x' + '4'.repeat(64) : blockHash, transactions: [txHash] };
    throw new Error('Unexpected RPC: ' + method);
  } };
}

test('anchoring sends only zero-value root hash in Sepolia and blocks mainnet', async () => {
  const wallet = provider(); const anchor = await sendAnchor(original, wallet);
  assert.equal(anchor.rootHash, original.records.at(-1).hash);
  const tx = wallet.calls.find(call => call.method === 'eth_sendTransaction').params[0];
  assert.equal(tx.from, tx.to); assert.equal(tx.value, '0x0'); assert.equal(tx.chainId, CHAIN_ID);
  assert.equal(tx.data, anchorData(anchor.rootHash));
  const mainnet = provider({ chain: '0x1' });
  await assert.rejects(sendAnchor(original, mainnet), /Sepolia/);
  assert.equal(mainnet.calls.some(call => call.method === 'eth_sendTransaction'), false);
  await assert.rejects(sendAnchor(original, null));
});

test('anchor references alone are never proof: receipt, payload, sender and canonical block are checked', async () => {
  const anchor = await sendAnchor(original, provider()), anchored = structuredClone(original); anchored.anchors.push(anchor);
  assert.deepEqual(await verifyAnchor(anchored, anchor, provider()), { verified: true, finalized: true, current: true, recordCount: 1, blockNumber: '0x10' });
  assert.equal((await verifyAnchor(anchored, anchor, provider({ pending: true }))).verified, false);
  assert.equal((await verifyAnchor(anchored, anchor, provider({ status: '0x0' }))).verified, false);
  assert.equal((await verifyAnchor(anchored, anchor, provider({ input: '0x00' }))).verified, false);
  assert.equal((await verifyAnchor(anchored, anchor, provider({ badBlock: true }))).verified, false);
  assert.equal((await verifyAnchor(anchored, anchor, provider({ finalized: '0xf' }))).finalized, false);
  const next = await appendEvent(anchored, { ...event, title: 'После закрепления' }, identity);
  const verification = await verifyAnchor(next, anchor, provider());
  assert.equal(verification.verified, true); assert.equal(verification.current, false); assert.equal(verification.recordCount, 1);
});

test('pilot draft targets the configured Telegram chat and is not sent by the website', () => {
  const message = pilotMessage({ company: 'Компания & Ко', name: 'Тест', task: '<проверить>', batches: '3', industry: 'Мёд' });
  const url = new URL(telegramDraft(message));
  assert.equal(url.origin, 'https://t.me'); assert.equal(url.pathname, '/kashyyn');
  assert.equal(url.searchParams.get('text'), message);
  assert.match(message, /Количество партий: 3/);
});
