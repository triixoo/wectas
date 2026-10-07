import { createPassport, verifyPassport, hasValidSchema } from './passport.js';
import { encodePassport, decodePassport, passportURL } from './share.js';
import qrcode from './vendor/qrcode.mjs';

const $ = selector => document.querySelector(selector);
const text = (selector, value) => { $(selector).textContent = value; };
let passport = null, version = 0, svg = '';
const today = new Date();
$('#passport-form').elements.date.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

function status(message, error = false) { text('#workspace-status', message); $('#workspace-status').classList.toggle('error', error); }
function mode(importing) {
  $('#create-panel').hidden = importing; $('#import-panel').hidden = !importing;
  $('#create-tab').setAttribute('aria-pressed', String(!importing)); $('#import-tab').setAttribute('aria-pressed', String(importing));
}
$('#create-tab').addEventListener('click', () => mode(false));
$('#import-tab').addEventListener('click', () => mode(true));

function clearPreview() {
  passport = null;
  $('#export-json').disabled = true; $('#share-passport').disabled = true;
  text('#preview-name','Паспорт ещё не создан'); text('#preview-origin','Заполните форму или загрузите JSON.');
  text('#preview-kind','—'); text('#preview-batch','—'); text('#preview-category','—'); text('#preview-count','—');
  text('#integrity-symbol','○'); text('#integrity-label','Целостность не проверена');
  $('.evidence-status').classList.remove('invalid'); $('#preview-timeline').replaceChildren(); $('#root-hash').hidden = true;
}
async function showPassport(value, generation) {
  if (!hasValidSchema(value)) throw new Error('Неверный формат паспорта Wectas.');
  const result = await verifyPassport(value);
  if (generation !== version) return;
  passport = value;
  text('#preview-name', value.product.name); text('#preview-origin', value.product.origin);
  text('#preview-kind', value.demo ? 'ДЕМОНСТРАЦИЯ' : 'ЛОКАЛЬНЫЙ ЧЕРНОВИК');
  text('#preview-batch',value.product.batch); text('#preview-category',value.product.category); text('#preview-count',String(value.records.length));
  text('#integrity-symbol',result.valid ? '✓' : '!');
  text('#integrity-label',result.valid ? 'Целостность записей подтверждена' : 'Целостность нарушена: запись изменена');
  $('.evidence-status').classList.toggle('invalid',!result.valid);
  const list = $('#preview-timeline'); list.replaceChildren();
  for (const record of value.records) {
    const item = document.createElement('li');
    if (!result.valid && record.index === result.index) item.classList.add('invalid');
    const title = document.createElement('strong'); title.textContent = record.event.title;
    const actor = document.createElement('span'); actor.textContent = record.event.actor;
    const location = document.createElement('span'); location.textContent = record.event.location + ' · ' + record.event.date;
    item.append(title,actor,location); list.append(item);
  }
  $('#root-hash').hidden = false; text('#root-value', value.records.at(-1).hash);
  $('#export-json').disabled = false; $('#share-passport').disabled = !result.valid;
  status(result.valid ? 'Паспорт готов. Записи согласованы; происхождение и производитель независимо не проверены.' : 'Обнаружено изменение записи. Не используйте этот паспорт как подтверждение происхождения.',!result.valid);
}
$('#passport-form').addEventListener('submit',async event=>{
  event.preventDefault(); const generation = ++version;
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(data)) data[key] = data[key].trim();
  for (const key of ['name','batch','origin','actor','date']) {
    if (!data[key]) { status('Заполните обязательные поля текстом.',true); form.elements[key].focus(); return; }
  }
  clearPreview(); status('Создаём паспорт и вычисляем хеш…');
  try {
    const created = await createPassport({name:data.name,batch:data.batch,origin:data.origin,category:data.category},[
      {title:'Партия зарегистрирована производителем',actor:data.actor,location:data.origin,date:data.date}
    ],{demo:false});
    await showPassport(created,generation);
  } catch(error) { if(generation===version)status(error.message,true); }
});
$('#passport-file').addEventListener('change',async event=>{
  const file = event.currentTarget.files[0]; if(!file)return;
  const generation = ++version; clearPreview();status('Читаем файл и проверяем цепочку…');
  try {
    if(file.size>100_000)throw new Error('Размер файла превышает 100 КБ.');
    let value; try { value=JSON.parse(await file.text()); } catch {throw new Error('Файл не является корректным JSON.');}
    await showPassport(value,generation);
  } catch(error){if(generation===version)status(error.message,true);}
  finally {event.target.value='';}
});
function download(data, name, type) {
  const url=URL.createObjectURL(new Blob([data],{type})); const link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#export-json').addEventListener('click',async()=>{
  if(!passport)return; const current=structuredClone(passport);
  try {
    const verification=await verifyPassport(current);
    const name=current.product.batch.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'draft';
    download(JSON.stringify({...current,verification,exportedAt:new Date().toISOString(),notice:'Локальный паспорт. Нет подписей участников и независимого закрепления в блокчейне.'},null,2),'wectas-'+name+'.json','application/json');
  }catch(error){status(error.message,true);}
});
$('#share-passport').addEventListener('click',async()=>{
  if(!passport)return; const current=passport, generation=version;
  $('#share-passport').disabled=true;
  try {
    const encoded=await encodePassport(current); const url=passportURL(encoded,location.href);
    if(generation!==version)return;
    $('#share-url').value=url;text('#share-status','');
    const qr=qrcode(0,'L');qr.addData(url);qr.make();
    svg=qr.createSvgTag({cellSize:4,margin:16,scalable:true});$('#qr-code').innerHTML=svg;
    $('#share-dialog').showModal();
  }catch(error){if(generation===version)status('Не удалось подготовить ссылку. Скачайте JSON-паспорт. '+error.message,true);}
  finally{if(generation===version)$('#share-passport').disabled=false;}
});
$('#share-close').addEventListener('click',()=>$('#share-dialog').close());
$('#copy-link').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('#share-url').value);text('#share-status','Ссылка скопирована.');}
  catch{$('#share-url').select();text('#share-status','Ссылка выделена. Скопируйте её вручную.');}
});
$('#download-qr').addEventListener('click',()=>{if(svg)download(svg,'wectas-passport-qr.svg','image/svg+xml');});
$('#share-dialog').addEventListener('click',event=>{
  if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();
  if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.currentTarget.close();
});
async function openFromURL(){
  if(!location.hash.startsWith('#p='))return;
  mode(true); const generation=++version;clearPreview();status('Открываем паспорт из ссылки…');
  try{await showPassport(await decodePassport(location.hash.slice(3)),generation);}
  catch(error){if(generation===version)status(error.message,true);}
}
clearPreview();
$('#passport-form button[type="submit"]').disabled = false;
window.addEventListener('hashchange',openFromURL);
openFromURL();
