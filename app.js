const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const KEY='wanted-list-cloud-v1', SCHEMA_VERSION=2;
const defaults={schemaVersion:SCHEMA_VERSION,lists:[],products:[],history:[]};
let data=load(), lastPersistedSnapshot=JSON.stringify(data), selectedCover='🏴‍☠️', pendingListImage='',clearListImage=false,pendingProductImage='',editingListId=null,coverX=50,coverY=50,coverZoom=1,currentListContextId=null;
let remoteSaveTimer=null, remoteReady=false, remoteSaving=false;
const unlockedPrivateLists=new Set();
let privateAccessPin='';
const cloudConfig=window.WANTED_LIST_SUPABASE||{};
function setCloudStatus(label,online=false){const el=document.querySelector('.local-pill');if(el){el.textContent=(online?'● ':'● ')+label;el.classList.toggle('cloud-online',online)}}
function cloudHeaders(extra={}){return {'apikey':cloudConfig.key,'Authorization':'Bearer '+cloudConfig.key,'Content-Type':'application/json',...extra}}
async function secureApi(action,payload={},pin=''){
  if(!cloudConfig.url||!cloudConfig.key)throw new Error('Configuração Supabase ausente');
  const base=cloudConfig.url.replace(/\/$/,'');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);let response,body;try{response=await fetch(base+'/functions/v1/wanted-list-secure',{method:'POST',headers:cloudHeaders(),body:JSON.stringify({action,payload,pin}),cache:'no-store',signal:controller.signal});body=await response.text()}catch(error){if(error.name==='AbortError')throw new Error('TEMPO_ESGOTADO: a chamada ao Supabase não foi concluída em 15 segundos.');throw new Error('REDE: '+(error.message||'falha ao acessar o Supabase'))}finally{clearTimeout(timeout)}
  let parsed={};try{parsed=body?JSON.parse(body):{}}catch{}
  if(!response.ok)throw new Error(parsed.error||('Função segura '+response.status));
  return parsed;
}
async function loadCloud(){try{setCloudStatus('CONECTANDO…');const result=await secureApi('load');data=normalize(result.payload||defaults);lastPersistedSnapshot=JSON.stringify(data);localStorage.setItem(KEY,JSON.stringify(publicSnapshot(data)));remoteReady=true;setCloudStatus('ONLINE · NUVEM',true);render();go('wishlists')}catch(err){console.error('Falha ao carregar Supabase:',err);const cached=localStorage.getItem(KEY);if(cached){try{data=normalize(JSON.parse(cached))}catch{data=clone(defaults)}}else data=clone(defaults);setCloudStatus('ERRO DE CONEXÃO');render();go('wishlists');toast(err.message||'Não foi possível conectar ao serviço seguro.')}}
async function persistCloud(){
  if(!cloudConfig.url||!cloudConfig.key||!remoteReady)return;
  if(remoteSaving){scheduleCloudSave();return;}
  remoteSaving=true;
  const snapshot=JSON.stringify(data);
  try{
    await secureApi('save',JSON.parse(snapshot),privateAccessPin);
    lastPersistedSnapshot=snapshot;
    setCloudStatus('ONLINE · NUVEM',true);
    if(JSON.stringify(data)!==snapshot)scheduleCloudSave();
  }catch(err){
    console.error('Falha ao sincronizar:',err);
    setCloudStatus('ERRO DE SINCRONIZAÇÃO');
    toast(err.message||'Falha ao salvar na nuvem.');
  }finally{remoteSaving=false}
}
async function unlockPrivateChest(listId){
  const pin=window.prompt('Este baú é privado. Digite sua senha de acesso (mínimo de 16 caracteres):');
  if(pin===null)return false;
  if(!/^\d{4}$/.test(pin)){toast('Digite um PIN de 4 dígitos.');return false;}
  try{
    const result=await secureApi('unlock',{},pin);
    data=normalize(result.payload||defaults);privateAccessPin=pin;unlockedPrivateLists.add(listId);
    localStorage.setItem(KEY,JSON.stringify(publicSnapshot(data)));lastPersistedSnapshot=JSON.stringify(data);render();toast('Baú privado desbloqueado nesta sessão.');return true;
  }catch(err){toast(err.message==='PIN_INVALID'?'Senha incorreta. Acesso não autorizado.':err.message==='PIN_RATE_LIMIT'?'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.':(err.message||'Não foi possível desbloquear o baú.'));return false;}
}
function clone(v){return JSON.parse(JSON.stringify(v))}
function normalize(d){
  if(!d||typeof d!=='object'||!Array.isArray(d.lists)||!Array.isArray(d.products)) throw new Error('Estrutura de backup inválida');
  const lists=d.lists.map(l=>({id:String(l.id||id()),name:String(l.name||'Baú sem nome'),desc:String(l.desc||''),cover:String(l.cover||'🏴‍☠️'),image:safeImage(l.image),coverX:Math.max(0,Math.min(100,Number(l.coverX??50))),coverY:Math.max(0,Math.min(100,Number(l.coverY??50))),isPrivate:l.isPrivate===true,created:l.created||new Date().toISOString()}));
  const listIds=new Set(lists.map(l=>l.id));
  if(listIds.size!==lists.length)throw new Error('O backup contém IDs de wishlist duplicados.');
  const products=d.products.map(p=>({
    id:String(p.id||id()),name:String(p.name||'Produto sem nome'),price:validPrice(p.price)?Number(p.price):0,
    store:String(p.store||''),url:safeUrl(p.url),notes:String(p.notes||''),
    lists:Array.isArray(p.lists)?p.lists.map(String).filter(x=>listIds.has(x)):[],
    image:safeImage(p.image),status:['Desejado','Comprado','Desistido'].includes(p.status)?p.status:'Desejado',
    created:p.created||new Date().toISOString(),rating:Math.floor(Math.min(5,Math.max(0,Number(p.rating)||0))),
    review:String(p.review||''),paidPrice:validPrice(p.paidPrice)?Number(p.paidPrice):null,
    purchaseDate:typeof p.purchaseDate==='string'?p.purchaseDate:''
  }));
  const productIds=new Set(products.map(p=>p.id));
  if(productIds.size!==products.length)throw new Error('O backup contém IDs de produtos duplicados.');
  const history=Array.isArray(d.history)?d.history.filter(h=>productIds.has(String(h.productId))&&validPrice(h.price)).map(h=>({productId:String(h.productId),price:Number(h.price),date:h.date||new Date().toISOString()})):[];
  for(const product of products){if(!history.some(h=>h.productId===product.id))history.push({productId:product.id,price:product.price,date:product.created||new Date().toISOString()})}
  return {schemaVersion:SCHEMA_VERSION,lists,products,history};
}
function publicSnapshot(state){
  const privateIds=new Set((state.lists||[]).filter(l=>l.isPrivate===true).map(l=>String(l.id)));
  const products=(state.products||[]).filter(p=>{
    const linked=Array.isArray(p.lists)?p.lists.map(String):[];
    return linked.length===0||!linked.some(id=>privateIds.has(id));
  });
  const productIds=new Set(products.map(p=>String(p.id)));
  return {
    schemaVersion:SCHEMA_VERSION,
    // Do not persist private chest metadata in the browser's public/offline cache.
    lists:(state.lists||[]).filter(l=>l.isPrivate!==true).map(l=>({...l})),
    products,
    history:(state.history||[]).filter(h=>productIds.has(String(h.productId)))
  };
}
function scheduleCloudSave(){
  if(!remoteReady)return;
  if(remoteSaveTimer)clearTimeout(remoteSaveTimer);
  remoteSaveTimer=setTimeout(()=>{
    remoteSaveTimer=null;
    if(!remoteSaving)persistCloud();
    else scheduleCloudSave();
  },650);
}
function validPrice(v){return v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0}
function safeUrl(value){if(!value)return '';try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
function safeImage(value){return typeof value==='string'&&((/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)&&value.length<8*1024*1024)||(/^https?:\/\//i.test(value)&&value.length<2048))?value:''}
function load(){return clone(defaults)}
function save(){
  try{
    data.schemaVersion=SCHEMA_VERSION;
    const serialized=JSON.stringify(data);
    localStorage.setItem(KEY,JSON.stringify(publicSnapshot(data)));
    lastPersistedSnapshot=serialized;
    scheduleCloudSave();
    render();
    return true;
  }catch(e){
    console.error(e);
    if(lastPersistedSnapshot){
      try{data=JSON.parse(lastPersistedSnapshot);render()}catch(restoreError){console.error('Falha ao restaurar o último estado salvo:',restoreError)}
    }
    toast('Não foi possível salvar. Seus últimos dados salvos foram preservados; exporte um backup e reduza as imagens.');
    return false;
  }
}
function id(){return 'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function money(v){return '฿ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function toast(t){let el=$('#toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function dateLabel(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR')}
function go(view){const target=$('#view-'+view);if(!target)return;$$('.view').forEach(v=>v.classList.add('hidden'));target.classList.remove('hidden');$$('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view));const crumbIcons={products:'gomu_gomu.png',wishlists:'luffy-flag.png',conquered:'nami.png',summary:'robin.png',settings:'franky.png'};
const crumbLabels={products:'Produtos',wishlists:'Baús do Tesouro',conquered:'Tesouros conquistados',summary:'Resumo',settings:'Configurações'};
$('#crumb').innerHTML=`<img class="crumb-icon" src="assets/icons/${crumbIcons[view]||'robin.png'}" alt=""> ${crumbLabels[view]||view}`;render()}
$$('.nav').forEach(n=>n.onclick=()=>{currentListContextId=null;go(n.dataset.view)});$$('[data-go]').forEach(n=>n.onclick=()=>go(n.dataset.go));

function readImage(file,cb){
  if(!file)return;
  if(!file.type.startsWith('image/')){toast('Selecione um arquivo de imagem.');return}
  if(file.size>12*1024*1024){toast('Imagem muito grande. Limite de 12 MB.');return}
  const reader=new FileReader();
  reader.onload=()=>{const img=new Image();img.onload=()=>{
    const max=1200,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);cb(canvas.toDataURL('image/jpeg',.82));
  };img.onerror=()=>toast('Não foi possível ler essa imagem.');img.src=reader.result};
  reader.onerror=()=>toast('Falha ao carregar a imagem.');reader.readAsDataURL(file)
}
function openWishlist(list=null){
  editingListId=list?.id||null;pendingListImage='';clearListImage=false;$('#wishlistForm').reset();coverX=list?.coverX??50;coverY=list?.coverY??50;coverZoom=list?.coverZoom??1;$('#coverX').value=coverX;$('#coverY').value=coverY;$('#coverZoom').value=Math.round(coverZoom*100);updateCoverPreview(list?.image||'');
  selectedCover=list?.cover||'🏴‍☠️';$$('.cover-choice').forEach(b=>b.classList.toggle('selected',b.dataset.cover===selectedCover));
  $('#listName').value=list?.name||'';$('#listDesc').value=list?.desc||'';
  $('#listPrivate').checked=list?.isPrivate===true;
  $('#wishlistDialog small.eyebrow').textContent=list?'EDITAR BAÚ':'ADICIONAR UM NOVO BAÚ';
  $('#wishlistDialog h2').textContent=list?'Editar Baú':'Novo Baú';
  $('#saveWishlist').textContent=list?'Salvar alterações':'Criar Baú';
  $('#wishlistDialog').showModal()
}
if($('#newWishlist'))$('#newWishlist').onclick=()=>openWishlist();if($('#newWishlistTop'))$('#newWishlistTop').onclick=()=>openWishlist();if($('#dashboardNewList'))$('#dashboardNewList').onclick=()=>openWishlist();if($('#dashboardNewProduct'))$('#dashboardNewProduct').onclick=()=>openProduct();
$$('.cover-choice').forEach(b=>b.onclick=()=>{selectedCover=b.dataset.cover;clearListImage=true;$$('.cover-choice').forEach(x=>x.classList.toggle('selected',x===b))});
function updateCoverPreview(src){const editor=$('#coverEditor'),img=$('#coverPreview'),toggle=$('#toggleCoverAdjust');if(!editor||!img)return;const value=src||pendingListImage;editor.classList.toggle('has-image',!!value);toggle.hidden=!value;editor.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');if(!value){toggle.querySelector('.cover-chevron').textContent='⌄';img.removeAttribute('src')}else{img.src=value;applyCoverPosition();img.onload=applyCoverPosition}}
function applyCoverPosition(){const frame=$('#coverPreviewFrame'),img=$('#coverPreview');if(!frame||!img)return;frame.style.setProperty('display','block','important');frame.style.setProperty('width','100%','important');frame.style.setProperty('height','clamp(130px, 32vw, 190px)','important');frame.style.setProperty('min-height','130px','important');frame.style.setProperty('max-height','190px','important');frame.style.setProperty('aspect-ratio','auto','important');frame.style.setProperty('overflow','hidden','important');img.style.setProperty('position','absolute','important');img.style.setProperty('inset','0','important');img.style.setProperty('width','100%','important');img.style.setProperty('height','100%','important');img.style.setProperty('max-width','none','important');img.style.setProperty('max-height','none','important');img.style.setProperty('object-fit','cover','important');img.style.objectPosition=coverX+'% '+coverY+'%';img.style.transform='scale('+coverZoom+')';$('#coverX').value=coverX;$('#coverY').value=coverY;$('#coverZoom').value=Math.round(coverZoom*100)}
$('#coverX').addEventListener('input',()=>{coverX=Number($('#coverX').value);applyCoverPosition()});$('#coverY').addEventListener('input',()=>{coverY=Number($('#coverY').value);applyCoverPosition()});$('#coverZoom').addEventListener('input',()=>{coverZoom=Number($('#coverZoom').value)/100;applyCoverPosition()});
let coverPointer=null;const coverFrame=$('#coverPreviewFrame');
coverFrame.addEventListener('pointerdown',e=>{if(!$('#coverPreview').src)return;coverPointer={x:e.clientX,y:e.clientY};coverFrame.setPointerCapture(e.pointerId);coverFrame.classList.add('is-dragging');e.preventDefault()});
coverFrame.addEventListener('pointermove',e=>{if(!coverPointer)return;const rect=coverFrame.getBoundingClientRect();coverX=Math.max(0,Math.min(100,coverX-(e.clientX-coverPointer.x)/rect.width*100));coverY=Math.max(0,Math.min(100,coverY-(e.clientY-coverPointer.y)/rect.height*100));coverPointer={x:e.clientX,y:e.clientY};applyCoverPosition()});
const stopCoverPointer=()=>{coverPointer=null;coverFrame.classList.remove('is-dragging')};coverFrame.addEventListener('pointerup',stopCoverPointer);coverFrame.addEventListener('pointercancel',stopCoverPointer);
$('#toggleCoverAdjust').onclick=()=>{const editor=$('#coverEditor'),open=editor.classList.toggle('is-open');$('#toggleCoverAdjust').setAttribute('aria-expanded',String(open));$('#toggleCoverAdjust .cover-chevron').textContent=open?'⌃':'⌄'};
$('#listImage').onchange=e=>readImage(e.target.files[0],v=>{pendingListImage=v;clearListImage=false;updateCoverPreview(v)});
$('#wishlistForm').onsubmit=async e=>{
  e.preventDefault();
  const name=$('#listName').value.trim();if(!name){toast('Informe o nome do baú.');return}
  const wasEditing=Boolean(editingListId);
  const editingId=editingListId;
  const newListId=editingId||id();
  let existing=data.lists.find(l=>l.id===editingId);
  const isPrivate=$('#listPrivate').checked;
  // Creating the first private chest (or converting a public one) must be
  // authenticated too; otherwise an anonymous save could claim the first lock.
  if(isPrivate&&(!existing||existing.isPrivate!==true)&&!privateAccessPin){
    if(!(await unlockPrivateChest(newListId)))return;
    existing=data.lists.find(l=>l.id===editingId);
  }
  if(existing)Object.assign(existing,{name,desc:$('#listDesc').value.trim(),cover:selectedCover,image:pendingListImage||(clearListImage?'':existing.image||''),coverX,coverY,coverZoom,isPrivate});
  else data.lists.push({id:newListId,name,desc:$('#listDesc').value.trim(),cover:selectedCover,image:pendingListImage,coverX,coverY,coverZoom,isPrivate,created:new Date().toISOString()});
  $('#wishlistDialog').close();if(save())toast(wasEditing?'Baú atualizado!':'Novo baú criado!')
};
function deleteWishlist(listId){
  const list=data.lists.find(l=>l.id===listId);if(!list)return;
  const linked=data.products.filter(p=>(p.lists||[]).includes(listId)).length;
  const choice=confirm(`Excluir "${list.name}"? ${linked?`${linked} produto(s) estão associados. Eles serão mantidos e ficarão sem essa wishlist.`:'Esta lista está vazia.'}`);
  if(!choice)return;
  data.lists=data.lists.filter(l=>l.id!==listId);data.products.forEach(p=>p.lists=(p.lists||[]).filter(x=>x!==listId));
  if(save())toast('Baú excluído. Os produtos foram preservados.')
}
async function importProductFromLink(){
  const input=$('#productImportUrl'),status=$('#productImportStatus'),button=$('#importProductLink');
  const url=input.value.trim();
  if(!url){toast('Cole o link do anúncio primeiro.');return}
  let parsed;try{parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error()}catch{status.textContent='Informe um endereço válido começando com http:// ou https://.';return}
  button.disabled=true;button.textContent='Buscando…';status.textContent='Consultando os dados públicos do anúncio…';
  try{
    const response=await fetch('/api/product-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:parsed.href}),cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Não foi possível consultar esse anúncio.');
    $('#productUrl').value=result.url||parsed.href;
    $('#productImportUrl').value=result.url||parsed.href;
    if(result.price!==''&&result.price!==null&&result.price!==undefined&&Number.isFinite(Number(result.price)))$('#productPrice').value=Number(result.price).toFixed(2);
    if(result.store)$('#productStore').value=result.store;
    if(result.image){pendingProductImage=result.image;status.textContent='Imagem encontrada. Preço e loja preenchidos quando disponíveis; seu nome personalizado foi preservado.'}
    else status.textContent='Anúncio consultado. Não foi possível obter a imagem; você pode adicioná-la manualmente. Seu nome personalizado foi preservado.';
    if(!result.found)status.textContent='A loja não forneceu dados reconhecíveis. Preencha imagem e preço manualmente; seu nome foi preservado.';
    if(result.currency&&result.currency!=='BRL')status.textContent+=' Atenção: moeda identificada '+result.currency+'. Confira o preço antes de salvar.';
  }catch(error){status.textContent=error.message||'Falha ao buscar o anúncio.';toast('Não foi possível importar os dados do anúncio.')}
  finally{button.disabled=false;button.textContent='Buscar'}
}
$('#importProductLink').onclick=importProductFromLink;
$('#productImportUrl').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();importProductFromLink()}});
function openProduct(p=null){
  pendingProductImage='';$('#productForm').reset();$('#productImportUrl').value=p?.url||'';$('#productImportStatus').textContent='Você poderá revisar e editar os dados antes de salvar.';$('#productId').value=p?.id||'';
  $('#productModalTitle').textContent=p?'Editar tesouro':'Novo tesouro';
  $('#productName').value=p?.name||'';$('#productPrice').value=p?.price??'';
  $('#productStore').value=p?.store||'';$('#productUrl').value=p?.url||'';
  $('#productNotes').value=p?.notes||'';$('#productPaidPrice').value=p?.paidPrice??'';
  $('#productPurchaseDate').value=p?.purchaseDate||'';
  const contextList=data.lists.find(l=>l.id===currentListContextId);
  if(contextList){$('#productLists').innerHTML=`<div class="product-chest-context">🧰 Este tesouro será vinculado automaticamente ao baú <strong>${esc(contextList.name)}</strong>.</div>`;$('#productLists').closest('.field-label').classList.add('context-locked')}
  else{$('#productLists').closest('.field-label').classList.remove('context-locked');$('#productLists').innerHTML=data.lists.map(l=>`<label class="list-check"><input type="checkbox" value="${esc(l.id)}" ${(p?.lists||[]).includes(l.id)?'checked':''}><span>${esc(l.name)}</span></label>`).join('')||'<small>Crie um baú para organizar este produto.</small>'} 
  $('#productImage').value='';
  $('#productDialog').showModal()
}
if($('#addProduct'))$('#addProduct').onclick=()=>openProduct();
$('#productImage').onchange=e=>readImage(e.target.files[0],v=>pendingProductImage=v);
function recordPrice(productId,price){data.history.push({productId,price:Number(price),date:new Date().toISOString()})}
$('#productForm').onsubmit=e=>{
  e.preventDefault();
  const name=$('#productName').value.trim(),rawPrice=$('#productPrice').value,price=Number(rawPrice);
  if(!name||!validPrice(rawPrice)){toast('Informe nome e preço válido (zero ou maior).');return}
  const urlInput=$('#productUrl').value.trim(),url=safeUrl(urlInput);
  if(urlInput&&!url){toast('Informe um link válido começando com http:// ou https://.');return}
  const pid=$('#productId').value,p=data.products.find(x=>x.id===pid);
  const contextList=data.lists.find(l=>l.id===currentListContextId);const lists=contextList?[...new Set([...(p?.lists||[]),contextList.id])]:[...$('#productLists').querySelectorAll('input[type=checkbox]:checked')].map(o=>o.value);
  const paidRaw=$('#productPaidPrice').value;if(paidRaw!==''&&!validPrice(paidRaw)){toast('Informe um preço pago válido (zero ou maior).');return}const paidPrice=paidRaw===''?null:Number(paidRaw);
  if(p){
    if(Number(p.price)!==price)recordPrice(p.id,price);
    Object.assign(p,{name,price,store:$('#productStore').value.trim(),url,notes:$('#productNotes').value.trim(),lists,image:pendingProductImage||p.image||'',paidPrice,purchaseDate:$('#productPurchaseDate').value});
  }else{
    const product={id:id(),name,price,store:$('#productStore').value.trim(),url,notes:$('#productNotes').value.trim(),lists,image:pendingProductImage,status:'Desejado',created:new Date().toISOString(),rating:0,review:'',paidPrice,purchaseDate:$('#productPurchaseDate').value};
    data.products.push(product);recordPrice(product.id,price)
  }
  $('#productDialog').close();if(save())toast('Tesouro salvo!')
};

// Fechamento explícito dos modais: não depende da validação dos campos obrigatórios.
document.querySelectorAll('#wishlistDialog .close, #wishlistDialog .modal-actions .ghost-btn, #productDialog .close, #productDialog .modal-actions .ghost-btn').forEach(button=>{
  button.type='button';
  button.addEventListener('click',()=>button.closest('dialog')?.close());
});
['wishlistDialog','productDialog','detailDialog'].forEach(id=>{
  const dialog=document.getElementById(id);
  dialog?.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
});
function poster(p){
  const status=p.status||'Desejado',cls=status==='Comprado'?'bought':status==='Desistido'?'given':'';
  return `<article class="poster" style="--tilt:${(parseInt(p.id.slice(-2),36)%5-2)*.35}deg" data-product="${esc(p.id)}"><div class="poster-title">WANTED</div><div class="poster-img">${p.image?`<img src="${p.image}" alt="">`:'🏴‍☠️'}</div><div class="poster-status ${cls}">${esc(status.toUpperCase())}</div><div class="poster-name">${esc(p.name)}</div><div class="poster-price">${money(p.price)}</div><div class="poster-store">⚓ ${esc(p.store||'Loja não informada')}</div><div class="poster-chests">🧰 ${esc((p.lists||[]).map(listId=>data.lists.find(l=>l.id===listId)?.name).filter(Boolean).join(' · ')||'Sem baú')}</div></article>`
}
function canSeeProduct(p){
  const privateLists=(p.lists||[]).map(listId=>data.lists.find(l=>l.id===listId)).filter(l=>l&&l.isPrivate);
  if(!privateLists.length)return true;
  return !!currentListContextId&&privateLists.some(l=>l.id===currentListContextId)&&privateLists.every(l=>unlockedPrivateLists.has(l.id));
}
function listCard(l){
  const locked=l.isPrivate&&!unlockedPrivateLists.has(l.id);
  const activeProducts=locked?[]:data.products.filter(p=>(p.lists||[]).includes(l.id)&&p.status==='Desejado'&&canSeeProduct(p));
  const count=activeProducts.length;
  const total=activeProducts.reduce((s,p)=>s+Number(p.price||0),0);
  return `<article class="list-card" data-list="${esc(l.id)}"><div class="list-cover" style="${l.image?`background-image:url('${l.image}');background-size:cover;background-position:${Number(l.coverX??50)}% ${Number(l.coverY??50)}%`:''}">${l.image?'':esc(l.cover)}</div><div class="list-body"><h3>${esc(l.name)} ${l.isPrivate?'🔒':''}</h3><p>${esc(l.desc||'Uma nova aventura começa aqui.')}</p><div class="list-privacy">${l.isPrivate?'🔒 PRIVADO · exige PIN':'🌐 PÚBLICO'}</div><div class="list-meta"><span>${locked?'🔒 Conteúdo protegido':`📦 ${count} desejos ativos`}</span><b>${locked?'••••':money(total)}</b></div><div class="list-actions"><button type="button" data-edit-list="${esc(l.id)}">Editar</button><button type="button" data-delete-list="${esc(l.id)}">Excluir</button></div></div></article>`
}
function render(){
  const lists=data.lists,products=data.products;
  $('#allLists').innerHTML=lists.map(listCard).join('')||'<p>Você ainda não criou baús.</p>';
  const visibleProducts=products.filter(canSeeProduct);
  const search=($('#searchProducts')?.value||'').toLowerCase(),status=($('#filterStatus')?.value||''),selectedList=$('#filterList')?.value||'',sort=$('#sortProducts')?.value||'recent';
  const filtered=visibleProducts.filter(p=>(p.name+' '+(p.store||'')).toLowerCase().includes(search)&&(!status||p.status===status)&&(!selectedList||(p.lists||[]).includes(selectedList)));
  filtered.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'pt-BR'):sort==='priceAsc'?a.price-b.price:sort==='priceDesc'?b.price-a.price:String(b.created).localeCompare(String(a.created)));
  $('#productGrid').innerHTML=filtered.map(poster).join('')||'<p>Nenhum tesouro encontrado. Adicione seu primeiro produto!</p>';
  $('#conqueredGrid').innerHTML=visibleProducts.filter(p=>p.status==='Comprado').map(poster).join('')||'<p>Seus tesouros conquistados aparecerão aqui.</p>';
  // Keep the currently selected wishlist filter when refreshing.
  $('#filterList').innerHTML='<option value="">Todos os baús</option>'+lists.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  $('#filterList').value=selectedList;
  const desired=visibleProducts.filter(p=>p.status==='Desejado'),bought=visibleProducts.filter(p=>p.status==='Comprado'),abandoned=visibleProducts.filter(p=>p.status==='Desistido');
  const wishValue=desired.reduce((s,p)=>s+p.price,0),spent=bought.filter(p=>p.paidPrice!==null&&p.paidPrice!==undefined).reduce((s,p)=>s+p.paidPrice,0);
  const completion=visibleProducts.length?Math.round((bought.length/visibleProducts.length)*100):0;
  const stats=[['📦',visibleProducts.length,'Produtos cadastrados'],['🧰',lists.length,'Baús criados'],['🏆',bought.length,'Tesouros conquistados'],['🍇',desired.length,'Desejos pendentes'],['💰',money(wishValue),'Valor dos desejos'],['💸',money(spent),'Investimento registrado']];
  $('#stats').innerHTML=stats.map(x=>`<div class="stat"><strong>${x[0]} ${x[1]}</strong><span>${x[2]}</span></div>`).join('');
  $('#summaryListCount').textContent=lists.length;$('#summaryProductCount').textContent=visibleProducts.length;$('#summaryWishValue').textContent=money(wishValue);$('#summarySpent').textContent=money(spent);
  $('#collectionProgressLabel').textContent=completion+'%';$('#collectionProgressBar').style.width=completion+'%';
  $('#collectionProgressText').textContent=visibleProducts.length?`${bought.length} de ${visibleProducts.length} produtos já foram conquistados. ${desired.length} ainda estão na sua lista de desejos e ${abandoned.length} foram desistidos.`:'Cadastre seus primeiros produtos para acompanhar o progresso da coleção.';
  $('#summaryRecentLists').innerHTML=lists.slice().sort((a,b)=>String(b.created).localeCompare(String(a.created))).slice(0,4).map(l=>`<div class="summary-list-row"><span class="summary-list-emoji">${esc(l.cover||'🧰')}</span><span class="summary-row-main"><b>${esc(l.name)}</b><small>${visibleProducts.filter(p=>(p.lists||[]).includes(l.id)).length} produto(s)</small></span><b>${money(visibleProducts.filter(p=>(p.lists||[]).includes(l.id)&&p.status==='Desejado').reduce((s,p)=>s+p.price,0))}</b></div>`).join('')||'<p class="muted">Crie seu primeiro baú para organizar os tesouros.</p>';
  $('#summaryRecentProducts').innerHTML=visibleProducts.slice().sort((a,b)=>String(b.created).localeCompare(String(a.created))).slice(0,4).map(p=>`<button class="summary-product-row" type="button" data-product="${esc(p.id)}"><span class="summary-product-status ${p.status==='Comprado'?'is-bought':p.status==='Desistido'?'is-abandoned':''}"></span><span class="summary-row-main"><b>${esc(p.name)}</b><small>${esc(p.store||'Loja não informada')}</small></span><strong>${money(p.price)}</strong></button>`).join('')||'<p class="muted">Seus produtos recentes aparecerão aqui.</p>';
  $('#priceHistory').innerHTML=data.history.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,20).map(h=>{const p=visibleProducts.find(p=>p.id===h.productId);return p?`<div class="history-row"><span>${esc(p.name)} · ${dateLabel(h.date)}</span><b>${money(h.price)}</b></div>`:''}).join('')||'<p class="muted">As alterações de preço aparecerão aqui.</p>';
  $$('[data-product]').forEach(el=>el.onclick=()=>showProduct(el.dataset.product));
  $$('[data-list]').forEach(el=>el.onclick=e=>{if(e.target.closest('button'))return;const l=lists.find(x=>x.id===el.dataset.list);if(l){const enter=()=>{currentListContextId=l.id;go('products');$('#filterStatus').value='';$('#filterList').value=l.id;render()};if(l.isPrivate&&!unlockedPrivateLists.has(l.id)){unlockPrivateChest(l.id).then(ok=>{if(ok)enter()});return}enter()}});
  $$('[data-edit-list]').forEach(b=>b.onclick=e=>{e.stopPropagation();const l=lists.find(x=>x.id===b.dataset.editList);if(l)openWishlist(l)});
  $$('[data-delete-list]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteWishlist(b.dataset.deleteList)});
}
$('#searchProducts').oninput=render;$('#filterStatus').onchange=render;$('#filterList').onchange=render;$('#sortProducts').onchange=render;

