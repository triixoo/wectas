import { hasValidSchema, publicPassport } from './passport.js';

const LIMIT = 100_000;
export async function encodePassport(passport) {
  if (!hasValidSchema(passport)) throw new Error('Паспорт имеет неверный формат.');
  const json = JSON.stringify(publicPassport(passport));
  if (new TextEncoder().encode(json).length > LIMIT) throw new Error('Паспорт слишком большой для ссылки. Скачайте JSON.');
  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (encoded.length > 20_000) throw new Error('Паспорт слишком большой для ссылки. Скачайте JSON.');
  return encoded;
}

export async function decodePassport(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 20_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Некорректная ссылка на паспорт.');
  let reader;
  try {
    const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT) { await reader.cancel(); throw new Error('Паспорт слишком большой.'); }
      chunks.push(value);
    }
    const passport = JSON.parse(await new Blob(chunks).text());
    if (!hasValidSchema(passport)) throw new Error('Неверный формат паспорта.');
    return publicPassport(passport);
  } catch { throw new Error('Не удалось прочитать паспорт из ссылки. Загрузите файл JSON.'); }
  finally { reader?.releaseLock(); }
}

export function passportURL(encoded, baseURL) {
  const url = new URL('passport.html', baseURL);
  url.hash = 'p=' + encoded;
  return url.href;
}
