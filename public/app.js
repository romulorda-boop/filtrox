let videos = [];

const state = {category:'Todos',nav:'inicio',query:'',sort:'featured',favorites:new Set(readFavorites()),showAll:false,current:null,playing:false,elapsed:0,raf:0,toastTimer:0};
const $ = (selector, root=document) => root.querySelector(selector);
const grid = $('#videoGrid');
const backdrop = $('#detailBackdrop');
const playerWrap = $('#playerWrap');
const canvas = $('#previewCanvas');
const ctx = canvas.getContext('2d');
const duration = 24;

function readFavorites(){try{return JSON.parse(localStorage.getItem('filtrox-favorites')||localStorage.getItem('velvet-favorites')||'[]')}catch{return []}}
function saveFavorites(){try{localStorage.setItem('filtrox-favorites',JSON.stringify([...state.favorites]))}catch{}}
function normalizeVideo(row){
  return {
    ...row,
    id:String(row.id||'').trim(),
    title:String(row.title||'').trim(),
    subtitle:String(row.subtitle||'').trim(),
    creator:String(row.creator||'').trim(),
    category:String(row.category||'').trim(),
    duration:Number(row.duration),
    rating:String(row.rating||'').trim(),
    year:Number(row.year),
    description:String(row.description||'').trim(),
    tags:String(row.tags||'').split('|').map(tag=>tag.trim()).filter(Boolean),
    art:String(row.art||'').trim(),
    badge:String(row.badge||'').trim()
  };
}
function showCatalogLoadError(error){
  console.error('[FILTROX] Falha ao carregar /data/videos.csv:',error);
  $('#searchSummary').textContent='Não foi possível carregar o catálogo de vídeos.';
  $('#emptyState').hidden=false;
  $('#loadMore').hidden=true;
}
function loadVideos(){
  if(!window.Papa){showCatalogLoadError(new Error('PapaParse não foi carregado.'));return}
  window.Papa.parse('/data/videos.csv',{
    download:true,
    header:true,
    skipEmptyLines:'greedy',
    complete(results){
      const rows=results.data.map(normalizeVideo);
      videos=rows.filter(video=>video.id&&video.title&&video.category&&Number.isFinite(video.duration)&&Number.isFinite(video.year));
      if(results.errors.length)console.warn('[FILTROX] Avisos ao analisar o CSV:',results.errors);
      if(videos.length!==rows.length)console.warn(`[FILTROX] ${rows.length-videos.length} linha(s) inválida(s) ignorada(s).`);
      if(!videos.length){showCatalogLoadError(new Error('O CSV não contém vídeos válidos.'));return}
      console.log(`[FILTROX] ${videos.length} vídeos carregados de /data/videos.csv.`);
      render();
    },
    error(error){showCatalogLoadError(error)}
  });
}
function visibleVideos(){
  let items=[...videos];
  if(state.nav==='favoritos') items=items.filter(v=>state.favorites.has(v.id));
  if(state.nav==='em-alta') items=items.filter(v=>['cidade','frequencia','objeto','lados-b'].includes(v.id));
  if(state.nav==='recentes') items=items.filter(v=>v.year===2026);
  if(state.category!=='Todos') items=items.filter(v=>v.category===state.category || (state.category==='Atmosfera' && v.tags.includes('Ensaio')));
  if(state.query){const q=state.query.toLocaleLowerCase('pt-BR');items=items.filter(v=>[v.title,v.subtitle,v.creator,v.category,v.description,...v.tags].join(' ').toLocaleLowerCase('pt-BR').includes(q))}
  if(state.sort==='newest') items.sort((a,b)=>b.year-a.year || a.title.localeCompare(b.title,'pt-BR'));
  if(state.sort==='az') items.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
  return items;
}
function posterMarkup(video){return `<div class="card-cover ${video.art}" role="img" aria-label="Arte abstrata original de ${escapeHtml(video.title)}"><span class="art-shape shape-a"></span><span class="art-shape shape-b"></span><span class="art-shape shape-c"></span><div class="cover-topline"><span class="cover-series">FILTROX · ${video.badge}</span><span class="cover-duration">${video.duration} MIN</span></div><span class="cover-bottom">Nº ${String(videos.indexOf(video)+1).padStart(2,'0')} &nbsp;—&nbsp; ${video.category.toUpperCase()}</span><button class="cover-play" data-open="${video.id}" aria-label="Abrir ${escapeHtml(video.title)}"><span class="play-triangle"></span></button></div>`}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function render(){
  const items=visibleVideos();
  grid.innerHTML=items.map((v,index)=>`<article class="video-card" style="animation-delay:${Math.min(index*35,250)}ms">${posterMarkup(v)}<div class="card-info"><div><button class="card-title-button" data-open="${v.id}">${escapeHtml(v.title)}</button><p class="card-subtitle">${escapeHtml(v.subtitle)}</p><p class="card-type">${escapeHtml(v.category)} <i></i> ${v.year}</p></div><div class="card-side"><span class="card-rating"><span>✳</span> ${v.rating}</span><button class="save-button ${state.favorites.has(v.id)?'is-saved':''}" data-save="${v.id}" aria-label="${state.favorites.has(v.id)?'Remover':'Adicionar'} ${escapeHtml(v.title)} ${state.favorites.has(v.id)?'da':'à'} minha lista" aria-pressed="${state.favorites.has(v.id)}">${state.favorites.has(v.id)?'♥':'＋'}</button></div></div></article>`).join('');
  $('#emptyState').hidden=items.length>0;
  $('#loadMore').hidden=state.nav==='favoritos'||items.length===0;
  $('#searchSummary').textContent=state.query?`${items.length} ${items.length===1?'resultado':'resultados'} para “${state.query}”`:'';
  $('#savedCount').textContent=state.favorites.size||'';
  const chip=$('#filterRow .filter-chip[data-category="Todos"] span'); if(chip)chip.textContent=String(items.length);
}
function setNav(nav,label){
  state.nav=nav;state.category='Todos';
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
  state.nav='inicio';state.category=category;
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
document.querySelectorAll('.filter-chip').forEach(el=>el.addEventListener('click',()=>setCategory(el.dataset.category)));
$('#searchInput').addEventListener('input',event=>{state.query=event.target.value.trim();render()});
$('#sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render()});
$('#viewAll').addEventListener('click',()=>{setCategory('Todos');$('#sectionTitle').scrollIntoView({behavior:'smooth',block:'start'})});
$('#loadMore').addEventListener('click',()=>showToast('Você chegou ao fim desta seleção.'));
$('#clearFilters').addEventListener('click',()=>{$('#searchInput').value='';state.query='';state.sort='featured';$('#sortSelect').value='featured';setCategory('Todos')});
$('#heroPlay').addEventListener('click',()=>openDetails('cidade'));
$('#heroDetails').addEventListener('click',()=>openDetails('cidade'));
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
