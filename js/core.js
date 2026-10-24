// PlotPeta: Inti aplikasi: state, kanvas, tampilan, buka peta (JPG/PNG/TIFF), alat gambar dan edit, kalibrasi, draw, simpan/buka lokal

const $=id=>document.getElementById(id);
const plotCanvas=$('plotCanvas'),ctx=plotCanvas.getContext('2d');
const LN={get P(){return $('lP').value.trim()||'020100'},get D(){return $('lD').value.trim()||'020300'}};
let img=null,iw=0,ih=0,V={s:1,x:0,y:0},tool='pan',lines=[],texts=[],cur=[],selT=-1,mouse=null,drag=null,dirty=false,hist=[],erasePick=null,mClickTimer=null,mClickPt=null,mvStart=null,mvMoved=false,addLinePick=null;
let cal={pts:[],ok:false,M:null,mode:'local'};
let cand=[],box=null,mv=null,polys=[],gaps=[],mapLocked=false;
function editTarget(){return cand.length?cand:lines}
function candMsg(){if(cand.length)$('dMsg').textContent=cand.length+' jalur kandidat. Kandidat bisa diedit dengan Pindah Titik/Hapus sebelum diterima.'}
let helperPreview=null,helperPreviewImg=null,helperPreviewBusy=false;
let selectionPoly=[], boxAction='detect', freehandDrawing=false;
let ocrWorker=null, ocrBusy=false, reOcrTarget=null;
let mapName='';
const W=()=>plotCanvas.clientWidth,H=()=>plotCanvas.clientHeight,d1=()=>devicePixelRatio||1;
function resize(){const r=$('wrap').getBoundingClientRect(),d=d1();plotCanvas.width=r.width*d;plotCanvas.height=r.height*d;plotCanvas.style.width=r.width+'px';plotCanvas.style.height=r.height+'px';draw()}
addEventListener('resize',resize);
const toS=p=>[p[0]*V.s+V.x,p[1]*V.s+V.y],toI=p=>[(p[0]-V.x)/V.s,(p[1]-V.y)/V.s];
const fitV=()=>{V.s=Math.min(W()/iw,H()/ih);V.x=(W()-iw*V.s)/2;V.y=(H()-ih*V.s)/2};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=s=>{s=String(s).trim();s=/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)?s.replace(/\./g,'').replace(',','.'):s.replace(',','.');return parseFloat(s)};
const f2=n=>n.toLocaleString('id-ID',{maximumFractionDigits:2,minimumFractionDigits:2});
const toReal=p=>{if(cal.mode==='local')return [p[0],(ih||0)-p[1]];if(!cal.ok||!cal.M)return null;const m=cal.M;return[m[0]*p[0]+m[1]*p[1]+m[2],m[3]*p[0]+m[4]*p[1]+m[5]]};
function snapshot(){hist.push(JSON.stringify({lines,texts,cand}));if(hist.length>100)hist.shift();dirty=true}
function undo(){if(mClickTimer){clearTimeout(mClickTimer);mClickTimer=null;mClickPt=null}if(cur.length){cur.pop()}else if(hist.length){const o=JSON.parse(hist.pop());lines=o.lines;texts=o.texts;cand=o.cand||[];selT=-1;tform();candMsg()}erasePick=null;addLinePick=null;stat();draw()}

function updateDropzone(){
  const dz=$('dropzone');
  if(dz) dz.style.display = img ? 'none' : 'flex';
}

function loadImg(src){
  const im=new Image();
  im.onload=()=>{
    img=im;
    iw=im.naturalWidth;
    ih=im.naturalHeight;
    helperPreview=null;helperPreviewImg=null;erasePick=null;addLinePick=null;
    if($('helperViewMsg'))$('helperViewMsg').textContent='';
    fitV();
    draw();
    updateDropzone();
    $('st').innerHTML='<span class="status-dot"></span><span>'+iw+' &times; '+ih+' px</span>';
    if($('helperViewToggle')?.checked)refreshHelperView(true);
  };
  im.src=src;
}

