import { sha256, isDate } from './core.js';
import { validV2, verifyV2 } from './passport-v2.js';
export { canonical, sha256 } from './core.js';

// Whitelist only the public format. Extra import/export metadata must never enter share URLs.
export function publicPassport(value) {
  if (!hasValidSchema(value)) throw new Error('Неверный формат паспорта.');
  const keys = value.format === 'wectas-passport-v2'
    ? ['format', 'id', 'demo', 'network', 'product', 'eventCount', 'records', 'anchors']
    : ['format', 'demo', 'network', 'product', 'eventCount', 'records'];
  const result = Object.fromEntries(keys.map(key => [key, structuredClone(value[key])]));
  if (value.format === 'wectas-passport-v1') result.records = result.records.map(record =>
    Object.fromEntries(['index', 'event', 'previousHash', 'hash'].map(key => [key, record[key]])));
  return result;
}

function payload(passport, record) {
  return { format: passport.format, demo: passport.demo, network: passport.network, eventCount: passport.eventCount, product: passport.product,
    index: record.index, event: record.event, previousHash: record.previousHash };
}

export async function createPassport(product, events, { demo = true } = {}) {
  const passport = { format: 'wectas-passport-v1', demo, network: null,
    product: structuredClone(product), eventCount: events.length, records: [] };
  let previousHash = '0'.repeat(64);
  for (let index = 0; index < events.length; index++) {
    const record = { index, event: structuredClone(events[index]), previousHash };
    record.hash = await sha256(payload(passport, record));
    passport.records.push(record);
    previousHash = record.hash;
  }
  return passport;
}

export function hasValidSchema(passport) {
  if (passport?.format === 'wectas-passport-v2') return validV2(passport);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const product = passport?.product;
  return passport?.format === 'wectas-passport-v1' && typeof passport.demo === 'boolean' && passport.network === null &&
    product && typeof product === 'object' && !Array.isArray(product) && Object.keys(product).length === 4 &&
    ['name','origin','batch','category'].every(key => text(product[key])) &&
    Number.isInteger(passport.eventCount) && passport.eventCount > 0 && passport.eventCount <= 50 &&
    Array.isArray(passport.records) && passport.records.length === passport.eventCount &&
    passport.records.every(record => record && typeof record === 'object' && Number.isInteger(record.index) &&
      hash(record.hash) && hash(record.previousHash) && record.event && Object.keys(record.event).length === 4 &&
      ['title','actor','location','date'].every(key => text(record.event[key])) &&
      isDate(record.event.date));
}

export async function verifyPassport(passport) {
  if (passport?.format === 'wectas-passport-v2') return verifyV2(passport);
  if (!hasValidSchema(passport)) {
    return { valid: false, index: null, reason: 'Неверный формат паспорта' };
  }
  let previousHash = '0'.repeat(64);
  for (let index = 0; index < passport.records.length; index++) {
    const record = passport.records[index];
    if (!record?.event || record.index !== index || record.previousHash !== previousHash ||
        record.hash !== await sha256(payload(passport, record))) {
      return { valid: false, index, reason: 'Целостность записи нарушена' };
    }
    previousHash = record.hash;
  }
  return { valid: true, count: passport.records.length, rootHash: previousHash };
}

export const products = {
  grain: {
    product: { name: 'Казахстанская пшеница', origin: 'Акмолинская область, Казахстан', batch: 'KZ-WHT-2026-001', category: 'Агропродукция' },
    events: [
      { title: 'Выращено в Казахстане', actor: 'Демонстрационное фермерское хозяйство', location: 'Акмолинская область', date: '2026-09-15' },
      { title: 'Партия собрана и описана', actor: 'Демонстрационный производитель', location: 'Акмолинская область', date: '2026-09-18' },
      { title: 'Передано в логистику', actor: 'Демонстрационный перевозчик', location: 'Астана', date: '2026-09-20' },
      { title: 'Доставлено покупателю', actor: 'Демонстрационный покупатель', location: 'Алматы', date: '2026-09-23' }
    ]
  },
  honey: {
    product: { name: 'Алтайский цветочный мёд', origin: 'Восточно-Казахстанская область', batch: 'KZ-HNY-2026-008', category: 'Локальный бренд' },
    events: [
      { title: 'Собрано на пасеке', actor: 'Демонстрационная пасека', location: 'Катон-Карагай', date: '2026-08-10' },
      { title: 'Партия расфасована', actor: 'Демонстрационный производитель', location: 'Усть-Каменогорск', date: '2026-08-14' },
      { title: 'Передано в логистику', actor: 'Демонстрационный перевозчик', location: 'Усть-Каменогорск', date: '2026-08-16' },
      { title: 'Доставлено в магазин', actor: 'Демонстрационный магазин', location: 'Алматы', date: '2026-08-19' }
    ]
  },
  textile: {
    product: { name: 'Казахстанский хлопок', origin: 'Туркестанская область, Казахстан', batch: 'KZ-TXT-2026-012', category: 'Текстиль' },
    events: [
      { title: 'Собран хлопок', actor: 'Демонстрационное фермерское хозяйство', location: 'Туркестанская область', date: '2026-09-01' },
      { title: 'Произведено полотно', actor: 'Демонстрационная текстильная фабрика', location: 'Шымкент', date: '2026-09-08' },
      { title: 'Передано в логистику', actor: 'Демонстрационный перевозчик', location: 'Шымкент', date: '2026-09-10' },
      { title: 'Доставлено в мастерскую', actor: 'Демонстрационная мастерская', location: 'Алматы', date: '2026-09-12' }
    ]
  }
};
