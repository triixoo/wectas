const summary = document.querySelector('#monitor-summary'), list = document.querySelector('#monitor-sources');
try {
  const response = await fetch('market-watch.json',{cache:'no-store'});
  if(!response.ok)throw new Error('no snapshot');
  const report = await response.json();
  if(!Array.isArray(report.sources)||typeof report.checkedAt!=='string')throw new Error('bad snapshot');
  summary.textContent = 'Последняя проверка: ' + new Date(report.checkedAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}) + ' (Алматы).';
  const labels = {new:'Первый снимок',changed:'Есть изменения',unchanged:'Без изменений',error:'Проверка не удалась'};
  for(const source of report.sources){
    const url = new URL(source.url);if(url.protocol!=='https:')continue;
    const item = document.createElement('li'), link = document.createElement('a'), state = document.createElement('span');
    link.href=url.href;link.textContent=source.name+' ↗';link.target='_blank';link.rel='noopener noreferrer';
    state.textContent=labels[source.status]||'Не проверено';item.append(link,state);list.append(item);
  }
}catch{summary.textContent='Первый автоматический отчёт ещё не опубликован. Исследование выше проверено вручную 7 октября 2026 года.';}