async function ensureUTIF(){
  if(window.UTIF) return window.UTIF;
  return await new Promise((resolve,reject)=>{
    const old=document.querySelector('script[data-plotpeta-utif]');
    if(old){old.addEventListener('load',()=>resolve(window.UTIF),{once:true});old.addEventListener('error',reject,{once:true});return;}
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';
    script.dataset.plotpetaUtif='1';script.onload=()=>window.UTIF?resolve(window.UTIF):reject(new Error('UTIF tidak tersedia'));script.onerror=()=>reject(new Error('Pustaka TIFF tidak dapat dimuat. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });
}

// Untuk TIFF besar, hindari membuat buffer RGBA 4 byte per piksel (dapat >2 GB).
// TIFF 1-bit dipratinjau dengan mengambil sampel langsung dari data raster terdekode.
function makePacked1BitPreview(page, maxSide=5000){
  const w=Number(page.width),h=Number(page.height),data=page.data;
  if(!data || !w || !h) throw new Error('Data raster TIFF tidak tersedia');
  const rowBytes=Math.ceil(w/8);
  // Beberapa versi decoder mengembangkan piksel 1-bit menjadi satu byte/piksel.
  const expanded8Bit=data.length>=w*h;
  if(!expanded8Bit && data.length < rowBytes*h) throw new Error('Data TIFF 1-bit tidak lengkap atau format packing tidak didukung');
  if(!expanded8Bit && data.length !== rowBytes*h) throw new Error('Panjang raster TIFF 1-bit tidak sesuai dengan dimensi gambar');
  const scale=Math.min(1,maxSide/Math.max(w,h));
  const pw=Math.max(1,Math.round(w*scale)),ph=Math.max(1,Math.round(h*scale));
  const canvas=document.createElement('canvas');canvas.width=pw;canvas.height=ph;
  const c=canvas.getContext('2d',{willReadFrequently:false});
  const image=c.createImageData(pw,ph),out=image.data;
  // Tentukan polaritas dari tag TIFF bila tersedia, lalu validasi dengan
  // mayoritas sampel raster. Pemindai peta sering memakai WhiteIsZero,
  // dan beberapa decoder tidak mengekspos photometric dengan konsisten.
  const tagPhoto=page.t262;
  const photoValue=Number(Array.isArray(tagPhoto)||ArrayBuffer.isView(tagPhoto)?tagPhoto[0]:(tagPhoto===undefined?page.photometric:tagPhoto));
  let ones=0,zeros=0;
  const sampleStep=Math.max(1,Math.floor(Math.max(w,h)/256));
  for(let sy=0;sy<h;sy+=sampleStep){
    for(let sx=0;sx<w;sx+=sampleStep){
      let bit;
      if(expanded8Bit){bit=Number(data[sy*w+sx])>127?1:0;}
      else {const byte=data[sy*rowBytes+(sx>>3)];bit=(byte>>(7-(sx&7)))&1;}
      if(bit)ones++;else zeros++;
    }
  }
  // Untuk peta scan, warna latar biasanya warna dominan. Gunakan metadata
  // TIFF jika valid; jika metadata hilang/tidak masuk akal, latar dominan menang.
  let whiteBit;
  if(photoValue===0) whiteBit=0;       // WhiteIsZero: sample 0 = putih
  else if(photoValue===1) whiteBit=1;  // BlackIsZero: sample 1 = putih pada data packed yang didekode UTIF
  else whiteBit=ones>=zeros?1:0;
  // Jika metadata berlawanan dengan mayoritas raster secara ekstrem, decoder
  // kemungkinan sudah menormalisasi data; koreksi agar latar tetap putih.
  if(Math.max(ones,zeros)>=(ones+zeros)*0.8) whiteBit=ones>zeros?1:0;
  for(let y=0;y<ph;y++){
    const sy=Math.min(h-1,Math.floor(y*h/ph));
    for(let x=0;x<pw;x++){
      const sx=Math.min(w-1,Math.floor(x*w/pw));
      let bit;
      if(expanded8Bit){bit=Number(data[sy*w+sx])>127?1:0;}
      else {const byte=data[sy*rowBytes+(sx>>3)];bit=(byte>>(7-(sx&7)))&1;}
      const v=bit===whiteBit?255:0;
      const i=(y*pw+x)*4;
      out[i]=out[i+1]=out[i+2]=v;out[i+3]=255;
    }
  }
  c.putImageData(image,0,0);
  return {canvas,width:pw,height:ph,originalWidth:w,originalHeight:h};
}

async function loadTiffFile(file){
  $('st').innerHTML='<span class="status-dot" style="background:#f59e0b"></span><span>Membaca TIFF...</span>';
  try{
    const U=await ensureUTIF(),buffer=await file.arrayBuffer(),pages=U.decode(buffer);
    if(!pages||!pages.length) throw new Error('TIFF tidak memiliki halaman gambar');
    const page=pages[0];
    // UTIF.js menyimpan dimensi TIFF di tag 256/257; page.width/page.height
    // belum tentu terisi sampai decodeImage dipanggil. Baca tag sebagai fallback.
    const tagValue=(tag)=>{const v=page['t'+tag];return Array.isArray(v)||ArrayBuffer.isView(v)?Number(v[0]):Number(v);};
    let w=Number(page.width)||tagValue(256),h=Number(page.height)||tagValue(257);
    if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1) throw new Error('Dimensi TIFF tidak valid (tag ImageWidth/ImageLength tidak terbaca)');
    const pixels=w*h;
    U.decodeImage(buffer,page);
    // Ambil kembali dimensi setelah decoder mengisi metadata.
    w=Number(page.width)||w;h=Number(page.height)||h;
    let loadedImage,shownW,shownH,notice='';
    if(pixels>150000000){
      // Untuk TIFF 1-bit besar: downsample langsung dari raster packed agar tidak
      // membuat ImageData RGBA raksasa yang berpotensi menghabiskan memori browser.
      const preview=makePacked1BitPreview(page,5000);
      loadedImage=preview.canvas;shownW=preview.width;shownH=preview.height;
      notice='TIFF besar dibuka dalam pratinjau '+shownW+' × '+shownH+' px (asli '+w+' × '+h+' px).';
    }else{
      const rgba=U.toRGBA8(page),canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
      loadedImage=canvas;shownW=w;shownH=h;
    }
    img=loadedImage;iw=shownW;ih=shownH;helperPreview=null;helperPreviewImg=null;erasePick=null;addLinePick=null;if($('helperViewMsg'))$('helperViewMsg').textContent='';fitV();draw();updateDropzone();
    if($('helperViewToggle')?.checked)refreshHelperView(true);
    $('st').innerHTML='<span class="status-dot"></span><span>'+w.toLocaleString('id-ID')+' × '+h.toLocaleString('id-ID')+' px · TIFF'+(notice?' · pratinjau diperkecil':'')+'</span>';
    if(notice) alert(notice+' Kamu bisa mulai digitasi dari pratinjau. Untuk digitasi otomatis yang menelusuri semua piksel asli, diperlukan pemrosesan TIFF bertile beresolusi penuh; pratinjau ini tidak mempertahankan detail piksel terkecil.');
  }catch(err){
    console.error('PlotPeta gagal membaca TIFF:',err);
    $('st').innerHTML='<span class="status-dot" style="background:#ef4444"></span><span>TIFF gagal dibaca</span>';
    alert('PlotPeta belum dapat membaca TIFF ini: '+(err&&err.message?err.message:'format tidak didukung')+'. Tidak ada perubahan pada file asli.');
  }
}

$('file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  const isTiff=/\.tiff?$/i.test(f.name)||/image\/tiff/i.test(f.type);
  if(isTiff){await loadTiffFile(f);e.target.value='';return;}
  const r=new FileReader();r.onload=()=>loadImg(r.result);r.readAsDataURL(f);e.target.value='';
};

setCoordMode('local');
function setTool(t){
  if(mClickTimer){clearTimeout(mClickTimer);mClickTimer=null;mClickPt=null}
  mv=null;mvStart=null;mvMoved=false;
  if(cur.length&&(t==='P'||t==='D'))finish();
  else cur=[];
  tool=t;
  erasePick=null;addLinePick=null;
  selectionPoly=[]; box=null;
  if(t==='E'&&eraseModeEl?.value==='click'&&!cand.length){
    const n=ensureIntersectionPoints();
    if(n)$('st').innerHTML='<span class="status-dot"></span><span>Titik persilangan dibuat: '+n+'.</span>';
  }
  if(t==='M'){
    const n=cand.length?0:ensureIntersectionPoints();
    $('st').innerHTML='<span class="status-dot"></span><span>Pindah Titik: drag titik, klik garis=potong, 2x segmen=hapus, klik titik lalu klik tujuan=tambah garis.'+(cand.length?' Kandidat deteksi bisa diedit sebelum diterima.':'')+(n?' Titik persilangan dibuat: '+n+'.':'')+'</span>';
  }
  if(t!=='ocr') reOcrTarget=null;
  if(t==='ocr'){
    $('st').innerHTML='<span class="status-dot" style="background:#10b981"></span><span>OCR Teks: Tarik kotak melingkupi teks nomor bidang pada peta.</span>';
    const msg=$('ocrStatusMsg');if(msg)msg.innerHTML='Tarik kotak di atas teks nomor bidang (Nomor Hak &amp; SU) pada peta.';
  }
  updateToolModeHint();
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));
  plotCanvas.style.cursor=mapLocked&&t==='pan'?'not-allowed':t==='pan'?'grab':'crosshair';
  draw();
}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
const detectModeEl=$('detectMode'), eraseModeEl=$('eraseMode'), toolModeHint=$('toolModeHint');
function updateToolModeHint(){
  document.querySelector('.detect-mode-options')?.classList.toggle('mode-visible', tool==='A');
  document.querySelector('.erase-mode-options')?.classList.toggle('mode-visible', tool==='E');
  if(!toolModeHint)return;
  if(tool==='A') toolModeHint.textContent=detectModeEl.value==='rect'?'Tarik kotak pada peta untuk mendeteksi garis.':detectModeEl.value==='poly'?'Tarik mouse sambil menahan klik kiri mengelilingi area, lalu lepaskan untuk mendeteksi.':'Klik Deteksi seluruh peta pada panel kanan.';
  else if(tool==='E') toolModeHint.textContent=eraseModeEl.value==='click'?'Klik segmen garis yang ingin dihapus; bagian lain tetap.':eraseModeEl.value==='rect'?'Tarik kotak untuk menghapus objek/segmen di dalam area.':'Tarik mouse sambil menahan klik kiri mengelilingi area, lalu lepaskan untuk menghapus.';
  else toolModeHint.textContent='Pilih alat Deteksi Otomatis atau Hapus untuk menampilkan pilihannya di bawah tombol.';
}
detectModeEl?.addEventListener('change',updateToolModeHint); eraseModeEl?.addEventListener('change',()=>{erasePick=null;updateToolModeHint();draw()});
$('topoTol')?.addEventListener('input',e=>{if($('val_topo'))$('val_topo').textContent=e.target.value+' px'});
const topoAutoEl=$('topoAutoToggle'),topoManualEl=$('topoManual');
const syncTopoManual=()=>topoManualEl?.classList.toggle('hide',!!topoAutoEl?.checked);
topoAutoEl?.addEventListener('change',syncTopoManual);
syncTopoManual();


function snapPt(p){
  if(!$('snap').checked)return p;
  const sp=toS(p);
  let best=null,bd=10;
  const all=[...cur];
  lines.forEach(l=>all.push(...l.pts));
  for(const q of all){
    const s=toS(q),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
    if(d<bd){bd=d;best=q}
  }
  return best?best.slice():p;
}
function finish(){if(cur.length>=2){snapshot();lines.push({k:'P',pts:cur});const n=ensureIntersectionPoints(true);if(n)$('st').innerHTML='<span class="status-dot"></span><span>Titik persilangan dibuat: '+n+'.</span>'}cur=[];stat();draw()}
function nearestVertex(sp,preferLi=-1){
  let best=null,bd=12;
  lines.forEach((l,li)=>{
    l.pts.forEach((p,pi)=>{
      const s=toS(p),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
      if(d<bd-.001||(Math.abs(d-bd)<.001&&li===preferLi)){bd=d;best={li,pi}}
    });
  });
  return best;
}
function click(sp){
  if(!img)return;
  const p=toI(sp);
  if(tool==='M'&&addLinePick){finishAddLineAt(sp);return}
  if(tool==='A' && detectModeEl?.value==='all'){runDet({x:0,y:0,w:iw,h:ih});return}
  if(tool==='A' && detectModeEl?.value==='poly'){selectionPoly.push(sp.slice());$('dMsg').textContent='Batas area deteksi: '+selectionPoly.length+' titik. Tekan Enter untuk menjalankan deteksi.';draw();return}
  if(tool==='E' && eraseModeEl?.value==='poly'){selectionPoly.push(sp.slice());$('st').innerHTML='<span class="status-dot"></span><span>Batas area hapus: '+selectionPoly.length+' titik; tekan Enter untuk menghapus</span>';draw();return}
  if(tool==='trim'){handleTopoTool(sp);return}
  if(tool==='cal'){if(cal.pts.length<4){cal.pts.push(p);crs()}draw();return}
  if(tool==='P'){const q=snapPt(p);cur.push(q);if(cur.length>=3&&q[0]===cur[0][0]&&q[1]===cur[0][1]&&cur.length-1>0)finish();draw();return}
  if(tool==='T'){snapshot();texts.push({p,no:'',su:''});selT=texts.length-1;tform(true);stat();draw();return}
  if(tool==='M'){
    const h=topoNearestLinePoint(sp,10);
    if(!h){
      $('st').innerHTML='<span class="status-dot"></span><span>Klik garis untuk potong, 2x segmen untuk hapus, atau klik titik untuk mulai menambah garis.</span>';
      draw();return;
    }
    if(mClickTimer)clearTimeout(mClickTimer);
    mClickPt=sp.slice();
    mClickTimer=setTimeout(()=>{
      mClickTimer=null;
      const q=mClickPt;mClickPt=null;
      if(q&&tool==='M')handleTopoTool(q);
    },300);
    return;
  }
  if(tool==='E'){
    if(eraseModeEl && eraseModeEl.value!=='click') return;
    let hit=-1;
    texts.forEach((t,i)=>{const s=toS(t.p);if(Math.hypot(s[0]-sp[0],s[1]-sp[1])<14)hit=i});
    if(hit>=0){
      snapshot();texts.splice(hit,1);selT=-1;erasePick=null;tform();
      $('st').innerHTML='<span class="status-dot"></span><span>Teks dihapus.</span>';
      stat();draw();return;
    }
    const h=topoNearestLinePoint(sp,10);
    if(!h){
      $('st').innerHTML='<span class="status-dot"></span><span>Klik tepat pada segmen garis.</span>';
      draw();return;
    }
    if(!deleteSegmentAt(h.li,h.si)){
      $('st').innerHTML='<span class="status-dot"></span><span>Segmen tidak ditemukan; klik ulang.</span>';
      draw();
    }
    return;
  }
  if(tool==='pan'||tool==='ocr'||tool==='T'){
    let hit=-1;
    texts.forEach((t,i)=>{const s=toS(t.p);if(Math.hypot(s[0]-sp[0],s[1]-sp[1])<18)hit=i});
    selT=hit;
    tform(hit>=0);
    if(hit>=0) showTextEditPopover(hit);
    else closeTextEditPopover();
    draw();
  }
}
$('fin').onclick=finish;
$('undo').onclick=undo;

plotCanvas.addEventListener('pointerdown',e=>{
  const sp=[e.offsetX,e.offsetY];
  const freehandMode = (tool==='A' && detectModeEl?.value==='poly') || (tool==='E' && eraseModeEl?.value==='poly');
  if(e.button===0 && img && freehandMode){
    e.preventDefault();
    plotCanvas.setPointerCapture(e.pointerId);
    freehandDrawing=true; drag=null; box=null; selectionPoly=[sp];
    if(tool==='A') $('dMsg').textContent='Sedang menggambar area deteksi bebas… lepaskan mouse untuk mulai deteksi.';
    else $('st').innerHTML='<span class="status-dot"></span><span>Sedang menggambar area hapus bebas… lepaskan mouse untuk menghapus</span>';
    draw(); return;
  }
  plotCanvas.setPointerCapture(e.pointerId);
  if(e.button===0&&img){
    if(tool==='M'&&!addLinePick){
      const h=findV(sp);
      if(h){
        if(mClickTimer){clearTimeout(mClickTimer);mClickTimer=null;mClickPt=null}
        mv=h;mvStart=sp.slice();mvMoved=false;return;
      }
    }
    // Jika mengklik langsung pada titik teks bidang yang ada di peta
    let hitT = -1;
    texts.forEach((t,i)=>{
      const s = toS(t.p);
      if(Math.hypot(s[0]-sp[0], s[1]-sp[1]) < 18) hitT = i;
    });
    if(hitT >= 0 && (tool === 'ocr' || tool === 'pan' || tool === 'T')){
      selT = hitT;
      tform(true);
      showTextEditPopover(hitT);
      draw();
      return;
    }
    if(tool==='ocr'){boxAction='ocr';box={x0:sp[0],y0:sp[1],x1:sp[0],y1:sp[1]};return}
    if(tool==='A' && detectModeEl?.value==='rect'){boxAction='detect';box={x0:sp[0],y0:sp[1],x1:sp[0],y1:sp[1]};return}
    if(tool==='E' && eraseModeEl?.value==='rect'){boxAction='erase';box={x0:sp[0],y0:sp[1],x1:sp[0],y1:sp[1]};return}
  }
  drag={x:e.offsetX,y:e.offsetY,ox:V.x,oy:V.y,moved:false,btn:e.button};
});
plotCanvas.addEventListener('pointermove',e=>{
  mouse=[e.offsetX,e.offsetY];
  if(addLinePick){draw();return}
  if(freehandDrawing){
    const last=selectionPoly[selectionPoly.length-1], next=[e.offsetX,e.offsetY];
    if(!last || Math.hypot(next[0]-last[0],next[1]-last[1])>=2) selectionPoly.push(next);
    draw(); return;
  }
  if(mv){
    if(!mvMoved && mvStart && Math.hypot(mouse[0]-mvStart[0],mouse[1]-mvStart[1])>4){mvMoved=true;snapshot();}
    if(mvMoved)movePt(mouse);
    draw();return;
  }
  if(box){box.x1=e.offsetX;box.y1=e.offsetY;draw();return}
  if(drag){
    const dx=e.offsetX-drag.x,dy=e.offsetY-drag.y;
    if(Math.hypot(dx,dy)>4||drag.btn!==0||tool==='pan')drag.moved=true;
    if(drag.moved&&!mapLocked){V.x=drag.ox+dx;V.y=drag.oy+dy}
  }
  if(img){
    const p=toI(mouse),r=toReal(p);
    const dotClr = r ? '#10b981' : '#f59e0b';
    const txt = r ? 'X: '+f2(r[0])+'   Y: '+f2(r[1]) : 'px: '+Math.round(p[0])+', '+Math.round(p[1])+' (belum dikalibrasi)';
    $('st').innerHTML='<span class="status-dot" style="background:'+dotClr+';box-shadow:0 0 8px '+dotClr+'"></span><span>'+txt+'</span>';
  }
  draw();
});
plotCanvas.addEventListener('pointerup',e=>{
  if(freehandDrawing){
    freehandDrawing=false;
    if(selectionPoly.length>=3) finishSelection();
    else { selectionPoly=[]; draw(); }
    return;
  }
  if(mv){
    const wasMoved=mvMoved;
    mv=null;mvStart=null;mvMoved=false;
    if(wasMoved){
      const n=cand.length?0:ensureIntersectionPoints(true);
      if(n)$('st').innerHTML='<span class="status-dot"></span><span>Titik persilangan dibuat: '+n+'.</span>';
      stat();draw();
    }else{
      startAddLineAt([e.offsetX,e.offsetY]);
    }
    return;
  }
  if(box){
    const b=box,a=toI([Math.min(b.x0,b.x1),Math.min(b.y0,b.y1)]),z=toI([Math.max(b.x0,b.x1),Math.max(b.y0,b.y1)]);
    const act=boxAction;
    box=null;
    const x=Math.max(0,a[0]),y=Math.max(0,a[1]),R={x,y,w:Math.min(iw,z[0])-x,h:Math.min(ih,z[1])-y};
    if(act==='erase') eraseRegion(R,null); else if(act==='ocr') runOcr(R); else runDet(R);
    draw();return;
  }
  if(drag&&!drag.moved&&drag.btn===0)click([e.offsetX,e.offsetY]);
  drag=null;
});
plotCanvas.addEventListener('dblclick',e=>{
  if(img){
    const sp=[e.offsetX,e.offsetY];
    let hitT=-1;
    texts.forEach((t,i)=>{const s=toS(t.p);if(Math.hypot(s[0]-sp[0],s[1]-sp[1])<18)hitT=i});
    if(hitT>=0){
      selT=hitT;
      tform(true);
      showTextEditPopover(hitT);
      draw();
      return;
    }
  }
  if(tool==='P'&&cur.length){cur.pop();finish();return}
  if(tool==='M'&&img){
    if(mClickTimer){clearTimeout(mClickTimer);mClickTimer=null;mClickPt=null}
    const sp=[e.offsetX,e.offsetY];
    const nearVertex=editTarget().some(l=>l.pts.some(q=>{
      const s=toS(q);return Math.hypot(s[0]-sp[0],s[1]-sp[1])<10;
    }));
    if(nearVertex)return;
    const h=topoNearestLinePoint(sp,10);
    if(h)deleteSegmentAt(h.li,h.si);
  }
});
plotCanvas.addEventListener('pointerleave',()=>{if(tool==='trim'){mouse=null;draw()}});
plotCanvas.addEventListener('pointerenter',e=>{if(tool==='trim'){mouse=[e.offsetX,e.offsetY];draw()}});
plotCanvas.addEventListener('contextmenu',e=>e.preventDefault());
plotCanvas.style.touchAction='none';
plotCanvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(!img)return;
  const k=e.deltaY<0?1.2:1/1.2,p=toI([e.offsetX,e.offsetY]);
  V.s=Math.min(Math.max(V.s*k,.02),60);
  V.x=e.offsetX-p[0]*V.s;
  V.y=e.offsetY-p[1]*V.s;
  draw();
},{passive:false});
addEventListener('keydown',e=>{
  if(/INPUT|TEXTAREA/.test(e.target.tagName))return;
  if(e.key==='Enter'){if(!finishSelection())finish()}
  else if(e.key==='Escape'){if(mClickTimer){clearTimeout(mClickTimer);mClickTimer=null;mClickPt=null}cur=[];selectionPoly=[];box=null;erasePick=null;addLinePick=null;draw()}
  else if(e.key==='Backspace'||(e.key==='z'&&(e.ctrlKey||e.metaKey))){e.preventDefault();undo()}
});
addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});

