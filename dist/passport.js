// Deterministic encoding shared by creation, verification, and exported passports.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Для SHA-256 откройте сайт по HTTPS или на localhost.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function payload(passport, record) {
  return { format: passport.format, demo: passport.demo, network: passport.network, eventCount: passport.eventCount, product: passport.product,
    index: record.index, event: record.event, previousHash: record.previousHash };
}

export async function createPassport(product, events) {
  const passport = { format: 'wectas-passport-v1', demo: true, network: null,
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

export async function verifyPassport(passport) {
  if (passport?.format !== 'wectas-passport-v1' || !passport.product ||
      !Array.isArray(passport.records) || passport.records.length === 0 || passport.records.length !== passport.eventCount) {
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
