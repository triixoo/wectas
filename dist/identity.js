import { hex, unhex, hashBytes, isHash, isText } from './core.js';

const ITERATIONS = 600_000;
const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
async function passwordKey(password, salt, iterations) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) throw new Error('Пароль: от 10 до 256 символов.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validEnvelope(value) {
  return value?.format === 'wectas-encrypted-v1' && value.iterations === ITERATIONS &&
    /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{24}$/.test(value.iv) &&
    typeof value.ciphertext === 'string' && value.ciphertext.length >= 32 && value.ciphertext.length <= 44_000_000 &&
    value.ciphertext.length % 2 === 0 && !/[^a-f0-9]/.test(value.ciphertext);
}
export async function encryptJSON(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ITERATIONS);
  const data = new TextEncoder().encode(JSON.stringify(value));
  if (data.length > 20_000_000) throw new Error('Резервная копия превышает 20 МБ.');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { format: 'wectas-encrypted-v1', iterations: ITERATIONS, salt: hex(salt), iv: hex(iv), ciphertext: hex(encrypted) };
}
export async function decryptJSON(value, password) {
  if (!validEnvelope(value)) throw new Error('Неверный формат зашифрованного файла.');
  try {
    const key = await passwordKey(password, unhex(value.salt), value.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(value.iv) }, key, unhex(value.ciphertext));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch { throw new Error('Неверный пароль или файл повреждён.'); }
}
export function validProfile(value) {
  return value?.format === 'wectas-key-v1' && isText(value.name) &&
    /^04[a-f0-9]{128}$/.test(value.publicKey) && isHash(value.fingerprint) && validEnvelope(value.encrypted) && value.encrypted.ciphertext.length <= 10_000;
}
export async function createIdentity(name, password) {
  if (!isText(name)) throw new Error('Укажите публичное название участника.');
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const publicKey = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
  const fingerprint = await hashBytes(unhex(publicKey));
  const privateData = hex(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const encrypted = await encryptJSON({ privateKey: privateData, publicKey }, password);
  return { profile: { format: 'wectas-key-v1', name: name.trim(), publicKey, fingerprint, encrypted }, privateKey: await crypto.subtle.importKey('pkcs8', unhex(privateData), algorithm, false, ['sign']) };
}
export async function unlockIdentity(profile, password) {
  if (!validProfile(profile) || await hashBytes(unhex(profile.publicKey)) !== profile.fingerprint) throw new Error('Ключ участника повреждён.');
  const data = await decryptJSON(profile.encrypted, password);
  if (data.publicKey !== profile.publicKey || typeof data.privateKey !== 'string') throw new Error('Открытый и закрытый ключи не совпадают.');
  const key = await crypto.subtle.importKey('pkcs8', unhex(data.privateKey), algorithm, false, ['sign']);
  // Imported files are untrusted: prove that the private key matches the advertised public key.
  const proof = await signHash(key, profile.fingerprint);
  if (!await verifySignature(profile.publicKey, profile.fingerprint, proof)) throw new Error('Ключи участника не совпадают.');
  return key;
}
const signedMessage = hash => new TextEncoder().encode('WECTAS-EVENT-V2:' + hash);
export async function signHash(key, hash) {
  if (!isHash(hash)) throw new Error('Некорректный хеш для подписи.');
  return hex(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signedMessage(hash)));
}
export async function verifySignature(publicKey, hash, signature) {
  try {
    const key = await crypto.subtle.importKey('raw', unhex(publicKey), algorithm, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unhex(signature), signedMessage(hash));
  } catch { return false; }
}