function crs(){
  const c=$('crs');
  const old=[...c.querySelectorAll('input')].map(i=>i.value);
  c.innerHTML='';
  for(let i=0;i<4;i++){
    const r=document.createElement('div');
    r.className='cr';
    const isOk = !!cal.pts[i];
    const statusTxt = isOk ? '<span style="color:var(--success)">&#10003; Titik OK</span>' : '<span style="color:var(--text-dim)">&bull; Klik peta</span>';
    r.innerHTML='<b>P'+(i+1)+'</b><input id="cx'+i+'" placeholder="X" spellcheck="false"><input id="cy'+i+'" placeholder="Y" spellcheck="false"><span id="cs'+i+'" class="mu">'+(isOk?statusTxt:'&bull; Belum')+'</span>';
    c.appendChild(r);
  }
  [...c.querySelectorAll('input')].forEach((n,i)=>n.value=old[i]||'');
  c.style.display=cal.mode==='map'?'block':'none';
  $('apply').style.display=cal.mode==='map'?'':'none';
  $('creset').textContent=cal.mode==='map'?'Ulang titik':'Reset kalibrasi';
}
function setCoordMode(mode){
  cal.mode=mode==='map'?'map':'local';
  $('coordMode').value=cal.mode;
  $('coordHint').textContent=cal.mode==='local'
    ? 'Mode lokal: DXF memakai titik awal lokal (0,0). Satuan mengikuti piksel gambar; bukan koordinat geografis. Cocok untuk membuka gambar di AutoCAD lalu menyesuaikan skala.'
    : 'Mode koordinat peta: klik 4 titik kontrol pada peta, lalu masukkan koordinat X/Y yang benar dari sumber ukur. Jangan gunakan angka contoh sebagai koordinat nyata.';
  if(cal.mode==='local'){cal.ok=true;cal.M=null;$('calres').textContent='Mode lokal aktif. Titik awal (0,0) berada di kiri bawah gambar; koordinat bukan geografis.';}
  else {cal.ok=false;cal.M=null;$('calres').textContent='Pilih 4 titik dan masukkan koordinat sebenarnya, lalu tekan Terapkan.';}
  crs();draw();
}
$('coordMode').addEventListener('change',e=>{setCoordMode(e.target.value);dirty=true});
$('creset').onclick=()=>{cal.pts=[];cal.ok=cal.mode==='local';cal.M=null;$('calres').textContent=cal.mode==='local'?'Mode lokal aktif; kalibrasi tidak diperlukan.':'';crs();draw()};
function solve3(A,b){
  const n=3,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let m=i;
    for(let k=i+1;k<n;k++)if(Math.abs(M[k][i])>Math.abs(M[m][i]))m=k;
    [M[i],M[m]]=[M[m],M[i]];
    if(Math.abs(M[i][i])<1e-12)return null;
    for(let k=i+1;k<n;k++){
      const f=M[k][i]/M[i][i];
      for(let j=i;j<=n;j++)M[k][j]-=f*M[i][j];
    }
  }
  const x=[0,0,0];
  for(let i=n-1;i>=0;i--){
    let s=M[i][n];
    for(let j=i+1;j<n;j++)s-=M[i][j]*x[j];
    x[i]=s/M[i][i];
  }
  return x;
}
function fitCal(){
  if(cal.mode==='local'){cal.ok=true;cal.M=null;$('calres').textContent='Mode lokal aktif. Titik awal (0,0) berada di kiri bawah gambar; koordinat bukan geografis.';return true;}
  const vals=[];
  for(let i=0;i<4;i++){vals.push([num($('cx'+i).value),num($('cy'+i).value)])}
  if(cal.pts.length<4||vals.flat().some(isNaN)){
    cal.ok=false;cal.M=null;$('calres').textContent='Perlu 4 titik di peta dan 4 pasang koordinat yang benar.';
    return false;
  }
  const N=[[0,0,0],[0,0,0],[0,0,0]],rx=[0,0,0],ry=[0,0,0];
  cal.pts.forEach((p,i)=>{
    const a=[p[0],p[1],1];
    for(let r=0;r<3;r++){
      for(let c=0;c<3;c++)N[r][c]+=a[r]*a[c];
      rx[r]+=a[r]*vals[i][0];
      ry[r]+=a[r]*vals[i][1];
    }
  });
  const cx=solve3(N,rx),cy=solve3(N,ry);
  if(!cx||!cy){
    cal.ok=false;cal.M=null;$('calres').textContent='Titik terlalu sejajar atau berimpit. Pilih titik yang tersebar.';
    return false;
  }
  cal.M=[...cx,...cy];
  cal.ok=true;
  let mx=0;
  cal.pts.forEach((p,i)=>{
    const r=toReal(p),e=Math.hypot(r[0]-vals[i][0],r[1]-vals[i][1]);
    mx=Math.max(mx,e);
    $('cs'+i).innerHTML='<span style="color:var(--success)">sel. '+f2(e)+'</span>';
  });
  const det=Math.abs(cx[0]*cy[1]-cx[1]*cy[0]);
  $('calres').textContent='Kalibrasi berhasil. 1 px = '+Math.sqrt(det).toFixed(4)+' satuan. Selisih terbesar '+f2(mx)+' (makin kecil makin baik).';
  dirty=true;
  return true;
}
$('apply').onclick=fitCal;

