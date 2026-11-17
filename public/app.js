let videos = [];
let featuredVideoId = null;
let catalogStats = {base:0,removals:0,hidden:0,remaining:0};

const PAGE_SIZE = 48;
const state = {category:'Todos',nav:'inicio',query:'',sort:'featured',favorites:new Set(readFavorites()),showAll:false,page:1,current:null,playing:false,elapsed:0,raf:0,toastTimer:0};
const $ = (selector, root=document) => root.querySelector(selector);
const grid = $('#videoGrid');
const backdrop = $('#detailBackdrop');
const playerWrap = $('#playerWrap');
const canvas = $('#previewCanvas');
const ctx = canvas.getContext('2d');
const duration = 24;

function readFavorites(){try{return JSON.parse(localStorage.getItem('filtrox-favorites')||localStorage.getItem('velvet-favorites')||'[]')}catch{return []}}
function saveFavorites(){try{localStorage.setItem('filtrox-favorites',JSON.stringify([...state.favorites]))}catch{}}
function safeSourceLabel(sourceUrl){try{const url=new URL(sourceUrl,location.href);return `${url.origin}${url.pathname}`}catch{return 'fonte CSV'}}
function isHttpUrl(value){return /^https?:\/\//i.test(String(value||'').trim())}
function normalizeUrlKey(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{const url=new URL(raw);return `${url.hostname.toLowerCase().replace(/^www\./,'')}${url.pathname.toLowerCase().replace(/\/+$/,'')}`}catch{return raw.replace(/\/+$/,'').toLowerCase()}
}
function rowUrl(row,preferredIndex){
  const preferred=String(row?.[preferredIndex]||'').trim();
  return isHttpUrl(preferred)?preferred:String(row?.find?.(isHttpUrl)||'').trim();
}
function parseCsvRows(text,delimiter,label){
  const parsed=window.Papa.parse(text,{delimiter,header:false,skipEmptyLines:'greedy'});
  if(parsed.errors?.length)console.warn(`[FILTROX] ${label}: ${parsed.errors.length} aviso(s) de parsing CSV.`);
  return parsed.data.filter(row=>Array.isArray(row)&&row.some(value=>String(value??'').trim()));
}
function stableVideoId(url){
  const match=String(url).match(/\/video\.([a-z0-9]+)/i);
  if(match)return `xv-${match[1].toLowerCase()}`;
  let hash=2166136261;
  for(const char of String(url)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
  return `video-${(hash>>>0).toString(36)}`;
}
function displayCategory(value){return String(value||'Outros').replace(/[_-]+/g,' ').replace(/\b[a-z]/gi,char=>char.toUpperCase())}
function normalizeVideo(row,index,url){
  const columns=window.FILTROX_CONFIG?.baseColumns||{};
  const value=name=>String(row[columns[name]]??'').trim();
  const tags=[...new Set(`${value('tags')},${value('cast')}`.split(/[|,]/).map(tag=>tag.trim()).filter(Boolean))].slice(0,16);
  const seconds=Number.parseFloat(value('duration').replace(/[^\d.]/g,''))||0;
  const uploadedAt=value('uploadedAt');
  const year=Number(uploadedAt.match(/\b(19|20)\d{2}\b/)?.[0])||0;
  return {
    id:stableVideoId(url),url,ordinal:index+1,
    title:value('title')||`Vídeo ${index+1}`,
    subtitle:value('cast')||value('publisher')||'Vídeo do catálogo',
    creator:value('publisher')||'Fonte externa',
    category:value('category')||'Outros',
    duration:Math.max(1,Math.round(seconds/60)),
    rating:'—',year,
    publishedAt:uploadedAt,
    description:tags.length?`Tags: ${tags.slice(0,8).join(', ')}`:'Vídeo do catálogo',
    tags,art:`art-${(index%12)+1}`,
    badge:value('quality')||'CATÁLOGO',
    views:Number.parseInt(value('views').replace(/[^\d]/g,''),10)||0
  };
}
function updateFeaturedVideo(video){
  if(!video)return;
  featuredVideoId=video.id;
  $('#heroTitle').textContent=video.title;
  $('.hero-description').textContent=video.subtitle||video.description;
  $('.hero-copy .eyebrow').textContent=`FILTROX · ${displayCategory(video.category)} · ${video.duration} MIN`;
  $('.hero-meta').textContent=`${displayCategory(video.category)} · ${video.year||'—'} · ${video.badge}`;
  $('.hero-serial').textContent='CATÁLOGO FILTROX';
}
function renderCategoryFilters(){
  const counts=new Map();
  for(const video of videos)counts.set(video.category,(counts.get(video.category)||0)+1);
  const categories=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'pt-BR')).slice(0,4).map(([category])=>category);
  const row=$('#filterRow');
  const sortControl=$('.sort-control',row);
  row.querySelectorAll('.filter-chip').forEach(button=>button.remove());
  const createChip=(category,label,isSelected=false,count=null)=>{
    const button=document.createElement('button');
    button.type='button';button.className=`filter-chip${isSelected?' is-selected':''}`;button.dataset.category=category;
    button.append(document.createTextNode(label));
    if(count!==null){const span=document.createElement('span');span.textContent=String(count);button.append(' ',span)}
    row.insertBefore(button,sortControl);
  };
  createChip('Todos','Tudo',state.category==='Todos',videos.length);
  categories.forEach(category=>createChip(category,displayCategory(category),state.category===category));
  const sideButtons=[...document.querySelectorAll('[data-filter]')];
  sideButtons.forEach((button,index)=>{
    const category=categories[index];
    button.hidden=!category;
    if(!category)return;
    button.dataset.filter=category;
    const icon=button.querySelector('.nav-icon');
    button.replaceChildren(...(icon?[icon]:[]),document.createTextNode(displayCategory(category)));
  });
}
function showCatalogLoadError(error,sourceUrl){
  console.error(`[FILTROX] Falha ao carregar ${safeSourceLabel(sourceUrl)} (${error?.name||'erro'}).`);
  $('#searchSummary').textContent='Não foi possível carregar o catálogo de vídeos.';
  $('#emptyState').hidden=false;
  $('#loadMore').hidden=true;
}
async function loadVideos(){
  const config=window.FILTROX_CONFIG||{};
  const baseUrl=config.baseCsvUrl||'';
  const removalUrl=config.removalCsvUrl||'';
  if(!window.Papa){showCatalogLoadError(new Error('PapaParse indisponível.'),baseUrl||location.href);return}
  if(!baseUrl||!removalUrl){showCatalogLoadError(new Error('URLs dos dois CSVs não configuradas.'),baseUrl||location.href);return}
  try{
    const [baseResponse,removalResponse]=await Promise.all([fetch(baseUrl,{cache:'no-store'}),fetch(removalUrl,{cache:'no-store'})]);
    if(!baseResponse.ok)throw new Error(`base HTTP ${baseResponse.status}`);
    if(!removalResponse.ok)throw new Error(`remoções HTTP ${removalResponse.status}`);
    const [baseText,removalText]=await Promise.all([baseResponse.text(),removalResponse.text()]);
    const baseRows=parseCsvRows(baseText,config.baseDelimiter||';','base');
    const removalRows=parseCsvRows(removalText,config.removalDelimiter||'|','remoções');
    const baseColumn=Number.isInteger(config.baseUrlColumn)?config.baseUrlColumn:0;
    const removalColumn=Number.isInteger(config.removalUrlColumn)?config.removalUrlColumn:1;
    const removalKeys=new Set(removalRows.map(row=>normalizeUrlKey(rowUrl(row,removalColumn))).filter(Boolean));
    if(!baseRows.length||!removalKeys.size)throw new Error('CSV base ou lista de remoções vazia/inválida.');
    const seen=new Set();
    let hidden=0;
    videos=[];
    for(let index=0;index<baseRows.length;index++){
      const row=baseRows[index];
      if(index===0&&String(row[baseColumn]||'').trim().toLowerCase()===String(config.keyField||'url').toLowerCase())continue;
      const url=rowUrl(row,baseColumn);
      const key=normalizeUrlKey(url);
      if(!key)continue;
      if(removalKeys.has(key)){hidden++;continue}
      if(seen.has(key))continue;
      seen.add(key);
      const video=normalizeVideo(row,index,url);
      video.ordinal=videos.length+1;
      videos.push(video);
    }
    catalogStats={base:baseRows.length,removals:removalKeys.size,hidden,remaining:videos.length};
    if(!videos.length)throw new Error('Nenhum registro restante após cruzar as remoções.');
    updateFeaturedVideo(videos[0]);
    renderCategoryFilters();
    console.info(`[FILTROX] base=${catalogStats.base}; remoções=${catalogStats.removals}; ocultados=${catalogStats.hidden}; exibidos=${catalogStats.remaining}.`);
    render();
  }catch(error){showCatalogLoadError(error,baseUrl)}
}
function visibleVideos(){
  let items=[...videos];
  if(state.nav==='favoritos') items=items.filter(v=>state.favorites.has(v.id));
  if(state.nav==='recentes') items=items.filter(v=>v.year===Math.max(0,...videos.map(video=>video.year)));
  if(state.category!=='Todos') items=items.filter(v=>v.category===state.category);
  if(state.query){const q=state.query.toLocaleLowerCase('pt-BR');items=items.filter(v=>[v.title,v.subtitle,v.creator,v.category,v.description,...v.tags].join(' ').toLocaleLowerCase('pt-BR').includes(q))}
  if(state.sort==='newest') items.sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0) || a.title.localeCompare(b.title,'pt-BR'));
  if(state.sort==='az') items.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
  if(state.nav==='em-alta'&&state.sort==='featured') items.sort((a,b)=>b.views-a.views);
  return items;
}
function posterMarkup(video){return `<div class="card-cover ${video.art}" role="img" aria-label="Arte abstrata original de ${escapeHtml(video.title)}"><span class="art-shape shape-a"></span><span class="art-shape shape-b"></span><span class="art-shape shape-c"></span><div class="cover-topline"><span class="cover-series">FILTROX · ${escapeHtml(video.badge)}</span><span class="cover-duration">${video.duration} MIN</span></div><span class="cover-bottom">Nº ${String(video.ordinal).padStart(2,'0')} &nbsp;—&nbsp; ${escapeHtml(displayCategory(video.category).toUpperCase())}</span><button class="cover-play" data-open="${video.id}" aria-label="Abrir ${escapeHtml(video.title)}"><span class="play-triangle"></span></button></div>`}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function render(){
  const items=visibleVideos();
  const shown=items.slice(0,state.page*PAGE_SIZE);
  grid.innerHTML=shown.map((v,index)=>`<article class="video-card" style="animation-delay:${Math.min(index*15,250)}ms">${posterMarkup(v)}<div class="card-info"><div><button class="card-title-button" data-open="${v.id}">${escapeHtml(v.title)}</button><p class="card-subtitle">${escapeHtml(v.subtitle)}</p><p class="card-type">${escapeHtml(displayCategory(v.category))} <i></i> ${v.year||'—'}</p></div><div class="card-side"><span class="card-rating"><span>✳</span> ${escapeHtml(v.rating)}</span><button class="save-button ${state.favorites.has(v.id)?'is-saved':''}" data-save="${v.id}" aria-label="${state.favorites.has(v.id)?'Remover':'Adicionar'} ${escapeHtml(v.title)} ${state.favorites.has(v.id)?'da':'à'} minha lista" aria-pressed="${state.favorites.has(v.id)}">${state.favorites.has(v.id)?'♥':'＋'}</button></div></div></article>`).join('');
  $('#emptyState').hidden=items.length>0;
  $('#loadMore').hidden=shown.length>=items.length;
  $('#loadMore').innerHTML=`CARREGAR MAIS (${Math.max(0,items.length-shown.length).toLocaleString('pt-BR')}) <span aria-hidden="true">＋</span>`;
  $('#searchSummary').textContent=state.query?`${items.length.toLocaleString('pt-BR')} ${items.length===1?'resultado':'resultados'} para “${state.query}”`:`${items.length.toLocaleString('pt-BR')} vídeos · ${catalogStats.hidden.toLocaleString('pt-BR')} ocultados pela lista de remoções`;
  $('#savedCount').textContent=state.favorites.size||'';
  const chip=$('#filterRow .filter-chip[data-category="Todos"] span'); if(chip)chip.textContent=String(items.length);
}
function setNav(nav,label){
  state.nav=nav;state.category='Todos';state.page=1;
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('is-active',el.dataset.nav===nav));
  document.querySelectorAll('.filter-chip').forEach(el=>el.classList.toggle('is-selected',el.dataset.category==='Todos'));
  const labels={'inicio':'DESCOBRIR','em-alta':'EM ALTA','recentes':'ADICIONADOS','favoritos':'MINHA LISTA'};
  $('#crumbTitle').textContent=labels[nav]||String(label||nav).toUpperCase();
  const heading={'inicio':['A ESCOLHA DA NOITE','Descubra algo <em>novo.</em>'],'em-alta':['O QUE ESTÁ EM MOVIMENTO','Em alta <em>agora.</em>'],'recentes':['CHEGARAM POR ÚLTIMO','Novas <em>histórias.</em>'],'favoritos':['SEU ESPAÇO PESSOAL','Sua <em>lista.</em>']};
  const data=heading[nav]||['COLEÇÃO FILTROX',`${escapeHtml(label||nav)} <em>selecionados.</em>`];
  $('#sectionKicker').innerHTML=`${data[0]} <span>·</span> FILTROX ORIGINALS`;
  $('#sectionTitle').innerHTML=data[1];
  $('#hero').hidden=nav!=='inicio';
  $('#sectionTitle').scrollIntoView({behavior:'smooth',block:'nearest'});
  closeMobileNav();render();
}
function setCategory(category){
  state.nav='inicio';state.category=category;state.page=1;
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.remove('is-active'));
  document.querySelectorAll('.filter-chip').forEach(el=>el.classList.toggle('is-selected',el.dataset.category===category));
  $('#crumbTitle').textContent=category==='Todos'?'DESCOBRIR':category.toUpperCase();
  $('#sectionKicker').innerHTML=`COLEÇÃO ${category==='Todos'?'FILTROX':category.toUpperCase()} <span>·</span> CURADORIA ORIGINAL`;
  $('#sectionTitle').innerHTML=category==='Todos'?'Descubra algo <em>novo.</em>':`${escapeHtml(category)} <em>selecionados.</em>`;
  $('#hero').hidden=category!=='Todos';
  render();
}
function toggleFavorite(id){
  const video=videos.find(v=>v.id===id);if(!video)return;
  if(state.favorites.has(id)){state.favorites.delete(id);showToast('Removido da sua lista')}else{state.favorites.add(id);showToast('Adicionado à sua lista')}
  saveFavorites();render();
  if(state.current?.id===id)$('#modalSave').innerHTML=`<span class="save-icon">${state.favorites.has(id)?'✓':'＋'}</span> ${state.favorites.has(id)?'Na minha lista':'Minha lista'}`;
}
function openDetails(id){
  const v=videos.find(item=>item.id===id);if(!v)return;
  state.current=v;state.elapsed=0;pausePreview();playerWrap.hidden=true;
  $('#modalKicker').textContent=`${v.category.toUpperCase()} ORIGINAL · ${v.badge}`;
  $('#modalTitle').textContent=v.title;
  $('#modalMeta').innerHTML=`<span>FILTROX ORIGINALS</span><i></i><span>${v.year}</span><i></i><span>${v.duration} MIN</span><i></i><span>✳ ${v.rating}</span>`;
  $('#modalDescription').textContent=v.description;
  $('#modalTags').innerHTML=v.tags.map(tag=>`<span class="modal-tag">${escapeHtml(tag.toUpperCase())}</span>`).join('');
  const art=$('#modalArt');art.className=`modal-art ${v.art}`;art.innerHTML=`<span class="modal-art-label">FILTROX ORIGINAL</span><span class="modal-art-index">Nº ${String(videos.indexOf(v)+1).padStart(2,'0')}</span><span class="art-shape shape-a"></span><span class="art-shape shape-b"></span><span class="art-shape shape-c"></span>`;
  $('#modalSave').innerHTML=`<span class="save-icon">${state.favorites.has(v.id)?'✓':'＋'}</span> ${state.favorites.has(v.id)?'Na minha lista':'Minha lista'}`;
  backdrop.hidden=false;document.body.style.overflow='hidden';$('#closeModal').focus();
}
function closeDetails(){pausePreview();backdrop.hidden=true;document.body.style.overflow='';state.current=null;}
function showToast(text){const toast=$('#toast');toast.textContent=text;toast.classList.add('is-visible');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>toast.classList.remove('is-visible'),1900)}
function closeMobileNav(){$('#sidebar').classList.remove('is-open');$('#mobileScrim').classList.remove('is-open')}
function drawPreview(seconds){
  const w=canvas.width,h=canvas.height,t=seconds;
  const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#14191c');bg.addColorStop(.45,'#46302f');bg.addColorStop(1,'#111415');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  const glow=ctx.createRadialGradient(w*(.52+Math.sin(t*.16)*.08),h*(.39+Math.cos(t*.12)*.04),8,w*.52,h*.4,w*.46);glow.addColorStop(0,'rgba(240,177,137,.55)');glow.addColorStop(.28,'rgba(188,104,91,.23)');glow.addColorStop(1,'rgba(14,17,19,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  const cx=w*(.53+Math.sin(t*.17)*.035),cy=h*.38,r=88+Math.sin(t*.28)*4;
  for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(cx,cy,r+i*22,r+i*22,.08*Math.sin(t*.15),0,Math.PI*2);ctx.strokeStyle=`rgba(239,188,151,${.39-i*.075})`;ctx.lineWidth=i===0?1.6:1;ctx.stroke()}
  ctx.beginPath();ctx.arc(cx,cy,25+Math.sin(t*.5)*3,0,Math.PI*2);const orb=ctx.createRadialGradient(cx-6,cy-7,1,cx,cy,30);orb.addColorStop(0,'#ffe0b5');orb.addColorStop(.3,'#e5a783');orb.addColorStop(1,'rgba(218,126,107,0)');ctx.fillStyle=orb;ctx.fill();
  const base=h*.72;const blocks=[[0,.08,.19],[.1,.11,.32],[.23,.1,.16],[.35,.12,.26],[.48,.1,.19],[.59,.12,.31],[.72,.1,.21],[.83,.09,.28],[.91,.12,.18]];
  ctx.fillStyle='#111416';for(const [x,bw,bh] of blocks)ctx.fillRect(w*x,base-h*bh,bw*w,h*bh+h*.35);
  for(let n=0;n<25;n++){const x=((n*83+t*13)%w),y=base+10+(n%6)*8;ctx.fillStyle=n%3?'rgba(220,158,117,.17)':'rgba(220,182,143,.32)';ctx.fillRect(x,y,14+(n%4)*5,1)}
  ctx.strokeStyle='rgba(232,174,135,.35)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,base+1);ctx.lineTo(w,base+1);ctx.stroke();
  ctx.fillStyle='rgba(238,190,151,.05)';for(let i=0;i<20;i++){const x=(i*71+t*3)%w;ctx.fillRect(x,base+8,2,Math.sin(t+i)*20+26)}
  const vignette=ctx.createRadialGradient(w/2,h/2,h*.2,w/2,h/2,h*.75);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'rgba(0,0,0,.46)');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
}
function formatTime(value){const n=Math.floor(value);return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
function updatePlayer(){drawPreview(state.elapsed);$('#playerSeek').value=String(state.elapsed);$('#playerSeek').style.setProperty('--progress',`${(state.elapsed/duration)*100}%`);$('#playerTime').textContent=`${formatTime(state.elapsed)} / 00:${duration}`}
function pausePreview(){state.playing=false;cancelAnimationFrame(state.raf);$('#playerToggle').textContent='▶';$('#playerToggle').setAttribute('aria-label','Reproduzir');$('#centerPlay').classList.remove('is-playing');$('#centerPlay').setAttribute('aria-label','Reproduzir prévia')}
function playPreview(){if(state.elapsed>=duration)state.elapsed=0;state.playing=true;$('#playerToggle').textContent='Ⅱ';$('#playerToggle').setAttribute('aria-label','Pausar');$('#centerPlay').classList.add('is-playing');$('#centerPlay').setAttribute('aria-label','Pausar prévia');let last=performance.now();const tick=now=>{if(!state.playing)return;state.elapsed+=Math.max(0,(now-last)/1000);last=now;if(state.elapsed>=duration){state.elapsed=duration;updatePlayer();pausePreview();return}updatePlayer();state.raf=requestAnimationFrame(tick)};state.raf=requestAnimationFrame(tick)}
function togglePreview(){if(playerWrap.hidden){playerWrap.hidden=false;state.elapsed=0;drawPreview(0)}if(state.playing)pausePreview();else playPreview()}

grid.addEventListener('click',event=>{const save=event.target.closest('[data-save]');if(save){event.stopPropagation();toggleFavorite(save.dataset.save);return}const open=event.target.closest('[data-open]');if(open)openDetails(open.dataset.open)});
document.querySelectorAll('[data-nav]').forEach(el=>el.addEventListener('click',()=>setNav(el.dataset.nav,el.textContent.trim())));
document.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener('click',()=>setCategory(el.dataset.filter)));
$('#filterRow').addEventListener('click',event=>{const chip=event.target.closest('.filter-chip');if(chip)setCategory(chip.dataset.category)});
$('#searchInput').addEventListener('input',event=>{state.query=event.target.value.trim();state.page=1;render()});
$('#sortSelect').addEventListener('change',event=>{state.sort=event.target.value;state.page=1;render()});
$('#viewAll').addEventListener('click',()=>{setCategory('Todos');$('#sectionTitle').scrollIntoView({behavior:'smooth',block:'start'})});
$('#loadMore').addEventListener('click',()=>{state.page++;render()});
$('#clearFilters').addEventListener('click',()=>{$('#searchInput').value='';state.query='';state.sort='featured';$('#sortSelect').value='featured';setCategory('Todos')});
$('#heroPlay').addEventListener('click',()=>featuredVideoId&&openDetails(featuredVideoId));
$('#heroDetails').addEventListener('click',()=>featuredVideoId&&openDetails(featuredVideoId));
$('#closeModal').addEventListener('click',closeDetails);
backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeDetails()});
$('#modalPlay').addEventListener('click',togglePreview);
$('#modalSave').addEventListener('click',()=>state.current&&toggleFavorite(state.current.id));
$('#playerToggle').addEventListener('click',()=>state.playing?pausePreview():playPreview());
$('#centerPlay').addEventListener('click',()=>state.playing?pausePreview():playPreview());
$('#playerSeek').addEventListener('input',event=>{state.elapsed=Number(event.target.value);updatePlayer()});
$('#playerFullscreen').addEventListener('click',()=>{const screen=$('.player-screen');if(document.fullscreenElement)document.exitFullscreen?.();else screen.requestFullscreen?.()});
$('#menuToggle').addEventListener('click',()=>{$('#sidebar').classList.toggle('is-open');$('#mobileScrim').classList.toggle('is-open')});
$('#mobileScrim').addEventListener('click',closeMobileNav);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!backdrop.hidden)closeDetails();if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();$('#searchInput').focus()}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#searchInput').focus()}});

loadVideos();drawPreview(0);
