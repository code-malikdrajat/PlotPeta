// PlotPeta: Inisialisasi awal, pemulihan otomatis (IndexedDB), Google Identity
// Initial Setup
crs();
setTool('pan');
resize();
stat();
updateDropzone();

// ==================== PEMULIHAN OTOMATIS (disimpan hanya di browser ini) ====================
// Menyimpan file peta terakhir dan pekerjaan yang sedang berjalan di IndexedDB,
// lalu memulihkannya saat halaman dibuka. Tidak menyentuh token: DXF tetap dibuat di server.
(function(){
  const DB='plotpeta_auto', ST='kv', K_IMG='img', K_PRJ='proj';
  let restoring=true, lastJson='', savedSnap=null, lastFile=null, imgStored=false, busy=false;

  const openDb=()=>new Promise((res,rej)=>{
    if(!window.indexedDB){rej(new Error('IndexedDB tidak tersedia'));return}
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(ST);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
  const tx=(mode,fn)=>openDb().then(db=>new Promise((res,rej)=>{
    const t=db.transaction(ST,mode),rq=fn(t.objectStore(ST));
    t.oncomplete=()=>{db.close();res(rq&&rq.result)};
    t.onerror=t.onabort=()=>{db.close();rej(t.error)};
  }));
  const getK=k=>tx('readonly',s=>s.get(k));
  const putK=(k,v)=>tx('readwrite',s=>s.put(v,k));
  const clearAll=()=>tx('readwrite',s=>s.clear());
  window.__ppClear=clearAll;

  function toast(msg){
    const d=document.createElement('div');
    d.textContent=msg;
    d.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:90vw;padding:10px 14px;border-radius:8px;font-size:13px;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border);box-shadow:0 4px 16px rgba(0,0,0,.25)';
    document.body.appendChild(d);
    setTimeout(()=>d.remove(),6000);
  }

  const proj=()=>({v:1,size:[iw,ih],coordinateMode:cal.mode,cal:cal.pts.map((p,i)=>({p,x:$('cx'+i).value,y:$('cy'+i).value})),lines,texts,polys,th:$('th').value,ly:['lP','lD','lSu','lM','lPoly'].map(i=>$(i).value)});

  // Simpan file peta setiap kali pengguna memilih peta baru
  $('file').addEventListener('change',e=>{
    const f=e.target.files&&e.target.files[0];
    if(!f||restoring)return;
    mapName=f.name;
    lastFile=f;savedSnap=null;lastJson='';imgStored=false;
    putK(K_IMG,{blob:f,name:f.name,type:f.type}).then(()=>{imgStored=true}).catch(err=>{
      console.warn('Peta tidak bisa disimpan otomatis:',err);
      toast('Peta ini tidak bisa disimpan otomatis (mungkin terlalu besar). Setelah reload, buka peta lagi lalu pilih Buka lokal.');
    });
  });

  // Simpan pekerjaan secara berkala jika ada perubahan
  async function tick(){
    if(restoring||busy||!img)return;
    let s;
    try{s=JSON.stringify(proj())}catch(_){return}
    if(s===lastJson||s===savedSnap)return;
    busy=true;
    try{
      if(!imgStored&&lastFile){
        await putK(K_IMG,{blob:lastFile,name:lastFile.name,type:lastFile.type});
        imgStored=true;
      }
      await putK(K_PRJ,s);
      lastJson=s;
    }catch(_){}
    busy=false;
  }
  setInterval(tick,3000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')tick()});

  // Dipanggil setelah proyek berhasil disimpan (lokal atau cloud): data pemulihan dihapus.
  // Jika pengguna lanjut mengubah gambar, pemulihan otomatis aktif lagi.
  window.__ppSaved=async()=>{
    try{savedSnap=JSON.stringify(proj())}catch(_){savedSnap=null}
    lastJson='';imgStored=false;
    try{await clearAll()}catch(_){}
  };

  async function restore(){
    try{
      const rec=await getK(K_IMG);
      if(!rec||!rec.blob)return;
      const prj=await getK(K_PRJ);
      const file=new File([rec.blob],rec.name||'peta',{type:rec.type||rec.blob.type||''});
      mapName=file.name;lastFile=file;imgStored=true;
      $('file').onchange({target:{files:[file]}});
      const t0=Date.now();
      while(!img){
        if(/gagal|tidak termuat/i.test($('st').textContent))throw new Error('Peta tersimpan tidak bisa dibaca');
        if(Date.now()-t0>90000)throw new Error('Waktu habis memuat peta');
        await new Promise(r=>setTimeout(r,100));
      }
      if(prj){
        const o=JSON.parse(prj);
        lines=o.lines||[];erasePick=null;addLinePick=null;texts=o.texts||[];polys=o.polys||[];gaps=[];cand=[];
        cal.ok=false;cal.M=null;
        cal.pts=(o.cal||[]).map(c=>c.p);
        setCoordMode(o.coordinateMode || (cal.pts.length===4?'map':'local'));
        crs();
        (o.cal||[]).forEach((c,i)=>{$('cx'+i).value=c.x;$('cy'+i).value=c.y});
        $('th').value=o.th||5;
        if(o.ly)['lP','lD','lSu','lM','lPoly'].forEach((id,k)=>{if(o.ly[k]!=null)$(id).value=o.ly[k]});
        hist=[];cur=[];selT=-1;
        tform();stat();
        if(cal.pts.length===4)fitCal();
        lastJson=prj;
      }
      dirty=false;
      draw();
      toast('Peta dan pekerjaan terakhir Anda dipulihkan otomatis.');
    }catch(e){
      console.warn('Pemulihan otomatis gagal:',e);
    }finally{
      restoring=false;
    }
  }
  restore();
})();

// Auto-initialize Google Identity Services if available
window.addEventListener('load', () => {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      auto_select: false
    });
  }
});