function tform(foc){
  const t=texts[selT];
  $('tform').classList.toggle('hide',!t);
  $('tmsg').classList.toggle('hide',!!t);
  if(t){
    $('tno').value=t.no||'';
    $('tsu').value=t.su||'';
    if(foc){
      $('tno').focus();
      try { $('tform').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(_){}
    }
  } else {
    closeTextEditPopover();
  }
}
function positionTextEditPopover(idx){
  const pop=$('textEditPopover');
  if(!pop||pop.classList.contains('hide'))return;
  const t=texts[idx??selT];
  if(!t){pop.classList.add('hide');return;}
  const s=toS(t.p);
  const wrap=$('wrap');
  if(!wrap)return;
  const rect=wrap.getBoundingClientRect();
  const popW=260, popH=165;
  let left=s[0];
  let top=s[1]-12;
  if(top-popH<10){
    top=s[1]+28;
    pop.style.transform='translate(-50%, 0)';
  }else{
    top=s[1]-12;
    pop.style.transform='translate(-50%, -100%)';
  }
  left=Math.max(popW/2+10,Math.min(rect.width-popW/2-10,left));
  top=Math.max(10,Math.min(rect.height-10,top));
  pop.style.left=left+'px';
  pop.style.top=top+'px';
}
function showTextEditPopover(idx){
  const t=texts[idx];
  if(!t)return;
  selT=idx;
  const pop=$('textEditPopover');
  if(!pop)return;
  $('popNo').value=t.no||'';
  $('popSu').value=t.su||'';
  pop.classList.remove('hide');
  positionTextEditPopover(idx);
  setTimeout(()=>{
    $('popNo').focus();
    $('popNo').select();
  },50);
}
function closeTextEditPopover(){
  const pop=$('textEditPopover');
  if(pop)pop.classList.add('hide');
}
$('tno').oninput=e=>{
  if(texts[selT]){
    texts[selT].no=e.target.value;
    const p=$('popNo');if(p)p.value=e.target.value;
    dirty=true;draw();
  }
};
$('tsu').oninput=e=>{
  if(texts[selT]){
    texts[selT].su=e.target.value;
    const p=$('popSu');if(p)p.value=e.target.value;
    dirty=true;draw();
  }
};
$('popNo')?.addEventListener('input',e=>{
  if(selT>=0&&texts[selT]){
    texts[selT].no=e.target.value;
    $('tno').value=e.target.value;
    dirty=true;draw();
  }
});
$('popSu')?.addEventListener('input',e=>{
  if(selT>=0&&texts[selT]){
    texts[selT].su=e.target.value;
    $('tsu').value=e.target.value;
    dirty=true;draw();
  }
});
$('popSave')?.addEventListener('click',()=>closeTextEditPopover());
$('popoverClose')?.addEventListener('click',()=>closeTextEditPopover());
$('popDel')?.addEventListener('click',()=>{
  if(selT>=0&&texts[selT]){
    snapshot();texts.splice(selT,1);selT=-1;
    closeTextEditPopover();tform();stat();draw();
  }
});
$('popNo')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    if(!$('popSu').value.trim())$('popSu').focus();
    else closeTextEditPopover();
  }else if(e.key==='Escape'){
    e.preventDefault();closeTextEditPopover();
  }
});
$('popSu')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();closeTextEditPopover();
  }else if(e.key==='Escape'){
    e.preventDefault();closeTextEditPopover();
  }
});
const popEl=$('textEditPopover');
if(popEl){
  popEl.addEventListener('pointerdown',e=>e.stopPropagation());
  popEl.addEventListener('mousedown',e=>e.stopPropagation());
  popEl.addEventListener('wheel',e=>e.stopPropagation());
}
$('tdel').onclick=()=>{if(selT>=0){snapshot();texts.splice(selT,1);selT=-1;closeTextEditPopover();tform();stat();draw()}};
const stat=()=>$('cnt').textContent=lines.length+' rangkaian garis, '+texts.length+' teks';

