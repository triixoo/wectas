export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));
export function hex(value) {
  const bytes = new Uint8Array(value), chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16_384) chunks.push(Array.from(bytes.subarray(offset, offset + 16_384), byte => HEX[byte]).join(''));
  return chunks.join('');
}
export function unhex(value) {
  if (typeof value !== 'string' || !value.length || value.length % 2 || /[^a-f0-9]/.test(value)) throw new Error('Некорректные двоичные данные.');
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
export async function hashBytes(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Откройте сайт по HTTPS или на localhost.');
  return hex(await crypto.subtle.digest('SHA-256', value));
}
export const sha256 = value => hashBytes(new TextEncoder().encode(canonical(value)));
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
