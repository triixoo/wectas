import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const sources = JSON.parse(await readFile(project+'research/sources.json','utf8'));
let previous = {sources:[]};
try {previous=JSON.parse(await readFile(project+'dist/market-watch.json','utf8'));}catch{}
const checkedAt = new Date().toISOString();
async function boundedText(response) {
  const reader=response.body.getReader(), chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>2_000_000){await reader.cancel();throw new Error('Response exceeded 2 MB');}chunks.push(value);}
  }finally{reader.releaseLock();}
  return new Blob(chunks).text();
}
function normalize(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g,' ').replace(/\s+/g,' ').trim();
}
const results=await Promise.all(sources.map(async source=>{
  const old=previous.sources.find(item=>item.id===source.id);
  try{
    const response=await fetch(source.url,{signal:AbortSignal.timeout(20_000),headers:{'User-Agent':'Wectas-Market-Watch/1.0 (public-source-monitor)','Accept':'text/html'}});
    if(!response.ok)throw new Error('HTTP '+response.status);
    if(!response.headers.get('content-type')?.includes('text/html'))throw new Error('Unexpected content type');
    const visible=normalize(await boundedText(response));if(visible.length<100)throw new Error('Not enough visible text');
    const contentHash=createHash('sha256').update(visible).digest('hex');
    const status=!old?.contentHash?'new':old.contentHash===contentHash?'unchanged':'changed';
    return {...source,status,httpStatus:response.status,contentHash,previousHash:old?.contentHash??null,checkedAt};
  }catch(error){
    return {...source,status:'error',error:String(error.message).slice(0,160),contentHash:old?.contentHash??null,checkedAt};
  }
}));
const snapshot={checkedAt,meaning:'Changes are page-level signals, not verified market facts.',sources:results};
await writeFile(project+'dist/market-watch.json',JSON.stringify(snapshot,null,2)+'\n');
const rows=results.map(item=>`| [${item.name}](${item.url}) | ${item.status} | ${item.status==='error'?item.error:'HTTP '+item.httpStatus} |`);
const date=checkedAt.slice(0,10);
const report=`# Wectas: мониторинг источников ${date}\n\nПроверка: ${checkedAt}. Хешируется нормализованный текст страницы, включая возможные изменения меню. Это сигнал для ручного разбора, а не подтверждение новых фактов, законов или функций конкурента. Недоступный источник не считается неизменившимся.\n\n| Источник | Состояние | Результат |\n| --- | --- | --- |\n${rows.join('\n')}\n\n## Следующая итерация\n\n1. Просмотреть изменившиеся первоисточники и определить, есть ли изменение по существу.\n2. Обновить research/MARKET.md только после проверки, указав источники и дату.\n3. Выбрать одну задачу из BACKLOG.md, реализовать ее, проверить npm test и браузер, затем описать результат в CHANGELOG.md.\n\nАвтоматизирован мониторинг и публикация его статуса. Разработка новых функций требует агента с доступом записи в GitHub; этот скрипт не выдает себя за такого агента.\n`;
await mkdir(project+'research',{recursive:true});
await writeFile(project+'research/monitor-latest.md',report);
if(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_TOKEN&&process.env.GITHUB_REPOSITORY){
  const base='https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY;
  const headers={'Authorization':'Bearer '+process.env.GITHUB_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'};
  const title='Wectas: мониторинг рынка '+date;
  const listing=await fetch(base+'/issues?state=all&per_page=100',{headers});
  if(!listing.ok)throw new Error('Could not read existing market issues: HTTP '+listing.status);
  const existing=(await listing.json()).find(issue=>!issue.pull_request&&issue.title===title);
  const target=existing?base+'/issues/'+existing.number:base+'/issues';
  const response=await fetch(target,{method:existing?'PATCH':'POST',headers,body:JSON.stringify({title,body:report})});
  if(!response.ok)throw new Error('Could not save market issue: HTTP '+response.status);
  console.log('Market issue: '+(await response.json()).html_url);
}
console.log(JSON.stringify({checkedAt,available:results.filter(source=>source.status!=='error').length,total:results.length}));
if(results.every(source=>source.status==='error'))process.exitCode=1;
