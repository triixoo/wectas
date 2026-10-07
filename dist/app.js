import { createPassport, verifyPassport, products } from './passport.js';
import { pilotMessage, telegramDraft } from './contact.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const setText = (selector, value) => { $(selector).textContent = value; };
const announce = text => setText('#demo-status', text);
let currentProduct = 'grain', passport = null, loadVersion = 0, tampered = false;
const wheat = '<path d="M122 146V27m0 102c-27-3-30-23-30-23s27 0 30 23Zm0-22c-27-3-30-23-30-23s27 0 30 23Zm0-22c-27-3-30-23-30-23s27 0 30 23Zm0-22c-24-3-26-23-26-23s24 0 26 23Zm0 56c27-3 30-23 30-23s-27 0-30 23Zm0-22c27-3 30-23 30-23s-27 0-30 23Zm0-22c24-3 26-23 26-23s-24 0-26 23Zm0-32s-15-16 0-30c15 14 0 30 0 30Z"/>';
const honey = '<path d="M93 35h54v15H93zm-2 16c-7 5-9 12-9 20v52c0 7 6 13 13 13h50c7 0 13-6 13-13V71c0-8-2-15-9-20M82 81h76m-76 36h76"/><path d="m108 88 12-7 12 7v14l-12 7-12-7V88Zm-12-33 12 7m25-7 12 7"/>';
const textile = '<path d="M66 48h104v83H66V48Zm10-13h105v86M66 64h104m-104 16h104m-104 16h104m-104 16h104M84 48v83m18-83v83m18-83v83m18-83v83m18-83v83M75 140h86"/>';
function art(key) {
  $('#product-art').innerHTML = '<svg viewBox="0 0 240 160"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ({ grain: wheat, honey, textile }[key]) + '</g></svg>';
}
function setBusy(busy) {
  ['#verify-button', '#download-passport', '#tamper-button'].forEach(selector => { $(selector).disabled = busy; });
}
function resetVerification() {
  $('.verification').classList.remove('verified', 'invalid');
  setText('#verify-icon', '◈');
  setText('#verify-title', 'История готова к проверке');
  setText('#verify-description', 'Каждая запись связана с предыдущей хешем SHA-256.');
}
function renderTimeline() {
  const list = $('#timeline');
  list.replaceChildren();
  for (const record of passport.records) {
    const li = document.createElement('li');
    if (tampered && record.index === 0) li.classList.add('tampered');
    const dot = document.createElement('span'); dot.className = 'timeline-dot'; dot.textContent = String(record.index + 1).padStart(2, '0');
    const body = document.createElement('div');
    const title = document.createElement('div'); title.className = 'timeline-title';
    const text = document.createElement('span'); text.textContent = record.event.title;
    const date = document.createElement('time'); date.dateTime = record.event.date; date.textContent = record.event.date.split('-').reverse().join('.');
    title.append(text, date);
    const description = document.createElement('p'); description.textContent = record.event.location + ' · ' + record.event.actor;
    const code = document.createElement('code'); code.textContent = 'SHA-256 / ' + record.hash.slice(0, 10) + '…' + record.hash.slice(-7); code.title = record.hash;
    body.append(title, description, code); li.append(dot, body); list.append(li);
  }
}
async function loadProduct(key) {
  if (!products[key]) return;
  const version = ++loadVersion;
  currentProduct = key; tampered = false; passport = null;
  setBusy(true); resetVerification(); art(key);
  setText('#tamper-button', 'Изменить запись ↗');
  $$('#demo [data-product]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.product === key)));
  const product = products[key].product;
  setText('#product-name', product.name); setText('#product-location', product.origin);
  setText('#product-batch', product.batch); setText('#product-category', product.category);
  $('#timeline').replaceChildren();
  try {
    const next = await createPassport(product, products[key].events);
    if (version !== loadVersion) return;
    passport = next; renderTimeline(); setBusy(false);
    announce('Паспорт «' + product.name + '» готов к проверке.');
  } catch (error) {
    if (version !== loadVersion) return;
    setText('#verify-title', 'Не удалось создать хеши'); setText('#verify-description', error.message); announce(error.message);
  }
}
$$('[data-product]').forEach(button => button.addEventListener('click', () => loadProduct(button.dataset.product)));
$$('[data-product-link]').forEach(link => link.addEventListener('click', () => loadProduct(link.dataset.productLink)));
$('#verify-button').addEventListener('click', async () => {
  if (!passport) return;
  const current = passport, version = loadVersion;
  setBusy(true);
  try {
    const result = await verifyPassport(current);
    if (version !== loadVersion) return;
    $('.verification').classList.toggle('verified', result.valid);
    $('.verification').classList.toggle('invalid', !result.valid);
    setText('#verify-icon', result.valid ? '✓' : '!');
    setText('#verify-title', result.valid ? 'Целостность подтверждена' : 'Обнаружено изменение');
    setText('#verify-description', result.valid ? 'Все 4 записи совпадают со своими хешами. Проверка локальная.' : 'Происхождение изменено. Хеш первой записи не совпадает.');
    announce(result.valid ? 'Все четыре записи прошли проверку целостности.' : 'Обнаружено изменение первой записи. Целостность нарушена.');
  } catch (error) { if (version === loadVersion) { setText('#verify-title', 'Проверка недоступна'); setText('#verify-description', error.message); } }
  finally { if (version === loadVersion) setBusy(false); }
});
$('#tamper-button').addEventListener('click', () => {
  if (!passport) return;
  if (tampered) { loadProduct(currentProduct); return; }
  tampered = true;
  passport.records[0].event.location = 'Неизвестное происхождение';
  renderTimeline(); resetVerification();
  setText('#tamper-button', 'Восстановить запись ↶');
  setText('#verify-title', 'Запись изменена — проверьте историю');
  setText('#verify-description', 'Сохранённый хеш остался прежним. Нажмите «Проверить».');
  announce('Происхождение первой записи изменено. Выполните проверку.');
});
function downloadJSON(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#download-passport').addEventListener('click', async () => {
  if (!passport) return;
  const current = structuredClone(passport);
  try {
    const verification = await verifyPassport(current);
    downloadJSON({ ...current, verification, exportedAt: new Date().toISOString(), notice: 'Вымышленный пример. Локальные хеши, без закрепления в блокчейн-сети.' }, 'wectas-passport-' + current.product.batch + '.json');
    announce('Паспорт подготовлен к скачиванию.');
  } catch (error) { announce(error.message); }
});
const menu = $('#mobile-nav'), toggle = $('.menu-toggle');
function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Открыть меню'); }
toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); toggle.setAttribute('aria-label', menu.hidden ? 'Открыть меню' : 'Закрыть меню'); });
$$('#mobile-nav a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
$$('[data-pilot]').forEach(button => button.addEventListener('click', () => { closeMenu(); $('#pilot-dialog').showModal(); }));
$('#privacy-button').addEventListener('click', () => $('#privacy-dialog').showModal());
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
});
$('#pilot-dialog').addEventListener('close', () => { $('#pilot-form').reset(); $('#pilot-send').hidden = true; $('#pilot-message').hidden = true; setText('#form-status', ''); });
$('#pilot-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  for (const field of ['name', 'email', 'company', 'task']) {
    data[field] = data[field].trim();
    if (!data[field]) { event.currentTarget.elements.namedItem(field).focus(); setText('#form-status', 'Заполните поля текстом, пожалуйста.'); return; }
  }
  const message = pilotMessage(data);
  $('#pilot-message').value = message; $('#pilot-message').hidden = false;
  $('#pilot-send').href = telegramDraft(message); $('#pilot-send').hidden = false;
  setText('#form-status', 'Сообщение готово. Откройте чат @kashyyn и отправьте его в Telegram. Сайт не подтверждает доставку.');
});
$('#pilot-copy').addEventListener('click', async () => {
  const message = $('#pilot-message');
  if (message.hidden) { setText('#form-status', 'Сначала подготовьте заявку.'); return; }
  try { await navigator.clipboard.writeText(message.value); setText('#form-status', 'Текст скопирован. Отправьте его @kashyyn.'); }
  catch { message.focus(); message.select(); setText('#form-status', 'Скопируйте выделенный текст вручную.'); }
});
$('#pilot-download').addEventListener('click', () => {
  if ($('#pilot-message').hidden) { setText('#form-status', 'Сначала подготовьте заявку.'); return; }
  downloadJSON({ project: 'Wectas', type: 'pilot-brief', message: $('#pilot-message').value, createdAt: new Date().toISOString(), submitted: false }, 'wectas-pilot-brief.json');
});
$('#pilot-form').addEventListener('input', () => { $('#pilot-send').hidden = true; $('#pilot-message').hidden = true; setText('#form-status', ''); });
$('#pilot-form button[type=submit]').disabled = false;

