import { pilotMessage, telegramDraft } from './contact.js';
const $ = selector => document.querySelector(selector);
let brief = null;
$('#business-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  for (const key of Object.keys(data)) data[key] = data[key].trim();
  if (['name', 'company', 'industry', 'task'].some(key => !data[key])) { $('#business-status').textContent = 'Заполните обязательные поля текстом.'; return; }
  brief = { project: 'Wectas', type: 'pilot-brief', createdAt: new Date().toISOString(), ...data, submitted: false };
  const message = pilotMessage(data); $('#business-message').value = message; $('#business-send').href = telegramDraft(message);
  $('#business-result').hidden = false; $('#business-status').textContent = 'Заявка подготовлена. Отправьте её в Telegram.';
});
$('#business-form').addEventListener('input', () => { brief = null; $('#business-result').hidden = true; $('#business-status').textContent = ''; });
$('#business-copy').addEventListener('click', async () => {
  if (!brief) return;
  try { await navigator.clipboard.writeText($('#business-message').value); $('#business-status').textContent = 'Текст скопирован. Отправьте его @kashyyn.'; }
  catch { $('#business-message').select(); $('#business-status').textContent = 'Скопируйте выделенный текст вручную.'; }
});
$('#business-download').addEventListener('click', () => {
  if (!brief) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'wectas-pilot-brief.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  $('#business-status').textContent = 'Бриф подготовлен к скачиванию. Команде не отправлен.';
});
$('#business-form button[type=submit]').disabled = false;
