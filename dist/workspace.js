import { verifyPassport, hasValidSchema, publicPassport } from './passport.js';
import { createV2, appendEvent } from './passport-v2.js';
import { encodePassport, decodePassport, passportURL } from './share.js';
import { createIdentity, unlockIdentity, validProfile, encryptJSON, decryptJSON } from './identity.js';
import { list, get, remove, saveProfile, trustKey, prepareDocument, savePassport, backupData, restoreBackup } from './storage.js';
import { hashBytes, isHash, unhex } from './core.js';
import { sendAnchor, verifyAnchor } from './anchor.js';
import qrcode from './vendor/qrcode.mjs';

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { $(selector).textContent = value; };
const node = (tag, value, className) => { const item = document.createElement(tag); if (value !== undefined) item.textContent = value; if (className) item.className = className; return item; };
let passport = null, verification = null, savedKey = null, version = 0, svg = '', busy = false, pendingURL = false;
let profiles = [], trusted = [], inventory = [], storageAvailable = false, unlockPending = null;
const unlocked = new Map();
const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
$('#passport-form').elements.date.value = date; $('#event-form').elements.date.value = date;
function status(message, error = false, selector = '#workspace-status') { text(selector, message); $(selector).classList.toggle('error', error); }
function download(data, name, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function formData(form) { const values = Object.fromEntries(new FormData(form)); for (const key of Object.keys(values)) if (typeof values[key] === 'string') values[key] = values[key].trim(); return values; }
function mode(selected) { for (const name of ['library', 'create', 'import']) { $('#' + name + '-panel').hidden = selected !== name; $('#' + name + '-tab').setAttribute('aria-pressed', String(selected === name)); } }
for (const name of ['library', 'create', 'import']) $('#' + name + '-tab').addEventListener('click', () => { if (!busy) mode(name); });
function controls() {
  const valid = !!verification?.valid, editable = valid && passport.format === 'wectas-passport-v2' && !passport.demo;
  $('#export-json').disabled = busy || !passport; $('#share-passport').disabled = busy || !valid;
  $('#save-passport').disabled = busy || !valid || !storageAvailable || !!savedKey;
  $('#delete-passport').disabled = busy || !savedKey;
  $('#event-panel').hidden = !editable; $('#anchor-panel').hidden = !editable; $('#document-panel').hidden = !editable;
  $('#anchor-send').disabled = busy || !editable || passport.anchors.length >= 50;
  $('#anchor-check').disabled = busy || !editable || !passport.anchors.length;
  $('#event-form button').disabled = busy || !editable || passport.records.length >= 50;
}
async function run(action, selector = '#workspace-status') {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('#main button, #backup-dialog button[type=submit], #keys-dialog button[type=submit]')];
  const previous = buttons.map(button => button.disabled); buttons.forEach(button => { button.disabled = true; });
  try { await action(); }
  catch (error) { status(error.code === 4001 ? 'Вы отменили запрос в кошельке.' : error.message || 'Операция не выполнена.', true, selector); }
  finally {
    busy = false; buttons.forEach((button, index) => { if (button.isConnected) button.disabled = previous[index]; });
    $('#passport-form button[type=submit]').disabled = false; renderLibrary(); controls();
    if (pendingURL) { pendingURL = false; openFromURL(); }
  }
}
function clearPreview() {
  version++; passport = null; verification = null; savedKey = null;
  text('#preview-name', 'Выберите или создайте партию'); text('#preview-origin', 'Начните с одной партии и одного события.');
  for (const id of ['preview-kind', 'preview-batch', 'preview-category', 'preview-count']) text('#' + id, '—');
  text('#integrity-symbol', '○'); text('#integrity-label', 'Целостность не проверена'); text('#signature-label', 'Подписи не проверены'); text('#anchor-label', 'Нет независимого якоря');
  $('.evidence-status').classList.remove('invalid'); $('#preview-timeline').replaceChildren(); $('#root-hash').hidden = true; controls();
}
function renderLibrary() {
  const container = $('#library-list'); container.replaceChildren();
  const search = $('#library-search').value.toLocaleLowerCase('ru');
  const values = inventory.filter(item => [item.passport.product.name, item.passport.product.batch, item.passport.product.origin].join(' ').toLocaleLowerCase('ru').includes(search));
  text('#library-count', String(new Set(inventory.map(item => item.passport.id ?? item.key)).size));
  if (!values.length) {
    container.append(node('p', search ? 'Ничего не найдено.' : 'Пока нет партий. Создайте паспорт или сохраните полученный от поставщика.', 'empty-state'));
    if (!search) { const button = node('button', 'Создать первую партию ↗', 'button button-dark'); button.type = 'button'; button.disabled = busy; button.onclick = () => mode('create'); container.append(button); }
  }
  for (const item of values) {
    const button = node('button', undefined, 'library-card'); button.type = 'button'; button.disabled = busy; button.setAttribute('aria-pressed', String(savedKey === item.key));
    button.append(node('strong', item.passport.product.name), node('span', item.passport.product.batch),
      node('small', `${item.passport.records.length} событий · версия ${item.passport.records.at(-1).hash.slice(0, 8)}`));
    button.onclick = () => run(() => showPassport(item.passport, item.key)); container.append(button);
  }
}
$('#library-search').addEventListener('input', renderLibrary);
async function refreshInventory() { if (!storageAvailable) return; inventory = (await list('passports')).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); renderLibrary(); }
async function showPassport(value, key = null) {
  if (!hasValidSchema(value)) throw new Error('Неверный формат паспорта Wectas.');
  value = publicPassport(value);
  const generation = ++version, result = await verifyPassport(value);
  if (generation !== version) return;
  passport = structuredClone(value); verification = result; savedKey = key;
  text('#preview-name', value.product.name); text('#preview-origin', value.product.origin);
  text('#preview-kind', value.demo ? 'ДЕМОНСТРАЦИЯ' : value.format.endsWith('v2') ? 'ВЕРСИЯ 2' : 'ВЕРСИЯ 1');
  text('#preview-batch', value.product.batch); text('#preview-category', value.product.category); text('#preview-count', String(value.records.length));
  text('#integrity-symbol', result.valid ? '✓' : '!'); text('#integrity-label', result.valid ? 'Хеши и имеющиеся подписи проверены' : result.reason);
  text('#signature-label', result.valid ? `Подписано ${result.signedCount ?? 0} из ${value.records.length} событий` : 'Подписи нельзя считать проверенными');
  text('#anchor-label', value.anchors?.length ? 'Есть ссылки на транзакции — проверьте в сети' : 'Нет независимого якоря');
  $('.evidence-status').classList.toggle('invalid', !result.valid);
  const timeline = $('#preview-timeline'); timeline.replaceChildren();
  for (const record of value.records) {
    const item = node('li'); if (!result.valid && record.index === result.index) item.classList.add('invalid');
    item.append(node('strong', record.event.title), node('span', record.event.actor + (record.event.role ? ' · ' + record.event.role : '')),
      node('span', record.event.location + ' · ' + record.event.date));
    if (record.signer) {
      const known = trusted.find(person => person.key === record.signer.fingerprint);
      item.append(node('span', !result.valid ? 'Подпись не подтверждена' : known ? 'Подпись проверена · отпечаток сверен: ' + known.name + (known.name !== record.event.actor ? ' · заявленное имя отличается' : '') : 'Подпись проверена · ключ участника ещё не сверен', 'signature-note'));
      const fingerprint = node('code', record.signer.fingerprint, 'fingerprint'); fingerprint.title = 'Полный отпечаток ключа'; item.append(fingerprint);
    } else item.append(node('span', 'Без подписи', 'signature-note'));
    for (const doc of record.event.documents ?? []) { const detail = node('details'); detail.append(node('summary', doc.type + ' · хеш документа'), node('code', doc.sha256, 'fingerprint')); item.append(detail); }
    timeline.append(item);
  }
  $('#root-hash').hidden = false; text('#root-value', value.records.at(-1).hash); controls(); renderLibrary(); renderAnchors();
  if (result.valid) {
    const last = value.records.at(-1).event;
    $('#event-form').elements.date.min = last.date;
    $('#event-form').elements.date.value = date < last.date ? last.date : date;
  }
  $('#event-form').elements.documents.value = ''; text('#anchor-status', ''); text('#document-status', '');
  await renderDocuments(generation);
  status(result.valid ? (key ? 'Версия сохранена на этом устройстве.' : 'Проверка выполнена. Сохраните паспорт, если хотите продолжить работу с ним.') : 'Проверка не пройдена. Сохранение, продолжение и публикация заблокированы.', !result.valid);
}
async function persistAndShow(value, documents = []) {
  let key = null;
  try { key = await savePassport(value, documents); storageAvailable = true; await refreshInventory(); }
  catch (error) {
    await showPassport(value);
    status('Паспорт создан, но не сохранён: ' + error.message + (documents.length ? ' Прикреплённые файлы не сохранены. Повторите добавление после восстановления хранилища.' : ''), true); return;
  }
  await showPassport(value, key);
}
function identityFor(fingerprint) {
  if (!fingerprint) return null;
  const profile = profiles.find(item => item.profile.fingerprint === fingerprint)?.profile;
  const privateKey = unlocked.get(fingerprint);
  if (!profile || !privateKey) throw new Error('Сначала разблокируйте выбранный ключ в разделе «Участники и ключи».');
  return { profile, privateKey };
}
$('#passport-form').addEventListener('submit', event => {
  event.preventDefault(); const data = formData(event.currentTarget);
  run(async () => {
    if (['name', 'batch', 'origin', 'actor', 'date'].some(key => !data[key])) throw new Error('Заполните все обязательные поля.');
    const identity = identityFor(data.signing);
    if (identity && identity.profile.name !== data.actor) throw new Error('Название производителя должно совпадать с выбранным ключом.');
    const value = await createV2({ name: data.name, batch: data.batch, origin: data.origin, category: data.category },
      { title: 'Партия зарегистрирована производителем', actor: data.actor, location: data.origin, date: data.date, role: 'Производитель', type: 'Создание партии', documents: [] }, identity);
    await persistAndShow(value);
  });
});
$('#event-form').addEventListener('submit', event => {
  event.preventDefault(); const data = formData(event.currentTarget), files = [...event.currentTarget.elements.documents.files];
  const current = passport;
  run(async () => {
    if (!current) return;
    const identity = identityFor(data.signing);
    if (identity && identity.profile.name !== data.actor) throw new Error('Название участника должно совпадать с выбранным ключом.');
    if (files.length > 5) throw new Error('Не более 5 документов на событие.');
    const documents = await Promise.all(files.map(file => prepareDocument(file, data.documentType)));
    const value = await appendEvent(current, { title: data.title, actor: data.actor, location: data.location, date: data.date, role: data.role, type: data.type, documents: documents.map(item => item.reference) }, identity);
    await persistAndShow(value, documents.map(item => item.local));
  });
});
$('#passport-file').addEventListener('change', event => {
  const file = event.currentTarget.files[0]; event.currentTarget.value = ''; if (!file) return;
  run(async () => { clearPreview(); if (file.size > 100_000) throw new Error('Размер паспорта превышает 100 КБ.'); let value; try { value = JSON.parse(await file.text()); } catch { throw new Error('Файл не является JSON.'); } await showPassport(value); });
});
$('#link-form').addEventListener('submit', event => {
  event.preventDefault(); const data = formData(event.currentTarget);
  run(async () => { clearPreview(); const url = new URL(data.url); if (!url.hash.startsWith('#p=')) throw new Error('В ссылке нет паспорта Wectas.'); await showPassport(await decodePassport(url.hash.slice(3))); });
});
$('#save-passport').addEventListener('click', () => run(async () => { if (passport) await persistAndShow(passport); }));
$('#delete-passport').addEventListener('click', () => {
  if (!savedKey || !confirm('Удалить эту версию из браузера? Переданные ссылки и другие версии останутся доступны. Локальные документы сохранятся отдельно.')) return;
  run(async () => { await remove('passports', savedKey); clearPreview(); await refreshInventory(); status('Версия удалена с этого устройства.'); });
});
$('#export-json').addEventListener('click', () => run(async () => {
  if (!passport) return;
  const name = passport.product.batch.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,80) || 'batch';
  download(JSON.stringify(passport, null, 2), 'wectas-' + name + '.json'); status('JSON подготовлен. Локальные документы и закрытые ключи в него не входят.');
}));
$('#share-passport').addEventListener('click', () => run(async () => {
  const url = passportURL(await encodePassport(passport), location.href);
  $('#share-url').value = url; text('#share-status', ''); $('#qr-code').replaceChildren(); svg = '';
  try { const qr = qrcode(0, 'L'); qr.addData(url); qr.make(); svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }); $('#qr-code').innerHTML = svg; }
  catch { text('#share-status', 'Эта версия слишком большая для QR. Передайте ссылку или JSON; QR и печать недоступны.'); }
  $('#download-qr').disabled = !svg; $('#print-label').disabled = !svg;
  $('#share-dialog').showModal();
}));
$('#copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#share-url').value); text('#share-status', 'Ссылка скопирована.'); }
  catch { $('#share-url').select(); text('#share-status', 'Скопируйте выделенную ссылку вручную.'); }
});
$('#download-qr').addEventListener('click', () => { if (svg) download(svg, 'wectas-qr.svg', 'image/svg+xml'); });
$('#print-label').addEventListener('click', () => {
  if (!svg || !passport) return;
  text('#print-name', passport.product.name); text('#print-batch', passport.product.batch); text('#print-root', 'SHA-256: ' + passport.records.at(-1).hash);
  $('#print-qr').innerHTML = svg; window.print();
});
async function renderDocuments(generation) {
  $('#local-documents').replaceChildren(); if (!passport || !storageAvailable) return;
  const hashes = new Set(passport.records.flatMap(record => (record.event.documents ?? []).map(doc => doc.sha256)));
  const documents = await Promise.all([...hashes].map(hash => get('documents', hash)));
  if (generation !== version) return;
  for (const doc of documents.filter(Boolean)) {
    const row = node('div', undefined, 'local-document'); row.append(node('span', doc.name));
    const link = node('button', 'Скачать ↓'); link.type = 'button';
    link.onclick = () => run(async () => { if (await hashBytes(await doc.blob.arrayBuffer()) !== doc.key) throw new Error('Локальный файл повреждён.'); download(doc.blob, doc.name); });
    const erase = node('button', 'Удалить файл'); erase.type = 'button';
    erase.onclick = () => { if (confirm('Удалить только локальную копию документа? Его хеш останется в подписанном событии.')) run(async () => { await remove('documents', doc.key); await renderDocuments(version); }); };
    row.append(link, erase); $('#local-documents').append(row);
  }
}
$('#document-check').addEventListener('change', event => {
  const file = event.currentTarget.files[0]; event.currentTarget.value = ''; if (!file) return;
  run(async () => {
    if (file.size > 5_000_000) throw new Error('Для проверки выберите файл не более 5 МБ.');
    const hash = await hashBytes(await file.arrayBuffer());
    const records = passport.records.filter(record => record.event.documents?.some(doc => doc.sha256 === hash));
    status(records.length ? 'Файл совпадает с хешем в событиях: ' + records.map(record => String(record.index + 1)).join(', ') + '. Это не проверка содержания документа.' : 'Файл не совпадает ни с одним документом этого паспорта.', !records.length, '#document-status');
  }, '#document-status');
});
function renderAnchors() {
  $('#anchor-list').replaceChildren();
  for (const anchor of passport?.anchors ?? []) {
    const item = node('div', undefined, 'anchor-reference');
    const link = node('a', 'Sepolia · ' + anchor.transactionHash.slice(0,12) + '… ↗');
    link.href = 'https://sepolia.etherscan.io/tx/' + anchor.transactionHash; link.target = '_blank'; link.rel = 'noopener noreferrer';
    item.append(node('small', 'Заявлен хеш версии с ' + anchor.recordCount + ' событиями. Проверка через сеть обязательна.'), link); $('#anchor-list').append(item);
  }
}
$('#anchor-send').addEventListener('click', () => {
  if (!passport || !confirm('Запросить тестовую транзакцию в Sepolia? Сумма — 0 ETH, кошелёк покажет комиссию в тестовом ETH. Подтвердите её только в кошельке.')) return;
  const current = structuredClone(passport);
  run(async () => {
    const anchor = await sendAnchor(current, window.ethereum); current.anchors.push(anchor);
    await persistAndShow(current);
    status('Кошелёк вернул хеш транзакции. Дождитесь включения в блок и нажмите «Проверить в сети».', false, '#anchor-status');
  }, '#anchor-status');
});
$('#anchor-check').addEventListener('click', () => run(async () => {
  const current = passport; let verifiedCurrent = false, verifiedPrefix = 0;
  const results = [];
  for (const anchor of current.anchors) {
    const result = await verifyAnchor(current, anchor, window.ethereum);
    if (result.verified) { verifiedCurrent ||= result.current; verifiedPrefix = Math.max(verifiedPrefix, result.recordCount); }
    results.push(result.verified ? `${result.recordCount} событий: хеш совпал с транзакцией, ${result.finalized ? 'блок финализирован' : 'блок ещё не финализирован'}.` : result.reason);
  }
  text('#anchor-label', verifiedCurrent ? 'Хеш этой версии найден в Sepolia' : verifiedPrefix ? `В Sepolia подтверждены первые ${verifiedPrefix} событий` : 'Якорь не подтверждён сетью');
  status(results.join(' '), !verifiedPrefix, '#anchor-status');
}, '#anchor-status'));