function parseCadastralText(text){
  if(!text)return {no:'',su:'',raw:''};
  const raw=String(text).trim();
  // Normalisasi separator seperti pipe atau backslash di antara angka (misal: 3997|1982 -> 3997/1982)
  const norm=raw.replace(/(\d+)\s*[\\|lI]\s*(\d{2,4})/g,'$1/$2');
  const lines=norm.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

  let no='', su='';
  const suRegex=/(?:SU|S\.U|GS|G\.S|SURAT\s*UKUR)[\s.:]*([0-9\/\-]+(?:\/[0-9]+)?)/i;
  const hakRegex=/(?:HAK\s+MILIK|MILIK|HGB|HM|HP|HGU|HPL|GIRIK|LETTER\s*C|M|C)[\s.:]+([0-9]+[A-Z0-9\/\-]*)/i;
  const slashPattern=/\b\d{1,6}\s*\/\s*(?:19|20)?\d{2,4}\b/;

  const rem=[];
  for(const line of lines){
    if(!su && suRegex.test(line)){
      const m=line.match(suRegex);
      const isGS=/GS|G\.S/i.test(line);
      su=(isGS?'GS.':'SU.')+m[1].replace(/\s+/g,'');
      continue;
    }
    if(!no && hakRegex.test(line)){
      const m=line.match(hakRegex);
      const u=line.toUpperCase();
      let pfx='M.';
      if(u.includes('HGB')) pfx='HGB.';
      else if(u.includes('HGU')) pfx='HGU.';
      else if(u.includes('HP')) pfx='HP.';
      else if(u.includes('HPL')) pfx='HPL.';
      else if(u.includes('LETTER')||u.includes('C.')||u.startsWith('C ')) pfx='C.';
      no=pfx+m[1].replace(/\s+/g,'');
      continue;
    }
    rem.push(line);
  }

  // Jika SU belum ditemukan, cari pola garis miring (seperti nomor/tahun)
  if(!su){
    const idx=rem.findIndex(l=>slashPattern.test(l));
    if(idx>=0){
      const match=rem[idx].match(slashPattern)[0].replace(/\s+/g,'');
      const isGS=/GS|G\.S/i.test(rem[idx]);
      su=(isGS?'GS.':'SU.')+match;
      rem.splice(idx,1);
    }
  }

  // Jika Nomor Hak belum ditemukan, ambil baris pertama yang ada angka/huruf
  if(!no && rem.length>0){
    let cand=rem[0].replace(/[^a-zA-Z0-9\/\.\-]/g,'').trim();
    if(cand){
      if(/^[Mm]\d+/.test(cand)) cand='M.'+cand.slice(1);
      no=cand;
      rem.shift();
    }
  }

  // Jika SU masih kosong dan masih ada baris dengan slash
  if(!su && rem.length>0){
    let cand=rem[0].replace(/[^a-zA-Z0-9\/\.\-]/g,'').trim();
    if(cand.includes('/')) su=cand.startsWith('SU')||cand.startsWith('GS')?cand:'SU.'+cand;
  }

  // Fallback jika pola regex tidak cocok tapi teks terdeteksi
  if(!no && !su && raw){
    const clean=raw.replace(/\r?\n+/g,' ').replace(/[^\w\s\/\.\-]/g,'').trim();
    if(clean.includes('/')) su=clean.startsWith('SU')||clean.startsWith('GS')?clean:'SU.'+clean;
    else no=clean;
  }

  return {no, su, raw};
}

