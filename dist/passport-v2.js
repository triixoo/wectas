import { sha256, hashBytes, unhex, isHash, isText, isDate } from './core.js';
import { signHash, verifySignature } from './identity.js';

export const ROLES = ['Производитель', 'Перевозчик', 'Покупатель', 'Лаборатория'];
export const TYPES = ['Создание партии', 'Производство', 'Проверка', 'Отгрузка', 'Приёмка'];
export const DOCUMENT_TYPES = ['Сертификат', 'Протокол испытаний', 'Накладная', 'Фото', 'Другой документ'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validEvent(event) {
  return exact(event, ['title', 'actor', 'location', 'date', 'role', 'type', 'documents']) &&
    ['title', 'actor', 'location'].every(key => isText(event[key])) && isDate(event.date) &&
    ROLES.includes(event.role) && TYPES.includes(event.type) && Array.isArray(event.documents) && event.documents.length <= 5 &&
    event.documents.every(doc => exact(doc, ['sha256', 'type']) && isHash(doc.sha256) && DOCUMENT_TYPES.includes(doc.type)) &&
    new Set(event.documents.map(doc => doc.sha256)).size === event.documents.length;
}
export function validAnchor(anchor, passport) {
  return exact(anchor, ['network', 'chainId', 'transactionHash', 'rootHash', 'recordCount', 'sender']) &&
    anchor.network === 'sepolia' && anchor.chainId === '0xaa36a7' && /^0x[a-fA-F0-9]{64}$/.test(anchor.transactionHash) &&
    /^0x[a-fA-F0-9]{40}$/.test(anchor.sender) && isHash(anchor.rootHash) &&
    Number.isInteger(anchor.recordCount) && anchor.recordCount > 0 && anchor.recordCount <= passport.records.length &&
    passport.records[anchor.recordCount - 1].hash === anchor.rootHash;
}
export function validV2(passport) {
  return passport?.format === 'wectas-passport-v2' && /^[a-f0-9-]{36}$/.test(passport.id) && typeof passport.demo === 'boolean' && passport.network === null &&
    exact(passport.product, ['name', 'batch', 'origin', 'category']) && Object.values(passport.product).every(isText) &&
    Number.isInteger(passport.eventCount) && passport.eventCount > 0 && passport.eventCount <= 50 &&
    Array.isArray(passport.records) && passport.records.length === passport.eventCount &&
    passport.records.every(record => exact(record, ['index', 'event', 'previousHash', 'hash', 'signer', 'signature']) &&
      Number.isInteger(record.index) && isHash(record.hash) && isHash(record.previousHash) && validEvent(record.event) &&
      (record.signer === null ? record.signature === null : exact(record.signer, ['publicKey', 'fingerprint']) &&
        /^04[a-f0-9]{128}$/.test(record.signer.publicKey) && isHash(record.signer.fingerprint) && /^[a-f0-9]{128}$/.test(record.signature))) &&
    Array.isArray(passport.anchors) && passport.anchors.length <= 50 && passport.anchors.every(anchor => validAnchor(anchor, passport));
}
const payload = (passport, record) => ({ format: passport.format, id: passport.id, demo: passport.demo, network: passport.network,
  product: passport.product, index: record.index, event: record.event, previousHash: record.previousHash, signer: record.signer });
async function addRecord(passport, event, identity) {
  if (!validEvent(event) || passport.records.length >= 50) throw new Error('Неверные данные события или достигнут лимит 50 событий.');
  const record = { index: passport.records.length, event: structuredClone(event), previousHash: passport.records.at(-1)?.hash ?? '0'.repeat(64),
    signer: identity ? { publicKey: identity.profile.publicKey, fingerprint: identity.profile.fingerprint } : null, signature: null };
  record.hash = await sha256(payload(passport, record));
  if (identity) record.signature = await signHash(identity.privateKey, record.hash);
  passport.records.push(record); passport.eventCount = passport.records.length;
  if (new TextEncoder().encode(JSON.stringify(passport)).length > 100_000) throw new Error('Паспорт достиг лимита 100 КБ. Сохраните текущую версию; новые события в неё уже не поместятся.');
  return passport;
}
export async function createV2(product, event, identity = null) {
  const passport = { format: 'wectas-passport-v2', id: crypto.randomUUID(), demo: false, network: null, product: structuredClone(product), eventCount: 0, records: [], anchors: [] };
  await addRecord(passport, event, identity);
  if (!(await verifyV2(passport)).valid) throw new Error('Не удалось проверить новый паспорт.');
  return passport;
}
export async function appendEvent(passport, event, identity = null) {
  if (!(await verifyV2(passport)).valid) throw new Error('Продолжить можно только исправный паспорт версии 2.');
  if (passport.demo) throw new Error('Нельзя дополнять демонстрационный паспорт.');
  if (event.date < passport.records.at(-1).event.date) throw new Error('Дата события не может быть раньше предыдущей записи.');
  const next = await addRecord(structuredClone(passport), event, identity);
  if (!(await verifyV2(next)).valid) throw new Error('Подпись нового события не прошла проверку.');
  return next;
}
export async function verifyV2(passport) {
  if (!validV2(passport)) return { valid: false, index: null, reason: 'Неверный формат паспорта версии 2' };
  let previousHash = '0'.repeat(64), signedCount = 0;
  const signatures = [];
  for (let index = 0; index < passport.records.length; index++) {
    const record = passport.records[index];
    if (record.index !== index || record.previousHash !== previousHash || record.hash !== await sha256(payload(passport, record)) ||
      (index > 0 && record.event.date < passport.records[index - 1].event.date)) return { valid: false, index, reason: 'Целостность записи нарушена' };
    if (record.signer) {
      if (await hashBytes(unhex(record.signer.publicKey)) !== record.signer.fingerprint || !await verifySignature(record.signer.publicKey, record.hash, record.signature))
        return { valid: false, index, reason: 'Подпись участника не прошла проверку' };
      signedCount++; signatures.push({ index, fingerprint: record.signer.fingerprint });
    }
    previousHash = record.hash;
  }
  return { valid: true, count: passport.records.length, rootHash: previousHash, signedCount, signatures };
}