function showProduct(pid,keepOpen=false){
  const p=data.products.find(x=>x.id===pid);if(!p)return;
  const hist=data.history.filter(h=>h.productId===pid).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const listNames=(p.lists||[]).map(listId=>data.lists.find(l=>l.id===listId)?.name).filter(Boolean);
  $('#detailContent').innerHTML=`<button class="close" onclick="document.querySelector('#detailDialog').close()">×</button><div class="detail-layout"><div class="poster detail-poster"><div class="poster-title">WANTED</div><div class="poster-img">${p.image?`<img src="${p.image}" alt="">`:'🏴‍☠️'}</div><div class="poster-status ${p.status==='Comprado'?'bought':p.status==='Desistido'?'given':''}">${esc(p.status.toUpperCase())}</div><div class="poster-name">${esc(p.name)}</div><div class="poster-price">${money(p.price)}</div></div><div class="detail-info"><small class="eyebrow">FICHA DO TESOURO</small><h2>${esc(p.name)}</h2><p>⚓ ${esc(p.store||'Loja não informada')} ${p.url?`· <a target="_blank" rel="noopener noreferrer" href="${esc(p.url)}">Abrir produto ↗</a>`:''}</p><p>🗺️ ${esc(listNames.join(', ')||'Sem baú')}</p><div class="detail-price">${money(p.price)}</div>${p.status==='Comprado'?`<p class="purchase-meta">Preço pago: <b>${p.paidPrice===null||p.paidPrice===undefined?'Não informado':money(p.paidPrice)}</b><br>Data da compra: <b>${dateLabel(p.purchaseDate)}</b></p>${p.rating?`<p class="saved-rating">Avaliação: ${'🍇'.repeat(p.rating)} <span>${p.rating}/5</span></p>`:''}${p.review?`<p class="purchase-review">“${esc(p.review)}”</p>`:''}`:''}<label>Status<select id="detailStatus"><option ${p.status==='Desejado'?'selected':''}>Desejado</option><option ${p.status==='Comprado'?'selected':''}>Comprado</option><option ${p.status==='Desistido'?'selected':''}>Desistido</option></select></label><div class="detail-tabs"><button id="editProduct">✎ Editar</button><button id="showHistory">📉 Histórico (${hist.length})</button><button id="reviewProduct">🍇 Avaliação</button><button id="deleteProduct">Excluir</button></div><div id="detailExtra"></div></div></div>`;
  if(!keepOpen&&!$('#detailDialog').open)$('#detailDialog').showModal();
  $('#detailStatus').onchange=e=>{
    const nextStatus=e.target.value,previousStatus=p.status;
    if(nextStatus==='Desejado'&&previousStatus==='Comprado'){
      if(!confirm('Voltar este produto para Desejado? Os dados da compra e a avaliação serão apagados.')){
        e.target.value=previousStatus;return;
      }
      p.paidPrice=null;p.purchaseDate='';p.rating=0;p.review='';
    }
    p.status=nextStatus;
    if(nextStatus==='Comprado'){
      if(!p.purchaseDate)p.purchaseDate=new Date().toISOString().slice(0,10);
      if(save()){
        go('conquered');
        showProduct(pid,true);
        openReviewUI(pid);
        toast('Tesouro conquistado! Registre sua avaliação.');
      }else{
        p.status=previousStatus;e.target.value=previousStatus;
      }
      return;
    }
    if(save())showProduct(pid,true);
    else{p.status=previousStatus;e.target.value=previousStatus}
  };
  $('#editProduct').onclick=()=>{$('#detailDialog').close();openProduct(p)};
  $('#showHistory').onclick=()=>$('#detailExtra').innerHTML='<h3>📉 Histórico de preços</h3>'+hist.map(h=>`<div class="history-row"><span>${dateLabel(h.date)}</span><b>${money(h.price)}</b></div>`).join('')+`<p>Menor preço: <b>${money(hist.length?Math.min(...hist.map(h=>h.price)):p.price)}</b></p>`;
  $('#reviewProduct').onclick=()=>openReviewUI(pid);
  $('#deleteProduct').onclick=()=>{if(confirm('Excluir este produto e todo seu histórico de preços?')){data.products=data.products.filter(x=>x.id!==pid);data.history=data.history.filter(x=>x.productId!==pid);save();$('#detailDialog').close();toast('Tesouro removido.')}};
}
function openReviewUI(pid){
  const p=data.products.find(x=>x.id===pid);if(!p)return;
  if(p.status!=='Comprado'){toast('Marque o produto como Comprado para avaliá-lo.');return}
  const fruits=['🍇','🍈','🍉','🍊','🍑'];
  $('#detailExtra').innerHTML=`<section class="review-panel"><h3>🍇 Avalie este tesouro</h3><p>Como foi conquistar este item?</p><div class="two purchase-fields"><label>Quanto você pagou? (opcional)<input id="reviewPaidPrice" type="number" min="0" step="0.01" value="${p.paidPrice??''}" placeholder="Preço pago em berries"></label><label>Data da compra<input id="reviewPurchaseDate" type="date" value="${esc(p.purchaseDate||new Date().toISOString().slice(0,10))}"></label></div><div class="fruit-rating">${fruits.map((f,i)=>`<button type="button" data-rate="${i+1}" class="${p.rating>=i+1?'selected':''}" aria-label="Avaliação ${i+1} de 5"><img src="assets/icons/avaliacao.png" alt=""></button>`).join('')}</div><p id="ratingLabel">${p.rating?`Nível ${p.rating} de 5`:'Escolha uma fruta para avaliar'}</p><label>Comentário<textarea id="reviewText" placeholder="Conte como foi sua experiência...">${esc(p.review||'')}</textarea></label><div class="review-actions"><button type="button" class="ghost-btn" id="skipReview">Salvar e avaliar depois</button><button type="button" class="gold-btn" id="saveReview">Salvar avaliação</button></div></section>`;
  let rating=p.rating||0;
  $$('[data-rate]').forEach(b=>b.onclick=()=>{rating=Number(b.dataset.rate);$$('[data-rate]').forEach(x=>x.classList.toggle('selected',Number(x.dataset.rate)<=rating));$('#ratingLabel').textContent=`Nível ${rating} de 5`});
  $('#skipReview').onclick=()=>{const paid=$('#reviewPaidPrice').value,date=$('#reviewPurchaseDate').value;if(paid!==''&&!validPrice(paid)){toast('Informe um preço pago válido.');return}if(!date){toast('Informe a data da compra.');return}p.paidPrice=paid===''?null:Number(paid);p.purchaseDate=date;if(save()){$('#detailDialog').close();toast('Compra registrada. Você pode avaliar depois.')}};
  $('#saveReview').onclick=()=>{if(!rating){toast('Escolha uma fruta para registrar a avaliação.');return}const paid=$('#reviewPaidPrice').value,date=$('#reviewPurchaseDate').value;if(paid!==''&&!validPrice(paid)){toast('Informe um preço pago válido.');return}if(!date){toast('Informe a data da compra.');return}p.paidPrice=paid===''?null:Number(paid);p.purchaseDate=date;p.rating=rating;p.review=$('#reviewText').value.trim();if(save()){$('#detailDialog').close();toast('Avaliação registrada!')}};
}

$('#exportData').onclick=()=>{
  const backup={...data,exportedAt:new Date().toISOString(),app:'Wanted List'};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='wanted-list-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exportado!')
};
$('#importData').onchange=e=>{
  const file=e.target.files[0];if(!file)return;
  if(file.size>25*1024*1024){toast('Backup acima do limite de 25 MB.');e.target.value='';return}
  const reader=new FileReader();reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result),incoming=normalize(parsed);
      if(!confirm(`Importar ${incoming.lists.length} baú(s) e ${incoming.products.length} produto(s)? Os dados atuais serão substituídos.`)){e.target.value='';return}
      const previous=data;data=incoming;
      if(save())toast('Backup restaurado com sucesso!');else data=previous;
    }catch(err){console.error(err);toast('Backup inválido ou incompatível. Os dados atuais foram preservados.')}
    e.target.value=''
  };reader.onerror=()=>toast('Não foi possível ler o arquivo de backup.');reader.readAsText(file)
};
render();
go('wishlists');
loadCloud();