async function initOcrWorker(progressCb){
  if(ocrWorker) return ocrWorker;
  if(typeof Tesseract==='undefined'){
    throw new Error('Pustaka OCR (Tesseract.js) belum termuat. Periksa koneksi internet Anda.');
  }
  const worker=await Tesseract.createWorker('eng',1,{
    logger:m=>{
      if(progressCb && m.status==='recognizing text'){
        progressCb(Math.round((m.progress||0)*100));
      }
    }
  });
  ocrWorker=worker;
  return worker;
}

async function runOcr(R){
  if(!img){alert('Buka peta terlebih dahulu.');return;}
  if(!R||R.w<6||R.h<6){
    $('st').innerHTML='<span class="status-dot" style="background:#f59e0b"></span><span>Kotak seleksi terlalu kecil; tarik kotak melingkupi teks nomor bidang.</span>';
    return;
  }
  if(ocrBusy){
    $('st').innerHTML='<span class="status-dot" style="background:#f59e0b"></span><span>Sedang memproses OCR sebelumnya...</span>';
    return;
  }
  ocrBusy=true;
  const statusEl=$('ocrStatusMsg');
  const setStatus=txt=>{
    if(statusEl)statusEl.innerHTML=txt;
    $('st').innerHTML='<span class="status-dot" style="background:#10b981"></span><span>'+txt+'</span>';
  };
  setStatus('Menyiapkan gambar dan OCR...');

  try{
    // Potong area gambar ke canvas sementara dengan skala resolusi optimal
    const off=document.createElement('canvas');
    const scale=Math.max(1,Math.min(3,Math.round(90/Math.max(R.h,20))));
    const cw=Math.round(R.w*scale), ch=Math.round(R.h*scale);
    off.width=cw; off.height=ch;
    const octx=off.getContext('2d');
    octx.imageSmoothingEnabled=true;
    octx.imageSmoothingQuality='high';
    octx.drawImage(img,R.x,R.y,R.w,R.h,0,0,cw,ch);

    // Pra-pemrosesan: grayscale & peningkatan kontras
    const imgData=octx.getImageData(0,0,cw,ch);
    const data=imgData.data;
    let minLum=255, maxLum=0;
    for(let i=0;i<data.length;i+=4){
      const g=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];
      data[i]=g; data[i+1]=g; data[i+2]=g;
      if(g<minLum)minLum=g;
      if(g>maxLum)maxLum=g;
    }
    const lumRange=maxLum-minLum;
    if(lumRange>25){
      for(let i=0;i<data.length;i+=4){
        let g=((data[i]-minLum)*255)/lumRange;
        g=g>130?Math.min(255,g*1.1):Math.max(0,g*0.9);
        data[i]=g; data[i+1]=g; data[i+2]=g;
      }
    }
    octx.putImageData(imgData,0,0);

    setStatus('Mengenali karakter OCR...');
    const worker=await initOcrWorker(pct=>{
      setStatus('Membaca teks bidang... '+pct+'%');
    });

    const res=await worker.recognize(off);
    const rawText=res?.data?.text||'';
    const parsed=parseCadastralText(rawText);

    if(!parsed.no && !parsed.su){
      setStatus('Teks tidak terdeteksi jelas ('+(rawText.trim()?'"'+esc(rawText.trim())+'"':'kosong')+'). Silakan tarik ulang atau ketik manual.');
    }else{
      snapshot();
      const targetPt=[Math.round(R.x+R.w/2),Math.round(R.y+R.h/2)];
      if(reOcrTarget!==null && texts[reOcrTarget]){
        if(parsed.no) texts[reOcrTarget].no=parsed.no;
        if(parsed.su) texts[reOcrTarget].su=parsed.su;
        selT=reOcrTarget;
        reOcrTarget=null;
        setStatus('OCR diperbarui: <b>'+esc(parsed.no||'-')+'</b>'+(parsed.su?' / <b>'+esc(parsed.su)+'</b>':''));
      }else{
        texts.push({
          p: targetPt,
          no: parsed.no,
          su: parsed.su
        });
        selT=texts.length-1;
        setStatus('OCR berhasil: <b>'+esc(parsed.no||'-')+'</b>'+(parsed.su?' / <b>'+esc(parsed.su)+'</b>':''));
      }
      tform(true);
      showTextEditPopover(selT);
      stat();
      draw();
    }
  }catch(err){
    console.error('PlotPeta OCR error:',err);
    setStatus('Gagal memproses OCR: '+(err&&err.message?err.message:'kesalahan sistem'));
  }finally{
    ocrBusy=false;
  }
}

$('btnOcrTool')?.addEventListener('click',()=>setTool('ocr'));
$('btnOcrSelected')?.addEventListener('click',()=>{
  if(selT>=0){
    reOcrTarget=selT;
    setTool('ocr');
    $('st').innerHTML='<span class="status-dot" style="background:#10b981"></span><span>Tarik kotak OCR di atas teks bidang pada peta untuk memperbarui teks terpilih.</span>';
    const msg=$('ocrStatusMsg');if(msg)msg.innerHTML='Tarik kotak di atas teks nomor bidang pada peta untuk memperbarui teks terpilih.';
  }
});