// Draw a dimensional network directly; no external image or WebGL dependency.
function startNetwork() {
  const canvas = $('#network'), context = canvas.getContext('2d');
  if (!context) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let width, height, visible = true, frame = null, angle = .3;
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduce.matches || !visible) draw();
  }
  function project(u, v) {
    const major = 1.05, minor = .61 + .055 * Math.sin(3 * u + v);
    let x = (major + minor * Math.cos(v)) * Math.cos(u), y = minor * Math.sin(v), z = (major + minor * Math.cos(v)) * Math.sin(u);
    const ry = .8 + angle, rx = .8, rz = -.56;
    [x, z] = [x * Math.cos(ry) - z * Math.sin(ry), x * Math.sin(ry) + z * Math.cos(ry)];
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    const scale = Math.min(width * .29, height * .27), perspective = 4.6 / (4.6 + z);
    return { x: width / 2 + x * scale * perspective, y: height * .5 + y * scale * perspective, depth: z };
  }
  function draw() {
    if (!width) return;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * .53);
    glow.addColorStop(0, '#74964225'); glow.addColorStop(1, '#74964200'); context.fillStyle = glow; context.fillRect(0, 0, width, height);
    const rings = 40, segments = 115;
    for (let ring = 0; ring < rings; ring++) {
      const v = ring / rings * Math.PI * 2;
      for (let step = 0; step < segments; step++) {
        const u = step / segments * Math.PI * 2, point = project(u, v), next = project((step + 1) / segments * Math.PI * 2, v);
        const opacity = .07 + ((1.9 - point.depth) / 3.8) * .42;
        context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(next.x, next.y); context.strokeStyle = `rgba(208,237,139,${opacity})`; context.lineWidth = .65; context.stroke();
        if (step % 5 === 0 && ring % 3 === 0) { context.beginPath(); context.arc(point.x, point.y, point.depth < -.8 ? 1.3 : .75, 0, Math.PI * 2); context.fillStyle = `rgba(224,249,174,${opacity + .1})`; context.fill(); }
      }
    }
    for (let ring = 0; ring < 20; ring++) {
      const u = ring / 20 * Math.PI * 2;
      context.beginPath();
      for (let step = 0; step <= 40; step++) { const point = project(u, step / 40 * Math.PI * 2); if (step === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); }
      context.strokeStyle = '#d0ed8b1c'; context.lineWidth = .5; context.stroke();
    }
  }
  let previousTime = 0;
  function tick(time) { frame = null; if (!visible || document.hidden || reduce.matches) return; if (time - previousTime >= 40) { angle += .002; draw(); previousTime = time; } frame = requestAnimationFrame(tick); }
  function update() { if (frame !== null) cancelAnimationFrame(frame); frame = null; if (visible && !document.hidden && !reduce.matches) frame = requestAnimationFrame(tick); else draw(); }
  new ResizeObserver(resize).observe(canvas.parentElement);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }).observe(canvas);
  document.addEventListener('visibilitychange', update); reduce.addEventListener('change', update);
  resize(); draw(); update();
}
loadProduct('grain');
startNetwork();