function populateSigners() {
  for (const select of document.querySelectorAll('.signer-select')) {
    const previous = select.value; select.replaceChildren(new Option('Без подписи — черновик', ''));
    for (const item of profiles) select.add(new Option(item.profile.name + (unlocked.has(item.key) ? ' · разблокирован' : ' · заблокирован'), item.key));
    if (profiles.some(item => item.key === previous)) select.value = previous;
  }
}
for (const select of document.querySelectorAll('.signer-select')) select.addEventListener('change', () => {
  const profile = profiles.find(item => item.key === select.value)?.profile;
  if (profile) select.form.elements.actor.value = profile.name;
});
async function refreshKeys() {
  profiles = await list('profiles'); trusted = await list('trusted'); populateSigners(); renderKeys();
}
function renderKeys() {
  $('#profile-list').replaceChildren(); $('#trusted-list').replaceChildren();
  for (const item of profiles) {
    const row = node('section', undefined, 'key-card'); row.append(node('strong', item.profile.name), node('code', item.key, 'fingerprint'));
    const unlock = node('button', unlocked.has(item.key) ? 'Заблокировать' : 'Разблокировать'); unlock.type = 'button';
    unlock.onclick = () => { if (unlocked.has(item.key)) { unlocked.delete(item.key); populateSigners(); renderKeys(); } else requestUnlock(item.profile); };
    const exportKey = node('button', 'Скачать защищённый ключ ↓'); exportKey.type = 'button'; exportKey.onclick = () => download(JSON.stringify(item.profile, null, 2), 'wectas-key-' + item.key.slice(0,10) + '.json');
    row.append(unlock, exportKey); $('#profile-list').append(row);
  }
  for (const item of trusted) {
    const row = node('section', undefined, 'key-card'); row.append(node('strong', item.name + ' · отпечаток сверен вручную'), node('code', item.key, 'fingerprint'));
    const button = node('button', 'Убрать отметку доверия'); button.type = 'button';
    button.onclick = () => run(async () => { await remove('trusted', item.key); await refreshKeys(); if (passport) await showPassport(passport, savedKey); }, '#keys-status');
    row.append(button); $('#trusted-list').append(row);
  }
}
function requestUnlock(profile) { unlockPending = profile; text('#unlock-name', profile.name); text('#unlock-status', ''); $('#unlock-form').reset(); $('#unlock-dialog').showModal(); }
$('#unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); if (button.disabled || !unlockPending) return;
  const profile = unlockPending, password = form.elements.password.value; button.disabled = true;
  try { const key = await unlockIdentity(profile, password); if (unlockPending !== profile) return; unlocked.set(profile.fingerprint, key); $('#unlock-dialog').close(); populateSigners(); renderKeys(); status('Ключ разблокирован только в этой вкладке.', false, '#keys-status'); }
  catch (error) { text('#unlock-status', error.message); }
  finally { button.disabled = false; form.reset(); }
});
$('#unlock-dialog').addEventListener('close', () => { unlockPending = null; $('#unlock-form').reset(); });
$('#keys-button').addEventListener('click', () => { $('#keys-dialog').showModal(); run(refreshKeys, '#keys-status'); });
$('#key-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget, name = form.elements.name.value.trim(), password = form.elements.password.value;
  run(async () => { const identity = await createIdentity(name, password); await saveProfile(identity.profile); unlocked.set(identity.profile.fingerprint, identity.privateKey); form.reset(); await refreshKeys(); status('Ключ создан и разблокирован. Скачайте защищённую копию; запомните пароль.', false, '#keys-status'); }, '#keys-status');
});
$('#key-file').addEventListener('change', event => {
  const file = event.currentTarget.files[0]; event.currentTarget.value = ''; if (!file) return;
  run(async () => {
    if (file.size > 15_000) throw new Error('Файл ключа слишком большой.');
    let profile; try { profile = JSON.parse(await file.text()); } catch { throw new Error('Некорректный JSON ключа.'); }
    if (!validProfile(profile) || await hashBytes(unhex(profile.publicKey)) !== profile.fingerprint) throw new Error('Некорректный файл ключа.');
    await saveProfile(profile); unlocked.delete(profile.fingerprint); await refreshKeys(); status('Ключ импортирован. Разблокируйте его паролем перед подписью.', false, '#keys-status');
  }, '#keys-status');
});
$('#trust-form').addEventListener('submit', event => {
  event.preventDefault(); const data = formData(event.currentTarget), form = event.currentTarget;
  run(async () => { if (!isHash(data.fingerprint.toLowerCase())) throw new Error('Укажите полный отпечаток.'); await trustKey(data.fingerprint.toLowerCase(), data.name); form.reset(); await refreshKeys(); if (passport) await showPassport(passport, savedKey); status('Отпечаток отмечен как сверенный вами. Это не проверка со стороны Wectas.', false, '#keys-status'); }, '#keys-status');
});
$('#backup-button').addEventListener('click', () => $('#backup-dialog').showModal());
$('#backup-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget, password = form.elements.password.value;
  run(async () => { const data = await backupData(); download(JSON.stringify(await encryptJSON(data, password)), 'wectas-backup-' + date + '.json'); form.reset(); status('Зашифрованная копия подготовлена к скачиванию.', false, '#backup-status'); }, '#backup-status');
});
$('#restore-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget, file = form.elements.file.files[0], password = form.elements.password.value;
  run(async () => { if (!file || file.size > 45_000_000) throw new Error('Выберите резервную копию не более 45 МБ.'); const data = await decryptJSON(JSON.parse(await file.text()), password); const count = await restoreBackup(data); unlocked.clear(); await refreshKeys(); await refreshInventory(); form.reset(); if (passport) await showPassport(passport, savedKey); status('Проверено и восстановлено записей: ' + count + '. Ключи заблокированы.', false, '#backup-status'); }, '#backup-status');
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
async function openFromURL() {
  if (!location.hash.startsWith('#p=')) return;
  if (busy) { pendingURL = true; return; }
  mode('import'); run(async () => { clearPreview(); await showPassport(await decodePassport(location.hash.slice(3))); });
}
window.addEventListener('hashchange', openFromURL);
clearPreview();
(async () => {
  try { await list('passports'); storageAvailable = true; await refreshInventory(); await refreshKeys(); text('#storage-status', 'Данные хранятся на этом устройстве. Для переноса используйте резервную копию.'); }
  catch (error) { status(error.message, true, '#storage-status'); }
  $('#passport-form button[type=submit]').disabled = false; controls();
  if (location.hash.startsWith('#p=')) openFromURL();
  else if (inventory.length) run(() => showPassport(inventory[0].passport, inventory[0].key));
})();