function draw(){
  const d=d1();
  ctx.setTransform(d,0,0,d,0,0);
  ctx.clearRect(0,0,W(),H());
  if(!img)return;
  ctx.drawImage(img,V.x,V.y,iw*V.s,ih*V.s);
  if(helperPreview&&helperPreviewImg===img&&$('helperViewToggle')?.checked){
    ctx.save();
    ctx.globalAlpha=.86;ctx.fillStyle='#fff';ctx.fillRect(V.x,V.y,iw*V.s,ih*V.s);
    ctx.globalAlpha=.96;ctx.drawImage(helperPreview,V.x,V.y,iw*V.s,ih*V.s);
    ctx.restore();
  }
  const path=pts=>{
    ctx.beginPath();
    pts.forEach((p,i)=>{const s=toS(p);i?ctx.lineTo(s[0],s[1]):ctx.moveTo(s[0],s[1])});
  };
  lines.forEach(l=>{
    path(l.pts);
    ctx.strokeStyle='#d62a2a';
    ctx.lineWidth=1.8;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  texts.forEach((t,i)=>{
    const s=toS(t.p);
    ctx.textAlign='center';
    ctx.font='bold 12px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.lineWidth=3;
    ctx.strokeStyle='#fff';
    ctx.fillStyle=i===selT?'#0ea5e9':'#111';
    ctx.strokeText(t.no||'(no)',s[0],s[1]);
    ctx.fillText(t.no||'(no)',s[0],s[1]);
    ctx.font='11px "Plus Jakarta Sans", system-ui, sans-serif';
    if(t.su){
      ctx.strokeText(t.su,s[0],s[1]+13);
      ctx.fillText(t.su,s[0],s[1]+13);
    }
    ctx.fillStyle='#0ea5e9';
    ctx.fillRect(s[0]-2,s[1]-2,4,4);
  });
  if(cur.length){
    path(cur);
    ctx.strokeStyle='#0ea5e9';
    ctx.lineWidth=2;
    ctx.stroke();
    if(mouse&&(tool==='P')){
      const l=toS(cur[cur.length-1]);
      ctx.setLineDash([5,4]);
      ctx.beginPath();
      ctx.moveTo(l[0],l[1]);
      ctx.lineTo(mouse[0],mouse[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    cur.forEach((p,i)=>{
      const s=toS(p);
      ctx.fillStyle=i?'#0ea5e9':'#ef4444';
      ctx.beginPath();
      ctx.arc(s[0],s[1],i?3.5:5.5,0,7);
      ctx.fill();
    });
  }
  if(mouse&&(tool==='P')){
    const q=snapPt(toI(mouse)),s=toS(q);
    ctx.strokeStyle='#10b981';
    ctx.lineWidth=1.8;
    ctx.beginPath();
    ctx.arc(s[0],s[1],6,0,7);
    ctx.stroke();
  }
  polys.forEach(pg=>{
    path(pg);
    ctx.closePath();
    ctx.fillStyle='rgba(14,165,233,.14)';
    ctx.fill();
    ctx.strokeStyle='rgba(14,165,233,.75)';
    ctx.lineWidth=1.2;
    ctx.stroke();
  });
  gaps.forEach(p=>{
    const s=toS(p);
    ctx.strokeStyle='#ef4444';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(s[0],s[1],8,0,7);
    ctx.stroke();
  });
  cand.forEach(c=>{
    path(c.pts);
    ctx.strokeStyle='#f59e0b';
    ctx.lineWidth=2;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  if(tool==='M')editTarget().forEach(l=>l.pts.forEach(p=>{
    const s=toS(p);
    ctx.strokeStyle='#0ea5e9';
    ctx.fillStyle='#fff';
    ctx.lineWidth=1.5;
    ctx.fillRect(s[0]-3.5,s[1]-3.5,7,7);
    ctx.strokeRect(s[0]-3.5,s[1]-3.5,7,7);
  }));
  if(tool==='M'&&addLinePick&&mouse){
    const s=toS(addLinePick.pt);
    ctx.save();
    ctx.setLineDash([6,4]);
    ctx.strokeStyle='#0ea5e9';
    ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(mouse[0],mouse[1]);ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(mouse[0],mouse[1],5,0,Math.PI*2);
    ctx.fillStyle='#10b981';ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
    ctx.restore();
  }
  if(tool==='E'&&eraseModeEl?.value==='click'&&erasePick){
    const l=lines[erasePick.li],p=l&&l.pts[erasePick.pi];
    if(p){
      const s=toS(p);
      ctx.beginPath();
      ctx.arc(s[0],s[1],6,0,Math.PI*2);
      ctx.fillStyle='#ef4444';
      ctx.strokeStyle='#fff';
      ctx.lineWidth=2;
      ctx.fill();ctx.stroke();
    }
  }
  if(mouse&&tool==='trim'){
    const x=mouse[0],y=mouse[1];
    const sc=()=>{
      ctx.beginPath();ctx.arc(-6,-6,3.5,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.arc(-6,6,3.5,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-2,-3);ctx.lineTo(8,7);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-2,3);ctx.lineTo(8,-7);ctx.stroke();
    };
    ctx.save();
    ctx.translate(x-2,y);
    ctx.scale(.8,.8);
    ctx.strokeStyle='#fff';
    ctx.lineWidth=4;
    sc();
    ctx.strokeStyle='#111';
    ctx.lineWidth=2;
    sc();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x,y,2,0,Math.PI*2);
    ctx.fillStyle='#ef4444';
    ctx.fill();
  }
  if(box){
    ctx.save();
    if(boxAction==='ocr'){
      ctx.setLineDash([5,3]);
      ctx.strokeStyle='#10b981';
      ctx.lineWidth=1.8;
      ctx.strokeRect(box.x0,box.y0,box.x1-box.x0,box.y1-box.y0);
      ctx.fillStyle='rgba(16,185,129,0.15)';
      ctx.fillRect(box.x0,box.y0,box.x1-box.x0,box.y1-box.y0);
    } else {
      ctx.setLineDash([6,4]);
      ctx.strokeStyle='#0ea5e9';
      ctx.lineWidth=1.6;
      ctx.strokeRect(box.x0,box.y0,box.x1-box.x0,box.y1-box.y0);
    }
    ctx.restore();
  }
  if(selectionPoly.length){
    ctx.save(); ctx.beginPath(); selectionPoly.forEach((pt,i)=>i?ctx.lineTo(pt[0],pt[1]):ctx.moveTo(pt[0],pt[1]));
    if(selectionPoly.length>2)ctx.closePath(); ctx.strokeStyle=tool==='E'?'#ef4444':'#0ea5e9'; ctx.fillStyle=tool==='E'?'rgba(239,68,68,.10)':'rgba(14,165,233,.12)'; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.fill(); ctx.stroke(); ctx.setLineDash([]); selectionPoly.forEach(pt=>{ctx.beginPath();ctx.arc(pt[0],pt[1],3,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill()}); ctx.restore();
  }
  cal.pts.forEach((p,i)=>{
    const s=toS(p);
    ctx.strokeStyle='#ec4899';
    ctx.lineWidth=2.2;
    ctx.beginPath();
    ctx.moveTo(s[0]-10,s[1]);
    ctx.lineTo(s[0]+10,s[1]);
    ctx.moveTo(s[0],s[1]-10);
    ctx.lineTo(s[0]+10,s[1]);
    ctx.stroke();
    ctx.fillStyle='#ec4899';
    ctx.font='bold 12px "JetBrains Mono", monospace';
    ctx.textAlign='left';
    ctx.fillText('P'+(i+1),s[0]+10,s[1]-8);
  });
  if(selT>=0 && !$('textEditPopover')?.classList.contains('hide')){
    positionTextEditPopover(selT);
  }
}

// Pembuatan DXF dipindahkan ke server (Edge Function export-dxf), tidak ada lagi di browser.

let CT=null;
function crc(b){
  if(!CT){CT=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CT[n]=c>>>0}}
  let c=0xFFFFFFFF;for(const x of b)c=CT[(c^x)&255]^(c>>>8);
  return(c^0xFFFFFFFF)>>>0;
}
function zip(name,data){
  const nm=new TextEncoder().encode(name),c=crc(data),sz=data.length,u16=v=>[v&255,v>>8&255],u32=v=>[v&255,v>>8&255,v>>16&255,v>>24&255];
  const lh=[0x50,0x4b,3,4,...u16(20),...u16(0),...u16(0),...u16(0x21),...u32(c),...u32(sz),...u32(sz),...u16(nm.length),...u16(0)];
  const cd=[0x50,0x4b,1,2,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0x21),...u32(c),...u32(sz),...u32(sz),...u16(nm.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(0)];
  const off=lh.length+nm.length+sz,cds=cd.length+nm.length,eo=[0x50,0x4b,5,6,...u16(0),...u16(0),...u16(1),...u16(1),...u32(cds),...u32(off),...u16(0)];
  return new Blob([new Uint8Array(lh),nm,data,new Uint8Array(cd),nm,new Uint8Array(eo)],{type:'application/zip'});
}
async function save(name,data){
  try{
    const b=data instanceof Blob?data:new Blob([data],{type:'application/octet-stream'}),u=URL.createObjectURL(b),a=document.createElement('a');
    a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),4000);
    return true;
  }catch(e){return false}
}
function ready(){
  if(cal.mode==='map'&&!cal.ok){alert('Lengkapi 4 titik dan koordinat sebenarnya pada kalibrasi sebelum ekspor.');return false}
  if(!lines.length&&!texts.length&&!polys.length){alert('Belum ada garis, poligon, atau teks yang digambar.');return false}
  return true;
}

// Local save & open (Free, no token required)
// Hapus peta yang sedang terbuka tanpa menghapus proyek cloud atau file asli pengguna.
$('btnClearMap').onclick=async()=>{
  if(!img && !lines.length && !texts.length && !polys.length){
    alert('Belum ada peta atau pekerjaan yang sedang terbuka.');
    return;
  }
  if(!confirm('Hapus peta yang sedang terbuka beserta semua garis, poligon, teks, dan kalibrasinya? Proyek yang sudah disimpan di Cloud tidak ikut terhapus.')) return;
  img=null; iw=0; ih=0; mapName='';
  lines=[]; texts=[]; polys=[]; gaps=[]; cand=[]; cur=[]; hist=[];
  helperPreview=null; helperPreviewImg=null; helperPreviewBusy=false;
  if($('helperViewToggle')) $('helperViewToggle').checked=false;
  if($('helperViewMsg')) $('helperViewMsg').textContent='';
  selT=-1; dirty=false; box=null; mv=null; drag=null; mouse=null; erasePick=null;addLinePick=null;
  cal.pts=[]; cal.ok=false; cal.M=null;
  ['cx0','cy0','cx1','cy1','cx2','cy2','cx3','cy3'].forEach(id=>{ if($(id)) $(id).value=''; });
  setCoordMode('local'); crs(); tform(); stat();
  $('file').value='';
  $('st').innerHTML='<span class="status-dot"></span><span>Belum ada peta</span>';
  updateDropzone(); draw();
  if(window.__ppClear){ try{await window.__ppClear();}catch(e){console.warn('Pemulihan otomatis tidak bisa dibersihkan:',e);} }
  alert('Peta dan pekerjaan yang sedang terbuka sudah dihapus.');
};

$('sp').onclick=async()=>{
  if(!img){alert('Buka peta terlebih dahulu sebelum menyimpan proyek.');return;}
  const base=(mapName?mapName.replace(/\.[^.]+$/,''):'')||'proyek_peta';
  let nama='';
  while(true){
    const v=window.prompt('Beri nama proyek ini:',base);
    if(v===null)return;
    nama=v.replace(/[\\\/:*?"<>|\u0000-\u001f]/g,'').replace(/\.json$/i,'').trim().slice(0,100);
    if(nama)break;
    alert('Nama proyek tidak boleh kosong.');
  }
  const o={v:1,nama,size:[iw,ih],coordinateMode:cal.mode,cal:cal.pts.map((p,i)=>({p,x:$('cx'+i).value,y:$('cy'+i).value})),lines,texts,th:$('th').value,ly:['lP','lD','lSu','lM','lPoly'].map(i=>$(i).value)};
  const ok=await save(nama+'.json',JSON.stringify(o));
  if(ok){dirty=false;if(window.__ppSaved)await window.__ppSaved();}
  else alert('Simpan proyek tidak tersedia di tampilan ini.');
};
$('op').onchange=e=>{
  const f=e.target.files[0];
  if(!f)return;
  f.text().then(t=>{
    try{
      const o=JSON.parse(t);
      lines=o.lines||[];erasePick=null;addLinePick=null;
      texts=o.texts||[];
      cal.pts=(o.cal||[]).map(c=>c.p);
      setCoordMode(o.coordinateMode || (cal.pts.length===4?'map':'local'));
      crs();
      (o.cal||[]).forEach((c,i)=>{$('cx'+i).value=c.x;$('cy'+i).value=c.y});
      $('th').value=o.th||5;
      if(o.ly)['lP','lD','lSu','lM','lPoly'].forEach((i,k)=>{$(i).value=o.ly[k]});
      hist=[];cur=[];selT=-1;tform();stat();
      if(cal.pts.length===4)fitCal();
      dirty=false;
      if(img&&o.size&&(o.size[0]!==iw||o.size[1]!==ih))alert('Ukuran peta berbeda dari proyek. Pastikan membuka file peta yang sama.');
      draw();
    }catch(x){alert('File proyek tidak valid.')}
  });
};
function findV(sp){
  let hit=null,bd=10;
  const all=[];
  const target=editTarget();
  target.forEach(l=>l.pts.forEach(q=>all.push(q)));
  if(!cand.length) texts.forEach(t=>all.push(t.p));
  for(const q of all){
    const s=toS(q),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
    if(d<bd){bd=d;hit=q}
  }
  if(!hit)return null;
  const isT=!cand.length&&texts.some(t=>t.p===hit);
  return{refs:isT?[hit]:all.filter(q=>Math.abs(q[0]-hit[0])<.01&&Math.abs(q[1]-hit[1])<.01&&!texts.some(t=>t.p===q))};
}
function movePt(sp){
  let p=toI(sp);
  if($('snap').checked){
    let best=null,bd=10;
    for(const l of editTarget())for(const q of l.pts){
      if(mv.refs.includes(q))continue;
      const s=toS(q),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
      if(d<bd){bd=d;best=q}
    }
    if(best)p=best;
  }
  mv.refs.forEach(q=>{q[0]=p[0];q[1]=p[1]});
  dirty=true;
}
