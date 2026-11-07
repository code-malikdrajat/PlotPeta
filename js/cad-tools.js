/* PlotPeta: alat Trim/Extend. Logika geometri murni ada di js/cad-geom.js;
 * berkas ini hanya menghubungkan pemilihan, hover, snapshot, dan array
 * lines/cand. Kait core.js sengaja tipis. */
let cadHover=null, cadHoverRAF=0, cadHoverSig='';

function cadTool(){return tool==='TRIM'||tool==='EXT'}
function cadMode(){return tool==='TRIM'?(shiftDown?'ext':'trim'):(shiftDown?'trim':'ext')}
function cadTol(){
  try{
    const el=$('cadTol')||$('pTol');
    const v=typeof num==='function'?num(el.value):parseFloat(el.value);
    return Math.max(1,isFinite(v)?v:8);
  }catch(_){return 8}
}
function cadResetHover(){
  if(cadHoverRAF){cancelAnimationFrame(cadHoverRAF);cadHoverRAF=0}
  cadHover=null;cadHoverSig='';
}
function cadChainNear(c,p,radius){
  if(!c||!Array.isArray(c.pts)||!c.pts.length)return false;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of c.pts){
    if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];
    if(q[1]<y0)y0=q[1];if(q[1]>y1)y1=q[1];
  }
  return x1>=p[0]-radius&&x0<=p[0]+radius&&y1>=p[1]-radius&&y0<=p[1]+radius;
}
function cadPick(sp,maxD=16){
  let best=null,bd=maxD;
  const groups=[['lines',lines],['cand',cand]];
  for(const [arrName,arr] of groups){
    for(let li=0;li<arr.length;li++){
      const c=arr[li],pts=c&&c.pts;
      if(!pts||pts.length<2)continue;
      const n=c.closed?pts.length:pts.length-1;
      for(let si=0;si<n;si++){
        const a=toS(pts[si]),b=toS(pts[(si+1)%pts.length]);
        const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
        let t=L2?((sp[0]-a[0])*dx+(sp[1]-a[1])*dy)/L2:0;
        t=Math.max(0,Math.min(1,t));
        const x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(sp[0]-x,sp[1]-y);
        if(d<bd){
          bd=d;
          best={arr,arrName,li,si,t,chain:c,
            pt:[pts[si][0]+t*(pts[(si+1)%pts.length][0]-pts[si][0]),pts[si][1]+t*(pts[(si+1)%pts.length][1]-pts[si][1])]};
        }
      }
    }
  }
  return best;
}
function cadCutters(chain,p,radius){
  const out=[];
  for(const arr of [lines,cand])for(const c of arr){
    if(c===chain||!c||!c.pts||c.pts.length<2)continue;
    if(radius>0&&p&&!cadChainNear(c,p,radius))continue;
    out.push(c);
  }
  return out;
}
function cadCopyProps(c){
  const o={};
  for(const k in c)if(k!=='pts'&&k!=='closed'&&k!=='free'&&k!=='nums')o[k]=c[k];
  return o;
}
function cadPieceProps(orig,piece,isCand){
  const o=Object.assign(cadCopyProps(orig),{pts:piece.pts,closed:false});
  if(isCand){
    const f=Array.isArray(orig.free)?orig.free:[false,false];
    const pts=orig.pts||[],a=piece.pts[0],b=piece.pts[piece.pts.length-1],last=pts[pts.length-1];
    const f0=!!(f[0]&&pts[0]&&Math.hypot(a[0]-pts[0][0],a[1]-pts[0][1])<1e-6);
    const f1=!!(f[1]&&last&&Math.hypot(b[0]-last[0],b[1]-last[1])<1e-6);
    o.free=[f0,f1];o.nums=[0,0];
  }
  return o;
}
function cadAfterEdit(isCand){
  if(typeof syncCandClean==='function')syncCandClean();
  if(isCand&&typeof plotPetaNumberEnds==='function'&&cand.length&&Array.isArray(cand[0].free))plotPetaNumberEnds(cand);
  if(typeof candMsg==='function')candMsg();
  try{if(typeof candPolySig!=='undefined')candPolySig=null}catch(_){}
  stat();draw();
}
function cadSay(msg){
  $('st').innerHTML='<span class="status-dot"></span><span>'+msg+'</span>';
}
function cadScheduleHover(){
  if(!cadTool()||!img||cadHoverRAF)return;
  cadHoverRAF=requestAnimationFrame(()=>{
    cadHoverRAF=0;
    if(!cadTool()||!img){cadHover=null;return}
    cadUpdateHover(mouse||[0,0]);
    draw();
  });
}
function cadUpdateHover(sp){
  const pick=cadPick(sp,16),mode=cadMode();
  if(!pick){cadHover=null;cadHoverSig='';return}
  const sig=pick.arrName+':'+pick.li+':'+pick.si+':'+mode+':'+Math.round(pick.t*1000);
  if(sig===cadHoverSig&&cadHover)return;
  const p=toI(sp),tol=cadTol();
  if(mode==='trim'){
    const range=cadTrimRange(pick.chain,cadCutters(pick.chain,p,800),p[0],p[1],tol);
    let pts=null;
    if(range){const q=range.model.piece(range.from,range.to);if(q)pts=q.pts}
    cadHover={kind:'trim',pick,mode,chain:pick.chain,pts,removeAll:!range};
  }else{
    const boundaries=cadCutters(pick.chain,null,0);
    cadHover={kind:'ext',pick,mode,chain:pick.chain,
      ext:cadExtend(pick.chain,boundaries,p[0],p[1],{tol,dirLen:25}),
      ray:cadExtendRay(pick.chain,p[0],p[1],{dirLen:25})};
  }
  cadHoverSig=sig;
}
function cadRayToCanvasEdge(a,ux,uy){
  let t=Infinity;
  if(ux>1e-9)t=Math.min(t,(W()-a[0])/ux);
  else if(ux<-1e-9)t=Math.min(t,(0-a[0])/ux);
  if(uy>1e-9)t=Math.min(t,(H()-a[1])/uy);
  else if(uy<-1e-9)t=Math.min(t,(0-a[1])/uy);
  if(!isFinite(t)||t<=0)t=Math.max(W(),H())*2;
  return [a[0]+ux*t,a[1]+uy*t];
}
function cadDrawHover(c,path){
  const h=cadHover;if(!h)return;
  if(h.kind==='trim'){
    const pts=h.pts||h.chain.pts;
    c.save();c.strokeStyle='#ef4444';c.lineWidth=4;c.lineCap='round';
    path(pts);c.stroke();c.restore();return;
  }
  const ray=h.ray;if(!ray)return;
  const a=toS(ray.end),len=Math.hypot(ray.dir[0],ray.dir[1]);if(!(len>1e-9))return;
  const ux=ray.dir[0]/len,uy=ray.dir[1]/len;
  if(h.ext){
    const b=toS(h.ext.hit.pt);
    c.save();c.strokeStyle='#14b8a6';c.lineWidth=2.5;c.setLineDash([7,5]);c.lineCap='round';
    c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();c.setLineDash([]);
    c.beginPath();c.arc(b[0],b[1],4.5,0,Math.PI*2);c.fillStyle='#14b8a6';c.fill();
    c.strokeStyle='#fff';c.lineWidth=1.5;c.stroke();c.restore();
  }else{
    const far=cadRayToCanvasEdge(a,ux,uy);
    c.save();c.strokeStyle='#ef4444';c.lineWidth=2;c.setLineDash([6,5]);c.lineCap='round';
    c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(far[0],far[1]);c.stroke();c.setLineDash([]);
    c.font='bold 12px "Plus Jakarta Sans",system-ui,sans-serif';c.textAlign='left';c.textBaseline='middle';
    c.strokeStyle='#fff';c.lineWidth=3;c.strokeText('tidak bertemu',a[0]+10,a[1]-12);
    c.fillStyle='#b91c1c';c.fillText('tidak bertemu',a[0]+10,a[1]-12);c.restore();
  }
}
function cadApply(sp){
  const pick=cadPick(sp,16);
  if(!pick){cadSay('Klik tepat pada rantai garis (maks. 16 px).');draw();return}
  const p=toI(sp),tol=cadTol(),mode=cadMode(),isCand=pick.arr===cand;
  if(mode==='trim'){
    const r=cadTrim(pick.chain,cadCutters(pick.chain,null,0),p[0],p[1],tol);
    snapshot();
    if(!r){
      pick.arr.splice(pick.li,1);
      cadSay('Tidak ada perpotongan; rantai dihapus.');
    }else{
      const pieces=r.add.map(q=>cadPieceProps(pick.chain,q,isCand));
      pick.arr.splice(pick.li,1,...pieces);
      cadSay('Trim: '+pieces.length+' bagian tersisa.');
    }
  }else{
    const r=cadExtend(pick.chain,cadCutters(pick.chain,null,0),p[0],p[1],{tol,dirLen:25});
    if(!r){cadSay('Tidak ada batas ke arah itu.');draw();return}
    snapshot();
    const next=Object.assign(cadCopyProps(pick.chain),{pts:r.pts,closed:false});
    if(isCand){
      const f=Array.isArray(pick.chain.free)?pick.chain.free.slice():[false,false];
      f[r.endIdx===0?0:1]=false;
      next.free=f;next.nums=[0,0];
    }
    pick.arr.splice(pick.li,1,next);
    cadSay('Extend: ujung '+(r.endIdx===0?'awal':'akhir')+' diperpanjang ('+r.mode+').');
  }
  cadHover=null;cadHoverSig='';hoverSeg=null;
  cadAfterEdit(isCand);
}
