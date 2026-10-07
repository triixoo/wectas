export const TELEGRAM = 'kashyyn';
export const CONTACT_URL = 'https://t.me/' + TELEGRAM;
export function pilotMessage(data) {
  const clean = (value, max) => String(value ?? '').trim().slice(0, max);
  return ['Заявка на пилот Wectas', 'Компания: ' + clean(data.company, 160), 'Контакт: ' + clean(data.name, 100),
    data.email ? 'Email: ' + clean(data.email, 200) : '', 'Продукция: ' + clean(data.industry, 160),
    data.batches ? 'Количество партий: ' + clean(data.batches, 10) : '', 'Задача: ' + clean(data.task, 1200),
    'Хочу обсудить объём, стоимость и сроки ограниченного пилота.'].filter(Boolean).join('\n');
}
export function telegramDraft(message) {
  const url = new URL(CONTACT_URL); url.searchParams.set('text', message); return url.href;
}
