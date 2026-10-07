import { verifyPassport, hasValidSchema, publicPassport } from './passport.js';
import { validProfile } from './identity.js';
import { hashBytes, hex, unhex, isText, isHash } from './core.js';

const TABLES = ['passports', 'documents', 'profiles', 'trusted'];
let database;
async function open() {
  if (!database) database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Браузер не поддерживает локальное хранилище. Используйте экспорт JSON.')); return; }
    const request = indexedDB.open('wectas-workspace', 1);
    request.onupgradeneeded = () => { for (const table of TABLES) request.result.createObjectStore(table, { keyPath: 'key' }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => { database = null; reject(new Error('Локальное хранилище недоступно. Используйте экспорт JSON.')); };
    request.onblocked = () => reject(new Error('Закройте другие вкладки Wectas и повторите.'));
  });
  return database;
}
export async function list(table) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(table).objectStore(table).getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function get(table, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(table).objectStore(table).get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function write(entries, removing = false) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([...new Set(entries.map(entry => entry.table))], 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Не удалось сохранить данные. Возможно, место в браузере закончилось. Скачайте JSON.'));
    transaction.onerror = () => {};
    try { for (const entry of entries) { const store = transaction.objectStore(entry.table); if (removing) store.delete(entry.key); else store.put(entry.value); } }
    catch (error) { transaction.abort(); reject(error); }
  });
}
export const remove = (table, key) => write([{ table, key }], true);
export async function saveProfile(profile) {
  if (!validProfile(profile)) throw new Error('Неверный файл ключа.');
  await write([{ table: 'profiles', value: { key: profile.fingerprint, profile } }]);
}
export async function trustKey(fingerprint, name) {
  if (!isHash(fingerprint) || !isText(name)) throw new Error('Нужны полные 64 символа отпечатка и название участника.');
  await write([{ table: 'trusted', value: { key: fingerprint, name: name.trim() } }]);
}
export async function prepareDocument(file, type) {
  if (!file || file.size <= 0 || file.size > 5_000_000) throw new Error('Документ: от 1 байта до 5 МБ.');
  const bytes = await file.arrayBuffer(), key = await hashBytes(bytes);
  return { reference: { sha256: key, type }, local: { key, name: file.name.slice(0, 240), blob: new Blob([bytes], { type: 'application/octet-stream' }) } };
}
export async function savePassport(passport, documents = []) {
  const result = await verifyPassport(passport);
  if (!result.valid) throw new Error('Повреждённый паспорт нельзя сохранить в кабинет.');
  for (const doc of documents) {
    if (!(doc.blob instanceof Blob) || doc.blob.size > 5_000_000 || await hashBytes(await doc.blob.arrayBuffer()) !== doc.key) throw new Error('Документ не совпадает с хешем.');
    if (!passport.records.some(record => record.event.documents?.some(ref => ref.sha256 === doc.key))) throw new Error('Документ не относится к паспорту.');
  }
  const key = (passport.id ?? 'v1') + ':' + result.rootHash;
  const entries = documents.map(value => ({ table: 'documents', value }));
  entries.push({ table: 'passports', value: { key, savedAt: new Date().toISOString(), passport: publicPassport(passport) } });
  await write(entries); return key;
}
export async function backupData() {
  const [passports, documents, profiles, trusted] = await Promise.all(TABLES.map(list));
  if (passports.length > 200 || documents.length > 100 || profiles.length > 50 || trusted.length > 200) throw new Error('Слишком много записей для одной копии. Экспортируйте паспорта отдельно.');
  const bytes = documents.reduce((sum, doc) => sum + doc.blob.size * 2, 0) + new TextEncoder().encode(JSON.stringify({ passports, profiles, trusted })).length;
  if (bytes > 19_000_000) throw new Error('Кабинет превышает лимит 20 МБ для копии. Скачайте документы и паспорта отдельно.');
  return { format: 'wectas-backup-v1', createdAt: new Date().toISOString(), passports, profiles, trusted,
    documents: await Promise.all(documents.map(async doc => ({ key: doc.key, name: doc.name, bytes: hex(await doc.blob.arrayBuffer()) }))) };
}
export async function validateBackup(data) {
  if (data?.format !== 'wectas-backup-v1' || !['passports', 'profiles', 'trusted', 'documents'].every(key => Array.isArray(data[key])) ||
    data.passports.length > 200 || data.documents.length > 100 || data.profiles.length > 50 || data.trusted.length > 200) throw new Error('Неверная структура резервной копии.');
  const entries = [], seen = new Set();
  const add = (table, value) => { const id = table + ':' + value.key; if (seen.has(id)) throw new Error('Повторяющаяся запись в копии.'); seen.add(id); entries.push({ table, value }); };
  for (const item of data.passports) {
    if (!hasValidSchema(item.passport) || !(await verifyPassport(item.passport)).valid || typeof item.savedAt !== 'string' || !Number.isFinite(Date.parse(item.savedAt)) ||
      item.key !== (item.passport.id ?? 'v1') + ':' + item.passport.records.at(-1).hash) throw new Error('Повреждённый паспорт в копии.');
    add('passports', { key: item.key, savedAt: item.savedAt, passport: publicPassport(item.passport) });
  }
  let total = 0;
  for (const item of data.documents) {
    if (!isHash(item.key) || !isText(item.name) || typeof item.bytes !== 'string' || item.bytes.length > 10_000_000) throw new Error('Некорректный документ в копии.');
    total += item.bytes.length; if (total > 30_000_000) throw new Error('Документы в копии слишком большие.');
    const bytes = unhex(item.bytes);
    if (await hashBytes(bytes) !== item.key) throw new Error('Хеш документа в копии не совпадает.');
    add('documents', { key: item.key, name: item.name, blob: new Blob([bytes], { type: 'application/octet-stream' }) });
  }
  for (const item of data.profiles) {
    if (!validProfile(item.profile) || item.key !== item.profile.fingerprint || await hashBytes(unhex(item.profile.publicKey)) !== item.key) throw new Error('Повреждённый ключ в копии.');
    add('profiles', { key: item.key, profile: item.profile });
  }
  for (const item of data.trusted) {
    if (!isHash(item.key) || !isText(item.name)) throw new Error('Некорректный сверенный отпечаток в копии.');
    add('trusted', { key: item.key, name: item.name });
  }
  return entries;
}
export async function restoreBackup(data) { const entries = await validateBackup(data); if (entries.length) await write(entries); return entries.length; }
