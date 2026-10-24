// PlotPeta: Deteksi otomatis: gambar bantu, Hough, topologi, poligon bidang
// ===== ANALISIS OTOMATIS PARAMETER DETEKSI =====
// Menganalisis area gambar untuk menentukan parameter optimal secara adaptif.
function detectionScale(R){
  return Math.min(1,2400/Math.max(R.w,R.h));
}
function analyzeRegion(R){
  const sc=detectionScale(R);
  const w=Math.max(16,Math.round(R.w*sc)),h=Math.max(16,Math.round(R.h*sc)),N=w*h;
  const oc=document.createElement('canvas');oc.width=w;oc.height=h;
  const o=oc.getContext('2d',{willReadFrequently:true});
  o.fillStyle='#fff';o.fillRect(0,0,w,h);
  o.imageSmoothingQuality='high';
  o.drawImage(img,R.x,R.y,R.w,R.h,0,0,w,h);
  const D=o.getImageData(0,0,w,h).data;
  const gray=new Uint8Array(N),hist=new Uint32Array(256);
  for(let i=0;i<N;i++){
    const g=(.299*D[i*4]+.587*D[i*4+1]+.114*D[i*4+2])|0;
    gray[i]=g;hist[g]++;
  }
  let cnt=0,med=128;
  for(let k=0;k<256;k++){cnt+=hist[k];if(cnt>=N/2){med=k;break}}
  let mean=0;
  for(let k=0;k<256;k++)mean+=k*hist[k];
  mean/=N;
  const invert=mean>med;
  const I=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let rs=0;for(let x=0;x<w;x++){rs+=gray[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+rs}}
  const rad=Math.max(8,Math.min(24,Math.round(Math.min(w,h)*.04)));
  const diffs=new Uint32Array(256);
  const step=Math.max(1,Math.floor(Math.sqrt(N/160000)));
  let diffN=0;
  for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
    if(x<w-1){diffs[Math.min(255,Math.abs(gray[y*w+x+1]-gray[y*w+x]))]++;diffN++;}
    if(y<h-1){diffs[Math.min(255,Math.abs(gray[(y+1)*w+x]-gray[y*w+x]))]++;diffN++;}
  }
  let accD=0,medDiff=0;
  for(let k=0;k<256;k++){accD+=diffs[k];if(accD>=diffN/2){medDiff=k;break}}
  let dT=Math.round(medDiff*3.5+8);
  if(!(dT>0))dT=15;
  dT=Math.max(15,Math.min(60,dT));
  let variance=0;
  for(let k=0;k<256;k++)variance+=hist[k]*(k-mean)*(k-mean);
  const std=Math.sqrt(variance/N);
  const runs=[];
  const rowStep=Math.max(1,Math.floor(h/800));
  for(let y=0;y<h;y+=rowStep){
    const y0=Math.max(0,y-rad),y1=Math.min(h,y+rad+1);
    let inRun=false,runLen=0;
    for(let x=0;x<w;x++){
      const x0=Math.max(0,x-rad),x1=Math.min(w,x+rad+1);
      const m=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
      const d=invert?gray[y*w+x]-m:m-gray[y*w+x];
      if(d>dT){
        if(!inRun){inRun=true;runLen=1;}else runLen++;
      }else{
        if(inRun&&runLen<=30)runs.push(runLen);
        inRun=false;runLen=0;
      }
    }
    if(inRun&&runLen<=30)runs.push(runLen);
  }
  runs.sort((a,b)=>a-b);
  const medRun=runs.length?runs[Math.floor(runs.length*.5)]:2;
  const dL=Math.max(40,Math.min(300,Math.round(Math.min(R.w*.045,Math.min(R.w,R.h)*.25))));
  const dG=Math.max(10,Math.min(100,Math.round((medRun/sc)*8)));
  const magR=Math.max(15,Math.min(60,Math.round(medRun*6.4)));
  const linkMax=Math.max(60,Math.min(250,Math.round(dG*2.4/10)*10));
  return{dT,dL,dG,magR,linkMax,medRun,std,invert};
}

// ===== HAPUS GARIS DOBEL =====
// Membuang kandidat garis yang hampir sejajar, terlalu dekat, dan tumpang-tindih.
// Urutkan dari terpanjang agar yang lebih pendek yang dibuang saat ada duplikasi.
function removeDuplicates(segs){
  const angleDiff=(a,b)=>{let d=Math.abs(a-b)%Math.PI;return Math.min(d,Math.PI-d);};
  segs.sort((a,b)=>{
    const la=Math.hypot(a[2]-a[0],a[3]-a[1]);
    const lb=Math.hypot(b[2]-b[0],b[3]-b[1]);
    return lb-la;
  });
  const out=[];
  for(const q of segs){
    const qlen=Math.hypot(q[2]-q[0],q[3]-q[1]);
    if(qlen<2) continue;
    const qa=Math.atan2(q[3]-q[1],q[2]-q[0]);
    let dup=false;
    for(const o of out){
      const olen=Math.hypot(o[2]-o[0],o[3]-o[1]);
      if(!olen) continue;
      const oa=Math.atan2(o[3]-o[1],o[2]-o[0]);
      if(angleDiff(qa,oa)>Math.PI/18) continue; // sudut beda >10°: bukan duplikat
      // Jarak tegak lurus antar dua garis
      const nx=-(o[3]-o[1])/olen,ny=(o[2]-o[0])/olen;
      const d1=Math.abs((q[0]-o[0])*nx+(q[1]-o[1])*ny);
      const d2=Math.abs((q[2]-o[0])*nx+(q[3]-o[1])*ny);
      if(Math.max(d1,d2)>8) continue;
      // Overlap sepanjang sumbu garis utama
      const ux=(o[2]-o[0])/olen,uy=(o[3]-o[1])/olen;
      const a1=(q[0]-o[0])*ux+(q[1]-o[1])*uy;
      const a2=(q[2]-o[0])*ux+(q[3]-o[1])*uy;
      const overlap=Math.max(0,Math.min(olen,Math.max(a1,a2))-Math.max(0,Math.min(a1,a2)));
      if(overlap/Math.min(qlen,olen)>=0.55){dup=true;break;}
    }
    if(!dup) out.push(q);
  }
  return out;
}

// ===== POTONG DI SEMUA PERSILANGAN =====
// Setiap pasang segmen yang saling bersilang dipotong tepat di titik silangannya,
// menghasilkan jaringan garis bersih tanpa garis yang menembus garis lain.
function splitAtIntersections(segs){
  const cuts=segs.map(()=>[]); // cuts[i] = [{t, x, y}]
  for(let i=0;i<segs.length;i++){
    const [x1,y1,x2,y2]=segs[i];
    const dx1=x2-x1,dy1=y2-y1;
    for(let j=i+1;j<segs.length;j++){
      const [x3,y3,x4,y4]=segs[j];
      const dx2=x4-x3,dy2=y4-y3;
      const den=dx1*dy2-dy1*dx2;
      if(Math.abs(den)<1e-9) continue; // sejajar, tidak berpotongan
      const t=((x3-x1)*dy2-(y3-y1)*dx2)/den;
      const u=((x3-x1)*dy1-(y3-y1)*dx1)/den;
      // Hanya persilangan di dalam kedua segmen; eps kecil agar ujung yang hampir menyentuh ikut terpotong
      const eps=0.015;
      if(t<eps||t>1-eps) continue;
      if(u<eps||u>1-eps) continue;
      const ix=x1+t*dx1,iy=y1+t*dy1;
      cuts[i].push({t,x:ix,y:iy});
      cuts[j].push({t:u,x:ix,y:iy});
    }
  }
  const result=[];
  for(let i=0;i<segs.length;i++){
    const [x1,y1,x2,y2,k]=segs[i];
    const pts=cuts[i];
    if(!pts.length){result.push(segs[i]);continue;}
    // Urutkan titik potong dari awal ke akhir segmen
    pts.sort((a,b)=>a.t-b.t);
    let prev={t:0,x:x1,y:y1};
    for(const pt of pts){
      if(Math.hypot(pt.x-prev.x,pt.y-prev.y)>3)
        result.push([prev.x,prev.y,pt.x,pt.y,k||'P']);
      prev=pt;
    }
    if(Math.hypot(x2-prev.x,y2-prev.y)>3)
      result.push([prev.x,prev.y,x2,y2,k||'P']);
  }
  return result;
}

// Susun segmen 2-titik menjadi jalur (polyline) lewat simpul bersama.
// segs: [[[x,y],[x,y]],...]. tol: jarak dianggap satu simpul. attachTol: ujung yang menempel di tengah garis lain tidak dianggap bebas.
function plotPetaBuildChains(segs,tol,attachTol){
  const nodes=[],edges=[];
  const nodeOf=(x,y)=>{
    for(let i=0;i<nodes.length;i++){const n=nodes[i];if(Math.hypot(n.x-x,n.y-y)<=tol)return i;}
    nodes.push({x,y,edges:[]});return nodes.length-1;
  };
  segs.forEach((s,si)=>{
    const a=nodeOf(s[0][0],s[0][1]),b=nodeOf(s[1][0],s[1][1]);
    if(a===b)return;
    edges.push({a,b,si,used:false});
    const id=edges.length-1;nodes[a].edges.push(id);nodes[b].edges.push(id);
  });
  const other=(e,n)=>e.a===n?e.b:e.a;
  const attached=(n)=>{
    if(!attachTol)return false;
    const own=edges[nodes[n].edges[0]].si,px=nodes[n].x,py=nodes[n].y;
    for(let i=0;i<segs.length;i++){
      if(i===own)continue;
      const [a,b]=segs[i],vx=b[0]-a[0],vy=b[1]-a[1],L2=vx*vx+vy*vy;if(L2<1e-9)continue;
      const t=Math.max(0,Math.min(1,((px-a[0])*vx+(py-a[1])*vy)/L2));
      if(Math.hypot(px-(a[0]+vx*t),py-(a[1]+vy*t))<=attachTol)return true;
    }
    return false;
  };
  const chains=[];
  const walk=(start,eid)=>{
    const pts=[[nodes[start].x,nodes[start].y]];
    let n=start,id=eid;
    for(;;){
      const e=edges[id];e.used=true;
      const m=other(e,n);pts.push([nodes[m].x,nodes[m].y]);n=m;
      if(nodes[n].edges.length!==2)return {pts,a:start,b:n,closed:false};
      const nx=nodes[n].edges.find(x=>x!==id);
      if(edges[nx].used)return {pts,a:start,b:n,closed:n===start};
      id=nx;
    }
  };
  const push=r=>{
    const freeEnd=n=>nodes[n].edges.length===1&&!attached(n);
    chains.push({k:'P',pts:r.pts,closed:r.closed,free:r.closed?[false,false]:[freeEnd(r.a),freeEnd(r.b)],nums:[0,0]});
  };
  for(let n=0;n<nodes.length;n++){
    if(nodes[n].edges.length===2)continue;
    for(const id of nodes[n].edges)if(!edges[id].used)push(walk(n,id));
  }
  for(let id=0;id<edges.length;id++)if(!edges[id].used)push(walk(edges[id].a,id));
  return chains;
}
// Beri nomor ujung bebas: jalur diurutkan dari kiri-atas; titik 1 di ujung kiri-atas jalur itu.
function plotPetaNumberEnds(chains){
  chains.forEach(c=>{
    const a=c.pts[0],b=c.pts[c.pts.length-1];
    if(!c.closed&&(b[1]<a[1]-1e-6||(Math.abs(b[1]-a[1])<=1e-6&&b[0]<a[0]))){c.pts.reverse();c.free=[c.free[1],c.free[0]];}
    let mx=Infinity,my=Infinity;for(const q of c.pts){if(q[0]<mx)mx=q[0];if(q[1]<my)my=q[1];}
    c._k=[my,mx];
  });
  const order=chains.map((_,i)=>i).sort((i,j)=>{
    const a=chains[i]._k,b=chains[j]._k;
    return Math.round(a[0]/80)-Math.round(b[0]/80)||a[1]-b[1];
  });
  let n=0;
  for(const i of order){const c=chains[i];c.nums=[0,0];if(c.closed)continue;if(c.free[0])c.nums[0]=++n;if(c.free[1])c.nums[1]=++n;}
  return n;
}
function detect(R,opt){
  const T=opt?.T ?? +$('dT').value,minL=opt?.minL ?? +$('dL').value,gapF=opt?.gapF ?? +$('dG').value;
  const sc=detectionScale(R),w=Math.max(16,Math.round(R.w*sc)),h=Math.max(16,Math.round(R.h*sc));
  const oc=document.createElement('canvas');oc.width=w;oc.height=h;const o=oc.getContext('2d',{willReadFrequently:true});
  o.fillStyle='#fff';o.fillRect(0,0,w,h);o.imageSmoothingQuality='high';
  if(opt?.source)o.drawImage(opt.source,0,0,w,h);else o.drawImage(img,R.x,R.y,R.w,R.h,0,0,w,h);
  const D=o.getImageData(0,0,w,h).data,N=w*h,gr=new Uint8Array(N),hist=new Uint32Array(256);
  for(let i=0;i<N;i++){const g=(.299*D[i*4]+.587*D[i*4+1]+.114*D[i*4+2])|0;gr[i]=g;hist[g]++}
  let cnt=0,med=128;
  for(let k=0;k<256;k++){cnt+=hist[k];if(cnt>=N/2){med=k;break}}
  let mean=0;
  for(let k=0;k<256;k++)mean+=k*hist[k];
  const invert=mean/N>med;
  const I=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let rs=0;for(let x=0;x<w;x++){rs+=gr[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+rs}}
  const ink=new Uint8Array(N),pts=[],r=Math.max(8,Math.min(24,Math.round(Math.min(w,h)*.04)));
  for(let y=0;y<h;y++){
    const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
    for(let x=0;x<w;x++){
      const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),m=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
      const d=invert?gr[y*w+x]-m:m-gr[y*w+x];
      if(d>T){ink[y*w+x]=1;pts.push(x,y)}
    }
  }
  const inkD=new Uint8Array(N);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    if(ink[i]||ink[i-1]||ink[i+1]||ink[i-w]||ink[i+w]||ink[i-w-1]||ink[i-w+1]||ink[i+w-1]||ink[i+w+1])inkD[i]=1;
  }
  const gk=(A,x,y)=>{x=Math.round(x);y=Math.round(y);return x>=0&&y>=0&&x<w&&y<h?A[y*w+x]:0},at=(x,y)=>gk(inkD,x,y),ik=(x,y)=>gk(ink,x,y);
  const NT=360,diag=Math.ceil(Math.hypot(w,h)),RW=2*diag+1,acc=new Int32Array(NT*RW),cs=new Float32Array(NT),sn=new Float32Array(NT);
  for(let t=0;t<NT;t++){cs[t]=Math.cos(t*Math.PI/NT);sn[t]=Math.sin(t*Math.PI/NT)}
  const np=pts.length/2,st=Math.max(1,Math.ceil(np/250000));
  for(let k=0;k<np;k+=st){
    const x=pts[2*k],y=pts[2*k+1];
    for(let t=0;t<NT;t++)acc[t*RW+Math.round(x*cs[t]+y*sn[t])+diag]++;
  }
  const thr=minL*sc*.45/st,cd=[];
  for(let t=0;t<NT;t++)for(let q=1;q<RW-1;q++){
    const v=acc[t*RW+q];
    if(v<thr)continue;
    let mx=true;
    for(let dt=-1;dt<=1&&mx;dt++){
      const tt=t+dt;
      if(tt<0||tt>=NT)continue;
      for(let dq=-1;dq<=1;dq++){if((dt||dq)&&acc[tt*RW+q+dq]>v){mx=false;break}}
    }
    if(mx)cd.push([v,t,q-diag]);
  }
  cd.sort((a,b)=>b[0]-a[0]);
  const pk=[];
  for(const c of cd){
    if(pk.length>1500)break;
    if(!pk.some(p=>Math.abs(p[1]-c[1])<=8&&Math.abs(p[2]-c[2])<=8))pk.push(c);
  }
  const segs=[],G=gapF*sc,Lm=minL*sc;
  for(const[,t,rr]of pk){
    const c=cs[t],s=sn[t],dx=-s,dy=c,bx=rr*c,by=rr*s;
    let run=null;const runs=[];
    for(let u=-diag;u<=diag;u++){
      const px=bx+u*dx,py=by+u*dy;
      if(px<-5||py<-5||px>w+5||py>h+5)continue;
      let has=false;
      for(let o2=-3;o2<=3;o2++)if(at(px+o2*c,py+o2*s)){has=true;break}
      if(has){if(run&&u-run[1]<=G)run[1]=u;else{if(run)runs.push(run);run=[u,u]}}
    }
    if(run)runs.push(run);
    for(const rn of runs){
      if(rn[1]-rn[0]<Lm)continue;
      let n=0,su=0,so=0,suu=0,suo=0;
      for(let u=rn[0];u<=rn[1];u+=2){
        const px=bx+u*dx,py=by+u*dy;
        let a=0,m=0;
        for(let o2=-3;o2<=3;o2++)if(ik(px+o2*c,py+o2*s)){a+=o2;m++}
        if(m){const oo=a/m;n++;su+=u;so+=oo;suu+=u*u;suo+=u*oo}
      }
      let a0=0,b0=0;
      if(n>4){const den=n*suu-su*su;if(den>1e-9){b0=(n*suo-su*so)/den;a0=(so-b0*su)/n}}
      const P=u=>[bx+u*dx+(a0+b0*u)*c,by+u*dy+(a0+b0*u)*s],p1=P(rn[0]),p2=P(rn[1]),L=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
      if(L<Lm)continue;
      const ux=(p2[0]-p1[0])/L,uy=(p2[1]-p1[1])/L,nx=-uy,ny=ux,M=Math.max(2,Math.floor(L));
      let cov=0,sd=0;
      for(let i=0;i<M;i++){
        const x=p1[0]+ux*L*i/M,y=p1[1]+uy*L*i/M;
        cov+=at(x,y);
        for(const d of[-6,-5,5,6])sd+=at(x+nx*d,y+ny*d);
      }
      cov/=M;sd/=4*M;
      if(cov>=.5&&sd<.18){
        let sumC=0,nC=0;
        const NS=Math.max(3,Math.min(15,Math.floor(L/8)));
        for(let sI=0;sI<NS;sI++){
          const t=(sI+.5)/NS,x=p1[0]+(p2[0]-p1[0])*t,y=p1[1]+(p2[1]-p1[1])*t;
          if(!at(x,y))continue;
          let lo=0,hi=0;
          while(lo>-16&&at(x+nx*(lo-1),y+ny*(lo-1)))lo--;
          while(hi<16&&at(x+nx*(hi+1),y+ny*(hi+1)))hi++;
          if(hi-lo>=2){sumC+=(lo+hi)/2;nC++;}
        }
        const off=nC?sumC/nC:0;
        segs.push([p1[0]+nx*off,p1[1]+ny*off,p2[0]+nx*off,p2[1]+ny*off,'P',L]);
      }
    }
  }
  segs.sort((a,b)=>b[5]-a[5]);
  const along=(x,y,q)=>{const dx=q[2]-q[0],dy=q[3]-q[1],L=Math.hypot(dx,dy);return[((x-q[0])*dy-(y-q[1])*dx)/L,((x-q[0])*dx+(y-q[1])*dy)/L,L]};
  // Smart Filter: buang kandidat yang hampir sejajar, terlalu dekat, dan tumpang-tindih.
  // Toleransi bekerja pada citra skala deteksi, bukan koordinat layar.
  const out=[];
  const angleDiff=(a,b)=>{let d=Math.abs(a-b)%Math.PI;return Math.min(d,Math.PI-d)};
  for(const q of segs){
    const qdx=q[2]-q[0], qdy=q[3]-q[1], qlen=Math.hypot(qdx,qdy);
    if(qlen<Math.max(8,Lm))continue;
    const qa=Math.atan2(qdy,qdx);
    let dup=false;
    for(const o3 of out){
      const odx=o3[2]-o3[0], ody=o3[3]-o3[1], olen=Math.hypot(odx,ody);
      if(!olen)continue;
      const oa=Math.atan2(ody,odx);
      if(angleDiff(qa,oa)>Math.PI/30)continue; // sudut berbeda > 6°: pertahankan
      const nx=-ody/olen, ny=odx/olen;
      const d1=Math.abs((q[0]-o3[0])*nx+(q[1]-o3[1])*ny);
      const d2=Math.abs((q[2]-o3[0])*nx+(q[3]-o3[1])*ny);
      if(Math.max(d1,d2)>7)continue; // jarak antar garis terlalu besar
      const ux=odx/olen, uy=ody/olen;
      const a1=(q[0]-o3[0])*ux+(q[1]-o3[1])*uy;
      const a2=(q[2]-o3[0])*ux+(q[3]-o3[1])*uy;
      const overlap=Math.max(0,Math.min(olen,Math.max(a1,a2))-Math.max(0,Math.min(a1,a2)));
      const shorter=Math.min(qlen,olen);
      const overlapRatio=shorter>0?overlap/shorter:0;
      if(overlapRatio>=0.45){dup=true;break;}
    }
    if(!dup)out.push(q);
  }
  // Pemeriksaan piksel tinta sepanjang jalur, dipakai oleh merging dan snapping.
  const checkPath=(x1,y1,x2,y2)=>{
    const dist=Math.hypot(x2-x1,y2-y1);if(dist<1)return true;
    let hits=0;const steps=Math.max(2,Math.ceil(dist));
    for(let i=1;i<=steps;i++)if(at(x1+(x2-x1)*i/steps,y1+(y2-y1)*i/steps))hits++;
    return hits/steps>0.25;
  };
  // Magnet otomatis opsional. Segmen panjang (>150 px) dikecualikan sebagai
  // perlindungan konservatif bagi jalan/sungai berkelok; bukan deteksi kurva sempurna.
  const useAutoMag=opt?.autoMag ?? ($('autoMagToggle')?.checked ?? true);
  if(useAutoMag){
  // ===== RAPIKAN: satu garis per tepi, tersambung di sudut =====
  // 1) fragmen segaris (termasuk segmen panjang) digabung jadi satu garis dan dicocokkan ulang (PCA);
  // 2) ujung garis ditarik ke titik potong terdekat dengan garis lain (termasuk garis panjang), dibatasi radius magnet;
  // 3) ujung yang berdekatan disatukan; garis kembar dan sisa pendek yang terisolasi dibuang.
  const userMagR=opt?.magR ?? +($('magR')?.value || 40);
  const R2=userMagR;
  const segLen=s=>Math.hypot(s.p[1][0]-s.p[0][0],s.p[1][1]-s.p[0][1]);
  let S=out.map(q=>({p:[[q[0],q[1]],[q[2],q[3]]],parts:[[q[0],q[1],q[2],q[3]]]}));
  S.forEach(s=>{s.L=segLen(s);});
  S.sort((a,b)=>b.L-a.L);
  const refit=s=>{
    let sw=0,mx=0,my=0;
    for(const q of s.parts){const L=Math.hypot(q[2]-q[0],q[3]-q[1]);sw+=L;mx+=(q[0]+q[2])/2*L;my+=(q[1]+q[3])/2*L;}
    mx/=sw;my/=sw;
    let sxx=0,sxy=0,syy=0;
    for(const q of s.parts){
      const L=Math.hypot(q[2]-q[0],q[3]-q[1]);
      for(const t of [0,.5,1]){const x=q[0]+(q[2]-q[0])*t-mx,y=q[1]+(q[3]-q[1])*t-my,w=L/3;sxx+=w*x*x;sxy+=w*x*y;syy+=w*y*y;}
    }
    const th=0.5*Math.atan2(2*sxy,sxx-syy),ux=Math.cos(th),uy=Math.sin(th);
    let t0=Infinity,t1=-Infinity;
    for(const q of s.parts)for(const k of [0,2]){const t=(q[k]-mx)*ux+(q[k+1]-my)*uy;if(t<t0)t0=t;if(t>t1)t1=t;}
    s.p=[[mx+ux*t0,my+uy*t0],[mx+ux*t1,my+uy*t1]];s.L=t1-t0;
  };
  const mergeCos=Math.cos(8*Math.PI/180),mergeOff=7,mergeGap=40;
  const canMerge=(A,B)=>{
    const al=A.L,bl=B.L;if(al<1e-6||bl<1e-6)return false;
    const ux=(A.p[1][0]-A.p[0][0])/al,uy=(A.p[1][1]-A.p[0][1])/al;
    const bx=(B.p[1][0]-B.p[0][0])/bl,by=(B.p[1][1]-B.p[0][1])/bl;
    if(Math.abs(ux*bx+uy*by)<mergeCos)return false;
    const nx=-uy,ny=ux;
    const s1=(B.p[0][0]-A.p[0][0])*nx+(B.p[0][1]-A.p[0][1])*ny;
    const s2=(B.p[1][0]-A.p[0][0])*nx+(B.p[1][1]-A.p[0][1])*ny;
    // Dua garis hampir sejajar yang saling memotong di tengah = satu tepi yang terdeteksi dua kali: toleransi jarak lebih longgar.
    const crossDup=Math.abs(ux*bx+uy*by)>=Math.cos(6*Math.PI/180)&&s1*s2<0;
    if(Math.max(Math.abs(s1),Math.abs(s2))>(crossDup?20:mergeOff))return false;
    const t0=(B.p[0][0]-A.p[0][0])*ux+(B.p[0][1]-A.p[0][1])*uy;
    const t1=(B.p[1][0]-A.p[0][0])*ux+(B.p[1][1]-A.p[0][1])*uy;
    const blo=Math.min(t0,t1),bhi=Math.max(t0,t1);
    const gap=Math.max(0,blo-al,-bhi);
    if(gap>mergeGap)return false;
    if(gap>2){ // jembatani celah hanya bila ada tinta di sepanjang celah
      let ea,eb;
      if(blo>al){ea=A.p[1];eb=t0<t1?B.p[0]:B.p[1];}else{ea=A.p[0];eb=t0<t1?B.p[1]:B.p[0];}
      if(!checkPath(ea[0],ea[1],eb[0],eb[1]))return false;
    }
    return true;
  };
  const mergeAll=()=>{
    const alive=S.map(()=>true);
    for(let i=0;i<S.length;i++){
      if(!alive[i])continue;
      let changed=true,guard=0;
      while(changed&&guard++<60){
        changed=false;
        for(let j=i+1;j<S.length;j++){
          if(!alive[j]||!canMerge(S[i],S[j]))continue;
          S[i].parts.push(...S[j].parts);alive[j]=false;refit(S[i]);changed=true;
        }
      }
    }
    S=S.filter((_,i)=>alive[i]);
  };
  // --- tarik ujung ke titik potong terdekat (garis panjang ikut, perpindahan dibatasi) ---
  const lineX=(a,b)=>{
    const [x1,y1]=a.p[0],[x2,y2]=a.p[1],[x3,y3]=b.p[0],[x4,y4]=b.p[1];
    const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
    if(Math.abs(d)<1e-9)return null;
    const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;
    return [x1+t*(x2-x1),y1+t*(y2-y1)];
  };
  const snapAll=()=>{
    const orig=S.map(s=>({p:[s.p[0].slice(),s.p[1].slice()],L:s.L}));
    const moves=[];
    for(let i=0;i<S.length;i++){
      const a=orig[i];if(a.L<1e-6)continue;
      const ax=a.p[1][0]-a.p[0][0],ay=a.p[1][1]-a.p[0][1];
      const reach=Math.min(R2,0.35*a.L);
      for(let k=0;k<2;k++){
        const e=a.p[k];let best=null,bd=reach;
        for(let j=0;j<S.length;j++){
          if(j===i)continue;
          const b=orig[j];if(b.L<1e-6)continue;
          const bx=b.p[1][0]-b.p[0][0],by=b.p[1][1]-b.p[0][1];
          if(Math.abs(ax*by-ay*bx)/(a.L*b.L)<0.15)continue;      // hampir sejajar: tidak berpotongan bermakna
          const X=lineX(a,b);if(!X)continue;
          const d=Math.hypot(X[0]-e[0],X[1]-e[1]);if(d>=bd)continue;
          const tb=((X[0]-b.p[0][0])*bx+(X[1]-b.p[0][1])*by)/b.L;
          if(tb<-R2||tb>b.L+R2)continue;
          if(d>6&&!checkPath(e[0],e[1],X[0],X[1]))continue;
          bd=d;best=X;
        }
        if(best)moves.push([i,k,best]);
      }
    }
    for(const [i,k,X] of moves)S[i].p[k]=X;
  };
  // --- satukan ujung yang berdekatan agar benar-benar berbagi satu titik sudut ---
  const clusterAll=()=>{
    const rc=Math.min(userMagR,14);
    const E=S.flatMap(s=>s.p),done=new Set();
    for(const e of E){
      if(done.has(e))continue;
      const g=E.filter(q=>!done.has(q)&&Math.hypot(q[0]-e[0],q[1]-e[1])<rc);
      if(!g.length)continue;
      const mx=g.reduce((z,q)=>z+q[0],0)/g.length,my=g.reduce((z,q)=>z+q[1],0)/g.length;
      g.forEach(q=>{q[0]=mx;q[1]=my;done.add(q);});
    }
    // buang garis yang runtuh jadi titik dan garis kembar (dua ujung sama)
    const seen=new Set(),keepS=[];
    for(const s of S){
      s.L=segLen(s);
      if(s.L<Math.max(4,Lm*0.4))continue;
      const k1=Math.round(s.p[0][0])+','+Math.round(s.p[0][1])+'|'+Math.round(s.p[1][0])+','+Math.round(s.p[1][1]);
      const k2=Math.round(s.p[1][0])+','+Math.round(s.p[1][1])+'|'+Math.round(s.p[0][0])+','+Math.round(s.p[0][1]);
      if(seen.has(k1)||seen.has(k2))continue;
      seen.add(k1);keepS.push(s);
    }
    S=keepS;
  };
  // --- buang ranting pendek: segmen pendek dengan ujung menggantung (bukan di tepi kotak deteksi) ---
  const pruneAll=()=>{
    const touch=(e,self)=>{
      for(const o of S){
        if(o===self)continue;
        if(Math.hypot(o.p[0][0]-e[0],o.p[0][1]-e[1])<=8||Math.hypot(o.p[1][0]-e[0],o.p[1][1]-e[1])<=8)return true;
        const vx=o.p[1][0]-o.p[0][0],vy=o.p[1][1]-o.p[0][1],L=Math.hypot(vx,vy);if(L<1e-6)continue;
        const t=((e[0]-o.p[0][0])*vx+(e[1]-o.p[0][1])*vy)/(L*L);
        if(t>=0&&t<=1&&Math.abs(vx*(e[1]-o.p[0][1])-vy*(e[0]-o.p[0][0]))/L<=8)return true;
      }
      return false;
    };
    const nearEdge=e=>e[0]<10||e[1]<10||e[0]>w-10||e[1]>h-10;
    for(let pass=0;pass<2;pass++){
      S=S.filter(s=>{
        if(s.L>=Lm*1.5)return true;
        const f0=!touch(s.p[0],s)&&!nearEdge(s.p[0]),f1=!touch(s.p[1],s)&&!nearEdge(s.p[1]);
        return !(f0||f1);
      });
    }
  };
  // --- sambung otomatis: dua ujung bebas yang arahnya saling melanjutkan ---
  const touchOf=(e,self)=>{
    for(const o of S){
      if(o===self)continue;
      if(Math.hypot(o.p[0][0]-e[0],o.p[0][1]-e[1])<=8||Math.hypot(o.p[1][0]-e[0],o.p[1][1]-e[1])<=8)return true;
      const vx=o.p[1][0]-o.p[0][0],vy=o.p[1][1]-o.p[0][1],L=Math.hypot(vx,vy);if(L<1e-6)continue;
      const t=((e[0]-o.p[0][0])*vx+(e[1]-o.p[0][1])*vy)/(L*L);
      if(t>=0&&t<=1&&Math.abs(vx*(e[1]-o.p[0][1])-vy*(e[0]-o.p[0][0]))/L<=8)return true;
    }
    return false;
  };
  const linkAll=()=>{
    const linkMax=((opt?.linkMax ?? (+($('linkMax')?$('linkMax').value:120)))*sc);
    if(!(linkMax>0))return;
    const cosCont=Math.cos(30*Math.PI/180);
    const ends=[];
    S.forEach((s,i)=>{for(let k=0;k<2;k++){
      const e=s.p[k];if(touchOf(e,s))continue;
      const o=s.p[1-k],dx=e[0]-o[0],dy=e[1]-o[1],L=Math.hypot(dx,dy)||1;
      ends.push({i,k,e,ux:dx/L,uy:dy/L});
    }});
    const pairs=[];
    for(let a=0;a<ends.length;a++)for(let b=a+1;b<ends.length;b++){
      const A=ends[a],B=ends[b];if(A.i===B.i)continue;
      const vx=B.e[0]-A.e[0],vy=B.e[1]-A.e[1],d=Math.hypot(vx,vy);
      if(d>linkMax)continue;
      if(d>1e-6){
        if((A.ux*vx+A.uy*vy)/d<cosCont)continue;      // garis A tidak mengarah ke ujung B
        if(-(B.ux*vx+B.uy*vy)/d<cosCont)continue;     // garis B tidak mengarah ke ujung A
      }
      pairs.push([d,a,b]);
    }
    pairs.sort((x,y)=>x[0]-y[0]);
    const used=new Set(),bridges=[];
    for(const [d,a,b] of pairs){
      if(used.has(a)||used.has(b))continue;
      used.add(a);used.add(b);
      const A=ends[a],B=ends[b],sa=S[A.i],sb=S[B.i];
      const X=lineX(sa,sb);
      if(X&&d>1e-6&&Math.hypot(X[0]-A.e[0],X[1]-A.e[1])<=Math.max(d,12)&&Math.hypot(X[0]-B.e[0],X[1]-B.e[1])<=Math.max(d,12)){
        sa.p[A.k]=X.slice();sb.p[B.k]=X.slice();           // sudut: kedua ujung bertemu di titik potong garis
      }else if(d<=3){
        const m=[(A.e[0]+B.e[0])/2,(A.e[1]+B.e[1])/2];sa.p[A.k]=m.slice();sb.p[B.k]=m.slice();
      }else{
        bridges.push({p:[sa.p[A.k].slice(),sb.p[B.k].slice()],parts:[],L:d,bridge:true}); // celah: jembatan lurus
      }
    }
    for(const br of bridges)S.push(br);
  };
  // --- potong otomatis kelebihan di belokan: dua garis bersudut lancip yang saling menyilang dekat ujung keduanya ---
  const trimCrossAll=()=>{
    for(let pass=0;pass<3;pass++){
      const L=S.map(segLen),cand2=[];
      for(let i=0;i<S.length;i++){
        if(L[i]<1e-6)continue;
        const a=S[i],ax=a.p[1][0]-a.p[0][0],ay=a.p[1][1]-a.p[0][1];
        for(let j=i+1;j<S.length;j++){
          if(L[j]<1e-6)continue;
          const b=S[j],bx=b.p[1][0]-b.p[0][0],by=b.p[1][1]-b.p[0][1];
          const den=ax*by-ay*bx,sinA=Math.abs(den)/(L[i]*L[j]);
          if(sinA<0.10||sinA>0.57)continue;                  // hanya sudut lancip (~6° sampai ~35°)
          const t=((b.p[0][0]-a.p[0][0])*by-(b.p[0][1]-a.p[0][1])*bx)/den;
          const u=((b.p[0][0]-a.p[0][0])*ay-(b.p[0][1]-a.p[0][1])*ax)/den;
          if(t<=0.02||t>=0.98||u<=0.02||u>=0.98)continue;     // harus silang di bagian dalam kedua garis
          const oa=Math.min(t,1-t)*L[i],ob=Math.min(u,1-u)*L[j];
          if(oa>Math.min(0.3*L[i],150)||ob>Math.min(0.3*L[j],150))continue;   // titik silang harus dekat ujung KEDUA garis
          cand2.push({i,j,ka:t<0.5?0:1,kb:u<0.5?0:1,X:[a.p[0][0]+t*ax,a.p[0][1]+t*ay],cost:oa+ob});
        }
      }
      cand2.sort((x,y)=>x.cost-y.cost);
      const used=new Set();let changed=false;
      for(const c of cand2){
        const ka=c.i*2+c.ka,kb=c.j*2+c.kb;
        if(used.has(ka)||used.has(kb))continue;
        used.add(ka);used.add(kb);
        S[c.i].p[c.ka]=c.X.slice();S[c.j].p[c.kb]=c.X.slice();changed=true;
      }
      if(!changed)break;
    }
    S.forEach(s=>{s.L=segLen(s);});
  };
  // Dua putaran: gabung -> sambung -> satukan. Putaran kedua membereskan garis kembar yang baru muncul setelah ujung ditarik.
  mergeAll();snapAll();clusterAll();
  mergeAll();snapAll();clusterAll();
  trimCrossAll();clusterAll();
  pruneAll();
  linkAll();
  // Dedup dan split dalam koordinat skala deteksi (sebelum konversi) agar threshold jarak akurat.
  let segsFlat=S.map(s=>([s.p[0][0], s.p[0][1], s.p[1][0], s.p[1][1], 'P']));
  segsFlat=removeDuplicates(segsFlat);
  segsFlat=splitAtIntersections(segsFlat);
  // Konversi ke koordinat gambar dan susun jadi chains.
  const segsForChain=segsFlat.map(q=>[[q[0]/sc+R.x, q[1]/sc+R.y],[q[2]/sc+R.x, q[3]/sc+R.y]]);
  const chains=plotPetaBuildChains(segsForChain, Math.max(1.5,1/sc), 8/sc);
  plotPetaNumberEnds(chains);
  return chains;
  } else {
    // Magnet nonaktif: dedup dan split dalam koordinat skala deteksi, lalu konversi.
    let segsOut=removeDuplicates(out.map(q=>[q[0],q[1],q[2],q[3],q[4]||'P']));
    segsOut=splitAtIntersections(segsOut);
    return segsOut.map(q=>({k:q[4]||'P',pts:[[q[0]/sc+R.x,q[1]/sc+R.y],[q[2]/sc+R.x,q[3]/sc+R.y]]}));
  }
}

function pointInPolygon(pt,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const intersect=((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi+1e-12)+xi);if(intersect)inside=!inside;}return inside;}
function eraseRegion(R,poly){
  if(!img)return; const inside=(pt)=>poly?pointInPolygon(toS(pt),poly):(pt[0]>=R.x&&pt[0]<=R.x+R.w&&pt[1]>=R.y&&pt[1]<=R.y+R.h);
  const beforeL=lines.length,beforeT=texts.length; let changed=false;
  const keep=[];
  for(const l of lines){const pts=l.pts;const selected=pts.some(inside)||pts.slice(0,-1).some((p,i)=>inside([(p[0]+pts[i+1][0])/2,(p[1]+pts[i+1][1])/2]));if(!selected)keep.push(l);else changed=true;}
  const keptTexts=texts.filter(t=>!inside(t.p)); if(keptTexts.length!==texts.length)changed=true;
  if(changed){snapshot();lines=keep;texts=keptTexts;selT=-1;tform();stat();$('st').innerHTML='<span class="status-dot"></span><span>Area hapus selesai: '+(beforeL-lines.length)+' objek garis dan '+(beforeT-texts.length)+' teks dihapus</span>';}
}
function finishSelection(){
  if(tool==='A'&&detectModeEl?.value==='poly'&&selectionPoly.length>=3){const poly=selectionPoly.map(toI);const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);const R={x:Math.max(0,Math.floor(Math.min(...xs))),y:Math.max(0,Math.floor(Math.min(...ys))),w:Math.min(iw,Math.ceil(Math.max(...xs)))-Math.max(0,Math.floor(Math.min(...xs))),h:Math.min(ih,Math.ceil(Math.max(...ys)))-Math.max(0,Math.floor(Math.min(...ys)))};runDet(R,poly);selectionPoly=[];draw();return true;}
  if(tool==='E'&&eraseModeEl?.value==='poly'&&selectionPoly.length>=3){eraseRegion(null,selectionPoly);selectionPoly=[];draw();return true;}
  return false;
}

function runDet(R,poly=null){
  if(!img||R.w<20||R.h<20)return;
  $('dMsg').textContent='Mendeteksi...';
  $('autoParamInfo').textContent='';
  setTimeout(async()=>{
    try{
      let params;
      // 1. Parameter otomatis jika toggle aktif
      if($('autoParamToggle')?.checked){
        const p=analyzeRegion(R);
        $('dT').value=p.dT;$('dL').value=p.dL;$('dG').value=p.dG;
        $('val_dT').textContent=p.dT;
        $('val_dL').textContent=p.dL+' px';
        $('val_dG').textContent=p.dG+' px';
        $('magR').value=p.magR;$('linkMax').value=p.linkMax;
        $('val_magR').textContent=p.magR+' px';
        $('val_linkMax').textContent=p.linkMax+' px';
        $('autoParamInfo').textContent=
          'Auto → kepekaan: '+p.dT+', min: '+p.dL+'px, celah: '+p.dG+'px, magnet: '+p.magR+'px, sambung: '+p.linkMax+'px';
        params={T:p.dT,minL:p.dL,gapF:p.dG,magR:p.magR,linkMax:p.linkMax,medRun:p.medRun||2,autoMag:true};
      }else{
        params={T:+$('dT').value,minL:+$('dL').value,gapF:+$('dG').value,magR:+($('magR')?.value||40),linkMax:+($('linkMax')?.value||120),medRun:2,autoMag:($('autoMagToggle')?.checked??true)};
      }
      // 2. Gambar bantu: latar dihapus, teks dibuang, hanya garis hitam.
      let helperUsed=false;
      if($('helperDetectToggle')?.checked){
        $('dMsg').textContent='Menyiapkan gambar bantu...';
        await new Promise(r=>setTimeout(r,10));
        try{
          const hd=buildHelperData(R,params,{preview:false});
          params.source=hd.lineOnly;
          helperUsed=true;
        }catch(e){
          $('dMsg').textContent='Gambar bantu gagal, memakai gambar asli...';
          await new Promise(r=>setTimeout(r,10));
        }
      }
      $('dMsg').textContent='Mendeteksi...';
      // 3. Deteksi dengan Hough + Smart Filter
      cand=detect(R,params);
      // 4. Filter berdasarkan area poligon jika ada
      if(poly&&poly.length>=3) cand=cand.filter(c=>{
        let n=0;for(const q of c.pts)if(pointInPolygon(q,poly))n++;
        return n>=c.pts.length/2;
      });
      let topoNote='';
      if(cand.length&&$('topoAutoToggle')?.checked){
        try{
          const tr=cleanTopologyChains(cand,{mode:'all',tol:+($('topoTol')?.value||16)});
          cand=tr.chains;
          topoNote=' Topologi dirapikan ('+tr.stats.joins+' join, '+tr.stats.extends+' extend, '+tr.stats.trims+' trim).';
        }catch(e){console.warn('Rapikan topologi otomatis gagal:',e)}
      }
      if(cand.length&&cand[0].free) plotPetaNumberEnds(cand);
      const nEnd=cand.reduce((z,c)=>z+((c.nums||[]).filter(Boolean).length),0);
      $('dMsg').textContent=
        cand.length+' jalur kandidat'
        +(nEnd?(', '+nEnd+' ujung bebas.'):'.')
        +' Persilangan & duplikat sudah dibersihkan.'+(helperUsed?' Gambar bantu dipakai.':'')+topoNote+' Kandidat bisa diedit dengan Pindah Titik/Hapus sebelum diterima.';
    }catch(x){$('dMsg').textContent='Deteksi gagal: '+x.message}
    draw();
  },40);
}
$('dOk').onclick=()=>{
  if(!cand.length)return;
  snapshot();
  cand.forEach(c=>lines.push({k:'P',pts:c.pts}));
  ensureIntersectionPoints(true);
  cand=[];
  $('dMsg').textContent='Kandidat diterima sebagai garis.';
  stat();
  draw();
};
$('dNo').onclick=()=>{cand=[];$('dMsg').textContent='';draw()};

$('dAll').onclick=()=>{
  if(!img){$('dMsg').textContent='Buka peta dulu.';return}
  runDet({x:0,y:0,w:iw,h:ih});
};

async function refreshHelperView(force=false){
  if(!img){$('helperViewMsg').textContent='Buka peta dulu.';return}
  if(!force&&helperPreview&&helperPreviewImg===img){draw();return}
  if(helperPreviewBusy)return;
  helperPreviewBusy=true;
  $('helperViewMsg').textContent='Menyiapkan gambar bantu...';
  await new Promise(r=>setTimeout(r,20));
  try{
    const hd=buildHelperData({x:0,y:0,w:iw,h:ih},null,{preview:true});
    helperPreview=hd.preview;helperPreviewImg=img;
    $('helperViewMsg').textContent='Teks biru: '+hd.textComps+' komponen. Garis hitam dipertahankan.'+(hd.noiseComps?', '+hd.noiseComps+' bintik dibuang.':'');
  }catch(e){
    helperPreview=null;helperPreviewImg=null;
    $('helperViewMsg').textContent='Gagal membuat gambar bantu: '+e.message;
  }finally{
    helperPreviewBusy=false;
    draw();
  }
}
$('helperViewToggle').onchange=()=>{
  if($('helperViewToggle').checked)refreshHelperView();
  else{$('helperViewMsg').textContent='';draw()}
};

function topoNearestLinePoint(sp,maxD=16){
  let best=null,bd=maxD;
  editTarget().forEach((l,li)=>{
    for(let i=0;i<l.pts.length-1;i++){
      const a=toS(l.pts[i]),b=toS(l.pts[i+1]);
      const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
      let t=L2?((sp[0]-a[0])*dx+(sp[1]-a[1])*dy)/L2:0;
      t=Math.max(0,Math.min(1,t));
      const x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(sp[0]-x,sp[1]-y);
      if(d<bd){
        bd=d;
        best={li,si:i,t,pt:[l.pts[i][0]+t*(l.pts[i+1][0]-l.pts[i][0]),l.pts[i][1]+t*(l.pts[i+1][1]-l.pts[i][1])]};
      }
    }
  });
  return best;
}
function manualCutAt(li,si,t){
  const target=editTarget();
  const l=target[li];if(!l||l.pts.length<2||si<0||si>=l.pts.length-1)return false;
  if(t<=.001||t>=.999)return false;
  const pts=l.pts;
  const a=pts[si],b=pts[si+1];
  const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy);
  if(L<1e-9)return false;
  const ux=dx/L,uy=dy/L;
  const click=[a[0]+t*dx,a[1]+t*dy];
  const half=Math.min(3/(2*Math.max(V.s,.001)),t*L*.9,(1-t)*L*.9);
  const cutA=[click[0]-ux*half,click[1]-uy*half];
  const cutB=[click[0]+ux*half,click[1]+uy*half];
  snapshot();
  const A=pts.slice(0,si+1).concat([cutA]);
  const B=[cutB].concat(pts.slice(si+1));
  const keep=target.filter((_,i)=>i!==li);
  keep.push({k:l.k||'P',pts:A});
  keep.push({k:l.k||'P',pts:B});
  target.splice(0,target.length,...keep);
  if(target===cand)candMsg();
  return true;
}
function deleteSegmentAt(li,si){
  const target=editTarget();
  const l=target[li];
  if(!l||si<0||si>=l.pts.length-1)return false;
  snapshot();
  const A=l.pts.slice(0,si+1),B=l.pts.slice(si+1);
  const kept=A.length>1||B.length>1;
  target.splice(li,1);
  if(A.length>1)target.push({k:l.k||'P',pts:A});
  if(B.length>1)target.push({k:l.k||'P',pts:B});
  erasePick=null;
  if(target===cand)candMsg();
  $('st').innerHTML='<span class="status-dot"></span><span>1 segmen dihapus'+(kept?'; bagian lain tetap.':'.')+'</span>';
  stat();draw();return true;
}
function startAddLineAt(sp){
  if(!img)return false;
  let best=null,bd=12;
  editTarget().forEach(l=>l.pts.forEach(p=>{
    const s=toS(p),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
    if(d<bd){bd=d;best=p}
  }));
  if(!best){
    $('st').innerHTML='<span class="status-dot"></span><span>Klik titik pada garis untuk mulai menambah garis.</span>';
    draw();return false;
  }
  addLinePick={pt:best.slice()};
  $('st').innerHTML='<span class="status-dot"></span><span>Titik awal dipilih. Klik tujuan untuk menambah garis baru.</span>';
  draw();return true;
}
function finishAddLineAt(sp){
  if(!addLinePick)return false;
  const pt=addLinePick.pt;
  const target=toI(sp);
  if(Math.hypot(target[0]-pt[0],target[1]-pt[1])*V.s<2){
    addLinePick=null;
    $('st').innerHTML='<span class="status-dot"></span><span>Penambahan garis dibatalkan.</span>';
    draw();return false;
  }
  let q=target.slice();
  let best=null,bd=10;
  editTarget().forEach(l=>l.pts.forEach(p=>{
    const s=toS(p),d=Math.hypot(s[0]-sp[0],s[1]-sp[1]);
    if(d<bd){bd=d;best=p}
  }));
  if(best){
    q=best.slice();
  }else{
    const h=topoNearestLinePoint(sp,12);
    if(h)q=h.pt.slice();
  }
  if(Math.hypot(q[0]-pt[0],q[1]-pt[1])<1e-6){
    addLinePick=null;
    $('st').innerHTML='<span class="status-dot"></span><span>Penambahan garis dibatalkan.</span>';
    draw();return false;
  }
  snapshot();
  editTarget().push({k:'P',pts:[pt.slice(),q.slice()]});
  addLinePick=null;
  if(cand.length)candMsg();
  $('st').innerHTML='<span class="status-dot"></span><span>'+(cand.length?'Kandidat garis ditambahkan.':'Garis baru ditambahkan.')+'</span>';
  stat();draw();return true;
}
function ensureIntersectionPoints(alreadySnapshot=false){
  if(lines.length<2)return 0;
  const mergeTol=1,snapTol=2;
  const dist=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
  const lineCuts=lines.map(l=>l.pts.map(()=>[]));
  const lineSnaps=lines.map(()=>new Map());
  let added=0,applied=false;
  const snapPoint=(li,pi,x,y)=>{
    const l=lines[li];if(!l||!l.pts[pi])return;
    if(dist(l.pts[pi],[x,y])<=.05)return;
    if(!lineSnaps[li].has(pi)){lineSnaps[li].set(pi,[x,y]);added++;applied=true}
  };
  const addCut=(li,si,t,x,y)=>{
    if(t<=1e-7||t>=1-1e-7)return;
    lineCuts[li][si].push({t,x,y});
  };
  for(let li=0;li<lines.length;li++){
    const A=lines[li];if(!A||A.pts.length<2)continue;
    for(let lj=li+1;lj<lines.length;lj++){
      const B=lines[lj];if(!B||B.pts.length<2)continue;
      for(let si=0;si<A.pts.length-1;si++){
        const a=A.pts[si],b=A.pts[si+1];
        const rx=b[0]-a[0],ry=b[1]-a[1];
        for(let sj=0;sj<B.pts.length-1;sj++){
          const c=B.pts[sj],d=B.pts[sj+1];
          const sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx;
          if(Math.abs(den)<1e-9)continue;
          let t=((c[0]-a[0])*sy-(c[1]-a[1])*sx)/den;
          let u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den;
          const eps=1e-7;
          if(t<-eps||t>1+eps||u<-eps||u>1+eps)continue;
          t=Math.max(0,Math.min(1,t));u=Math.max(0,Math.min(1,u));
          const x=a[0]+t*rx,y=a[1]+t*ry;
          const a0=dist([x,y],a)<=mergeTol,a1=dist([x,y],b)<=mergeTol;
          const b0=dist([x,y],c)<=mergeTol,b1=dist([x,y],d)<=mergeTol;
          if(a0)snapPoint(li,si,x,y);else if(a1)snapPoint(li,si+1,x,y);else addCut(li,si,t,x,y);
          if(b0)snapPoint(lj,sj,x,y);else if(b1)snapPoint(lj,sj+1,x,y);else addCut(lj,sj,u,x,y);
        }
      }
    }
  }
  const nearestOnSeg=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
    let t=L2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2:0;
    t=Math.max(0,Math.min(1,t));
    const x=a[0]+t*dx,y=a[1]+t*dy;
    return {t,x,y,d:Math.hypot(p[0]-x,p[1]-y)};
  };
  for(let li=0;li<lines.length;li++){
    const A=lines[li];if(!A||A.pts.length<2)continue;
    for(const pi of [0,A.pts.length-1]){
      const p=A.pts[pi];
      let best=null;
      for(let lj=0;lj<lines.length;lj++){
        if(lj===li)continue;
        const B=lines[lj];if(!B||B.pts.length<2)continue;
        for(let sj=0;sj<B.pts.length-1;sj++){
          const q=nearestOnSeg(p,B.pts[sj],B.pts[sj+1]);
          if(q.d>snapTol)continue;
          if(!best||q.d<best.d)best={lj,sj,q};
        }
      }
      if(!best)continue;
      const {lj,sj,q}=best;
      snapPoint(li,pi,q.x,q.y);
      const c=lines[lj].pts[sj],d=lines[lj].pts[sj+1];
      if(dist([q.x,q.y],c)<=mergeTol)snapPoint(lj,sj,q.x,q.y);
      else if(dist([q.x,q.y],d)<=mergeTol)snapPoint(lj,sj+1,q.x,q.y);
      else addCut(lj,sj,q.t,q.x,q.y);
    }
  }
  const out=lines.map((l,li)=>{
    const pts=l.pts.map((p,pi)=>lineSnaps[li].has(pi)?lineSnaps[li].get(pi).slice():p.slice());
    const res=[pts[0]];
    for(let si=0;si<pts.length-1;si++){
      const list=(lineCuts[li][si]||[]).slice().sort((a,b)=>a.t-b.t);
      for(const q of list){
        const last=res[res.length-1];
        if(dist([q.x,q.y],pts[si])<=mergeTol||dist([q.x,q.y],pts[si+1])<=mergeTol)continue;
        if(dist([q.x,q.y],last)<=mergeTol)continue;
        res.push([q.x,q.y]);applied=true;added++;
      }
      const nxt=pts[si+1];
      if(dist(res[res.length-1],nxt)>mergeTol)res.push(nxt);
      else res[res.length-1]=nxt;
    }
    return res.length>=2?{...l,pts:res}:{...l,pts:pts};
  });
  if(!applied)return 0;
  if(!alreadySnapshot)snapshot();
  lines=out;
  return added;
}

function handleTopoTool(sp){
  if(!img)return;
  const hit=topoNearestLinePoint(sp,16);
  if(!hit){
    $('st').innerHTML='<span class="status-dot"></span><span>Klik tepat pada segmen garis yang mau dipotong.</span>';
    draw();return;
  }
  if(manualCutAt(hit.li,hit.si,hit.t)){
    mv=null;
    $('st').innerHTML='<span class="status-dot"></span><span>Segmen dipotong menjadi 2 bagian.</span>';
    stat();draw();
  }else{
    $('st').innerHTML='<span class="status-dot"></span><span>Tidak ada yang bisa dipotong di titik itu.</span>';
    draw();
  }
}

function helperParams(R){
  if($('autoParamToggle')?.checked){
    const p=analyzeRegion(R);
    return {T:p.dT,minL:p.dL,gapF:p.dG,magR:p.magR,linkMax:p.linkMax,medRun:p.medRun||2,autoMag:true};
  }
  return {T:+$('dT').value,minL:+$('dL').value,gapF:+$('dG').value,magR:+($('magR')?.value||40),linkMax:+($('linkMax')?.value||120),medRun:2,autoMag:($('autoMagToggle')?.checked??true)};
}

function buildHelperData(R,params,opts){
  const P=params||helperParams(R);
  const {T,minL,gapF,medRun}=P;
  const chains=detect(R,{T,minL,gapF,autoMag:false});
  const sc=detectionScale(R),w=Math.max(16,Math.round(R.w*sc)),h=Math.max(16,Math.round(R.h*sc)),N=w*h;
  let ink;
  {
    const oc=document.createElement('canvas');oc.width=w;oc.height=h;
    const o=oc.getContext('2d',{willReadFrequently:true});
    o.fillStyle='#fff';o.fillRect(0,0,w,h);o.imageSmoothingQuality='high';o.drawImage(img,R.x,R.y,R.w,R.h,0,0,w,h);
    const D=o.getImageData(0,0,w,h).data;
    const gr=new Uint8Array(N),hist=new Uint32Array(256);
    for(let i=0;i<N;i++){const g=(.299*D[i*4]+.587*D[i*4+1]+.114*D[i*4+2])|0;gr[i]=g;hist[g]++}
    let cnt=0,med=128;
    for(let k=0;k<256;k++){cnt+=hist[k];if(cnt>=N/2){med=k;break}}
    let mean=0;for(let k=0;k<256;k++)mean+=k*hist[k];
    const invert=mean/N>med;
    const I=new Uint32Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let rs=0;for(let x=0;x<w;x++){rs+=gr[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+rs}}
    ink=new Uint8Array(N);
    const r=Math.max(8,Math.min(24,Math.round(Math.min(w,h)*.04)));
    for(let y=0;y<h;y++){
      const y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
      for(let x=0;x<w;x++){
        const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),m=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
        const d=invert?gr[y*w+x]-m:m-gr[y*w+x];
        if(d>T)ink[y*w+x]=1;
      }
    }
  }
  const cut=new Uint8Array(N);
  const lc=document.createElement('canvas');lc.width=w;lc.height=h;
  const lx=lc.getContext('2d',{willReadFrequently:true});
  lx.strokeStyle='#fff';lx.lineCap='round';lx.lineJoin='round';
  lx.lineWidth=Math.max(4,Math.min(10,Math.round((medRun||2)*1.5)));
  for(const c of chains){
    if(!c.pts||c.pts.length<2)continue;
    lx.beginPath();lx.moveTo((c.pts[0][0]-R.x)*sc,(c.pts[0][1]-R.y)*sc);
    for(let i=1;i<c.pts.length;i++)lx.lineTo((c.pts[i][0]-R.x)*sc,(c.pts[i][1]-R.y)*sc);
    lx.stroke();
  }
  const ld=lx.getImageData(0,0,w,h).data;
  for(let i=0;i<N;i++)if(ld[i*4+3]>0)cut[i]=1;
  const tm=new Uint8Array(N);
  for(let i=0;i<N;i++)if(ink[i]&&!cut[i])tm[i]=1;
  const comp=new Int32Array(N);
  const textMax=Math.max(24,Math.min(160,Math.round(Math.min(w,h)*.06)));
  let textComps=0,lineComps=0,noiseComps=0;
  for(let i=0;i<N;i++){
    if(tm[i]!==1)continue;
    let head=0,tail=0;comp[tail++]=i;tm[i]=2;
    let minX=w,maxX=0,minY=h,maxY=0,sumX=0,sumY=0,sumXX=0,sumYY=0,sumXY=0;
    while(head<tail){
      const j=comp[head++],x=j%w,y=(j-x)/w;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      sumX+=x;sumY+=y;sumXX+=x*x;sumYY+=y*y;sumXY+=x*y;
      const x0=x>0?x-1:0,x1=x<w-1?x+1:w-1,y0=y>0?y-1:0,y1=y<h-1?y+1:h-1;
      for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){
        const k=yy*w+xx;
        if(tm[k]===1){tm[k]=2;comp[tail++]=k}
      }
    }
    const area=tail,bw=maxX-minX+1,bh=maxY-minY+1,maxDim=Math.max(bw,bh),fill=area/(bw*bh);
    const mx=sumX/area,my=sumY/area,cxx=sumXX/area-mx*mx,cyy=sumYY/area-my*my,cxy=sumXY/area-mx*my;
    const tr=cxx+cyy,det=cxx*cyy-cxy*cxy,disc=Math.sqrt(Math.max(0,tr*tr/4-det));
    const l1=tr/2+disc,l2=Math.max(1e-6,tr/2-disc),elongPC=Math.sqrt(l1/l2);
    const isSmall=maxDim<=textMax,isWord=maxDim<=textMax*2.5&&elongPC<=6&&fill>=0.12&&fill<=0.85;
    if(area<2){
      for(let q=0;q<tail;q++)tm[comp[q]]=4;
      noiseComps++;
    }else if(isSmall||isWord){
      textComps++;
    }else{
      for(let q=0;q<tail;q++)tm[comp[q]]=3;
      lineComps++;
    }
  }
  const lineCv=document.createElement('canvas');lineCv.width=w;lineCv.height=h;
  const lctx=lineCv.getContext('2d'),limg=lctx.createImageData(w,h),lpd=limg.data;
  const wantPreview=opts?.preview!==false;
  let prevCv=null,pctx=null,pimg=null,ppd=null;
  if(wantPreview){prevCv=document.createElement('canvas');prevCv.width=w;prevCv.height=h;pctx=prevCv.getContext('2d');pimg=pctx.createImageData(w,h);ppd=pimg.data}
  for(let i=0;i<N;i++){
    const a=i*4;
    if(!ink[i]){
      lpd[a]=lpd[a+1]=lpd[a+2]=lpd[a+3]=255;
      continue;
    }
    if(tm[i]===2){
      lpd[a]=lpd[a+1]=lpd[a+2]=lpd[a+3]=255;
      if(wantPreview){ppd[a]=21;ppd[a+1]=101;ppd[a+2]=255;ppd[a+3]=255}
    }else if(tm[i]===4){
      lpd[a]=lpd[a+1]=lpd[a+2]=lpd[a+3]=255;
    }else{
      lpd[a]=lpd[a+1]=lpd[a+2]=0;lpd[a+3]=255;
      if(wantPreview){ppd[a]=ppd[a+1]=ppd[a+2]=0;ppd[a+3]=255}
    }
  }
  lctx.putImageData(limg,0,0);
  if(wantPreview)pctx.putImageData(pimg,0,0);
  return {lineOnly:lineCv,preview:prevCv,w,h,sc,textComps,lineComps,noiseComps};
}


function cleanTopologyChains(chains,opt={}){
  const mode=opt.mode||'all';
  const tol=Math.max(2,+opt.tol||16);
  const doJoin=mode==='all'||mode==='join';
  const doExtend=mode==='all'||mode==='extend';
  const doTrim=mode==='all'||mode==='trim';
  const stats={chains0:chains.length,joins:0,extends:0,trims:0,splits:0,chains1:0};
  let C=chains.filter(c=>c&&c.pts&&c.pts.length>=2).map(c=>({k:c.k||'P',pts:c.pts.map(p=>[+p[0],+p[1]]),closed:!!c.closed}));
  const EPS=1e-9;
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const segDist=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
    let t=L2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2:0;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  };
  const proj=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;
    const t=L2?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2:0;
    const ct=Math.max(0,Math.min(1,t)),x=a[0]+ct*dx,y=a[1]+ct*dy;
    return {x,y,t,d:Math.hypot(p[0]-x,p[1]-y)};
  };
  const interSeg=(a,b,c,d)=>{
    const r=b[0]-a[0],s=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1];
    const den=r*v-s*u;if(Math.abs(den)<1e-9)return null;
    const t=((c[0]-a[0])*v-(c[1]-a[1])*u)/den,w=((c[0]-a[0])*s-(c[1]-a[1])*r)/den;
    if(t<0||t>1||w<0||w>1)return null;
    return {x:a[0]+t*r,y:a[1]+t*s,t,u:w};
  };
  const rayInter=(a,b,c,d)=>{
    const r=b[0]-a[0],s=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1];
    const den=r*v-s*u;if(Math.abs(den)<1e-9)return null;
    const t=((c[0]-a[0])*v-(c[1]-a[1])*u)/den,w=((c[0]-a[0])*s-(c[1]-a[1])*r)/den;
    if(w<0.01||w>0.99)return null;
    return {x:a[0]+t*r,y:a[1]+t*s,t,u:w};
  };
  const endpoints=()=>{
    const out=[];
    C.forEach((c,ci)=>{if(c.closed||c.pts.length<2)return;out.push({ci,pi:0});out.push({ci,pi:c.pts.length-1});});
    return out;
  };
  const isAttached=(ci,pi)=>{
    const e=C[ci].pts[pi];
    for(let j=0;j<C.length;j++){
      if(j===ci)continue;
      const o=C[j];if(o.pts.length<2)continue;
      if(dist(e,o.pts[0])<=1.2||dist(e,o.pts[o.pts.length-1])<=1.2)return true;
      for(let k=0;k<o.pts.length-1;k++)if(segDist(e,o.pts[k],o.pts[k+1])<=1.2)return true;
    }
    return false;
  };
  const splitAt=(ci,k,q)=>{
    const c=C[ci],a=c.pts[k],b=c.pts[k+1];
    if(dist(a,q)<0.75||dist(b,q)<0.75)return false;
    const pr=proj(q,a,b);
    if(pr.d>Math.max(1.5,tol*0.5))return false;
    c.pts.splice(k+1,0,[pr.x,pr.y]);stats.splits++;return true;
  };
  const joinPass=()=>{
    let changed=false;
    const refs=endpoints(),parent=refs.map((_,i)=>i);
    const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
    const uni=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
    for(let i=0;i<refs.length;i++)for(let j=i+1;j<refs.length;j++){
      const A=refs[i],B=refs[j];
      if(A.ci===B.ci&&Math.abs(A.pi-B.pi)<C[A.ci].pts.length-1)continue;
      if(dist(C[A.ci].pts[A.pi],C[B.ci].pts[B.pi])<=tol)uni(i,j);
    }
    const groups=new Map();
    refs.forEach((r,i)=>{const f=find(i);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(r)});
    for(const g of groups.values()){
      if(g.length<2)continue;
      const mx=g.reduce((s,r)=>s+C[r.ci].pts[r.pi][0],0)/g.length;
      const my=g.reduce((s,r)=>s+C[r.ci].pts[r.pi][1],0)/g.length;
      if(!g.some(r=>dist(C[r.ci].pts[r.pi],[mx,my])>0.01))continue;
      for(const r of g)C[r.ci].pts[r.pi]=[mx,my];
      stats.joins+=g.length-1;changed=true;
    }
    const refs2=endpoints();
    for(const r of refs2){
      if(isAttached(r.ci,r.pi))continue;
      const c=C[r.ci],e=c.pts[r.pi],p=c.pts[r.pi===0?1:c.pts.length-2];
      const ux=e[0]-p[0],uy=e[1]-p[1],L=Math.hypot(ux,uy);if(L<EPS)continue;
      let best=null;
      for(let ci=0;ci<C.length;ci++){
        if(ci===r.ci)continue;
        const o=C[ci];if(o.pts.length<2)continue;
        for(let k=0;k<o.pts.length-1;k++){
          const a=o.pts[k],b=o.pts[k+1],vx=b[0]-a[0],vy=b[1]-a[1],vL=Math.hypot(vx,vy);
          if(vL<EPS)continue;
          if(Math.abs(ux*vy-uy*vx)/(L*vL)<0.15)continue;
          const pr=proj(e,a,b);
          if(pr.t<0.02||pr.t>0.98||pr.d>tol)continue;
          if(!best||pr.d<best.d)best={ci,k,q:[pr.x,pr.y],d:pr.d};
        }
      }
      if(best){
        C[r.ci].pts[r.pi]=best.q;splitAt(best.ci,best.k,best.q);
        stats.joins++;changed=true;break;
      }
    }
    return changed;
  };
  const extendPass=()=>{
    let changed=false;
    for(const r of endpoints()){
      if(isAttached(r.ci,r.pi))continue;
      const c=C[r.ci],e=c.pts[r.pi],p=c.pts[r.pi===0?1:c.pts.length-2];
      const L=dist(p,e);if(L<EPS)continue;
      const ux=(e[0]-p[0])/L,uy=(e[1]-p[1])/L;
      let best=null;
      for(let ci=0;ci<C.length;ci++){
        if(ci===r.ci)continue;
        const o=C[ci];if(o.pts.length<2)continue;
        for(let k=0;k<o.pts.length-1;k++){
          const X=rayInter(p,e,o.pts[k],o.pts[k+1]);
          if(!X||X.t<=1)continue;
          const d=(X.t-1)*L;if(d>tol)continue;
          if(!best||d<best.d)best={ci,k,q:[X.x,X.y],d};
        }
      }
      for(let ci=0;ci<C.length;ci++){
        if(ci===r.ci)continue;
        const o=C[ci];if(o.closed||o.pts.length<2)continue;
        for(const pi of [0,o.pts.length-1]){
          const q=o.pts[pi],vx=q[0]-e[0],vy=q[1]-e[1],d=Math.hypot(vx,vy);
          if(d<EPS||d>tol)continue;
          if(vx*ux+vy*uy<d*0.5)continue;
          if(!best||d<best.d)best={ci,k:-1,q,d};
        }
      }
      if(best){
        C[r.ci].pts[r.pi]=best.q;
        if(best.k>=0)splitAt(best.ci,best.k,best.q);
        stats.extends++;changed=true;break;
      }
    }
    return changed;
  };
  const trimPass=()=>{
    let changed=false;
    for(const r of endpoints()){
      if(isAttached(r.ci,r.pi))continue;
      const c=C[r.ci],e=c.pts[r.pi],p=c.pts[r.pi===0?1:c.pts.length-2];
      const L=dist(p,e);if(L<EPS)continue;
      let best=null;
      for(let ci=0;ci<C.length;ci++){
        if(ci===r.ci)continue;
        const o=C[ci];if(o.pts.length<2)continue;
        for(let k=0;k<o.pts.length-1;k++){
          const X=interSeg(p,e,o.pts[k],o.pts[k+1]);
          if(!X)continue;
          const d=(1-X.t)*L;
          if(d<0.75||d>tol)continue;
          if(!best||d<best.d)best={ci,k,q:[X.x,X.y],d};
        }
      }
      if(best){
        C[r.ci].pts[r.pi]=best.q;splitAt(best.ci,best.k,best.q);
        stats.trims++;changed=true;break;
      }
    }
    return changed;
  };
  const run=(fn,max)=>{for(let i=0;i<max;i++){if(!fn())break;}};
  if(doJoin)run(joinPass,8);
  if(doExtend)run(extendPass,8);
  if(doTrim)run(trimPass,8);
  if(doJoin)run(joinPass,4);
  C.forEach(c=>{
    const pts=[];
    for(const p of c.pts){if(!pts.length||dist(pts[pts.length-1],p)>0.5)pts.push(p);}
    if(pts.length>2&&dist(pts[0],pts[pts.length-1])<0.5)c.closed=true;
    c.pts=pts;
  });
  C=C.filter(c=>c.pts.length>=2);
  const segs=[];
  for(const c of C)for(let i=0;i<c.pts.length-1;i++){
    const a=c.pts[i],b=c.pts[i+1];
    if(dist(a,b)>=1)segs.push([a[0],a[1],b[0],b[1],c.k||'P']);
  }
  let flat=removeDuplicates(segs);
  flat=splitAtIntersections(flat);
  const out=plotPetaBuildChains(flat.map(q=>[[q[0],q[1]],[q[2],q[3]]]),1.5,Math.max(2,tol));
  out.forEach(c=>{c.k='P';});
  plotPetaNumberEnds(out);
  stats.chains1=out.length;
  return {chains:out,stats};
}

function polygonize(){
  const tol=Math.max(1,num($('pTol').value)||8),V=[],hash=new Map();
  const vid=(x,y)=>{
    const cx=Math.floor(x/tol),cy=Math.floor(y/tol);
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){
      const L=hash.get((cx+a)+','+(cy+b));
      if(L)for(const id of L)if(Math.hypot(V[id][0]-x,V[id][1]-y)<=tol)return id;
    }
    V.push([x,y]);
    const k=cx+','+cy;
    if(!hash.has(k))hash.set(k,[]);
    hash.get(k).push(V.length-1);
    return V.length-1;
  };
  const S=[];
  lines.forEach(l=>{
    for(let i=0;i<l.pts.length-1;i++){
      const a=vid(l.pts[i][0],l.pts[i][1]),b=vid(l.pts[i+1][0],l.pts[i+1][1]);
      if(a!==b)S.push([a,b]);
    }
  });
  const n=S.length,sp=S.map(()=>[]);
  const bb=S.map(([a,b])=>[Math.min(V[a][0],V[b][0])-tol,Math.min(V[a][1],V[b][1])-tol,Math.max(V[a][0],V[b][0])+tol,Math.max(V[a][1],V[b][1])+tol]);
  const onSeg=(i,v)=>{
    const[a,b]=S[i];
    if(v===a||v===b)return;
    const ax=V[a][0],ay=V[a][1],dx=V[b][0]-ax,dy=V[b][1]-ay,t=((V[v][0]-ax)*dx+(V[v][1]-ay)*dy)/(dx*dx+dy*dy);
    if(t<=0||t>=1)return;
    if(Math.hypot(ax+t*dx-V[v][0],ay+t*dy-V[v][1])<=tol)sp[i].push([t,v]);
  };
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const A=bb[i],B=bb[j];
    if(A[0]>B[2]||B[0]>A[2]||A[1]>B[3]||B[1]>A[3])continue;
    onSeg(i,S[j][0]);onSeg(i,S[j][1]);onSeg(j,S[i][0]);onSeg(j,S[i][1]);
    const p=V[S[i][0]],q=V[S[i][1]],r=V[S[j][0]],s=V[S[j][1]],d=(q[0]-p[0])*(s[1]-r[1])-(q[1]-p[1])*(s[0]-r[0]);
    if(Math.abs(d)<1e-9)continue;
    const ti=((r[0]-p[0])*(s[1]-r[1])-(r[1]-p[1])*(s[0]-r[0]))/d,tj=((r[0]-p[0])*(q[1]-p[1])-(r[1]-p[1])*(q[0]-p[0]))/d;
    if(ti>0&&ti<1&&tj>0&&tj<1){
      const v=vid(p[0]+ti*(q[0]-p[0]),p[1]+ti*(q[1]-p[1]));
      sp[i].push([ti,v]);sp[j].push([tj,v]);
    }
  }
  const E=new Set(),adj=new Map(),add=(u,w)=>{
    if(u===w)return;
    const k=u<w?u+','+w:w+','+u;
    if(E.has(k))return;
    E.add(k);
    (adj.get(u)||adj.set(u,[]).get(u)).push(w);
    (adj.get(w)||adj.set(w,[]).get(w)).push(u);
  };
  for(let i=0;i<n;i++){
    const ids=[S[i][0],...sp[i].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),S[i][1]];
    for(let k=0;k<ids.length-1;k++)add(ids[k],ids[k+1]);
  }
  const gp=[];
  adj.forEach((nb,v)=>{if(nb.length===1)gp.push(V[v].slice())});
  const q2=[];
  adj.forEach((nb,v)=>{if(nb.length<2)q2.push(v)});
  while(q2.length){
    const v=q2.pop(),nb=adj.get(v);
    if(!nb)continue;
    nb.forEach(w=>{
      const a=adj.get(w);
      if(a){a.splice(a.indexOf(v),1);if(a.length<2)q2.push(w)}
    });
    adj.delete(v);
  }
  adj.forEach((nb,v)=>nb.sort((a,b)=>Math.atan2(V[a][1]-V[v][1],V[a][0]-V[v][0])-Math.atan2(V[b][1]-V[v][1],V[b][0]-V[v][0])));
  const vis=new Set(),out=[],minA=tol*tol*2;
  adj.forEach((nb,u0)=>nb.forEach(w0=>{
    if(vis.has(u0+'>'+w0))return;
    let u=u0,w=w0,c=0;
    const ring=[];
    while(!vis.has(u+'>'+w)&&c++<20000){
      vis.add(u+'>'+w);
      ring.push(V[u]);
      const l=adj.get(w),ix=l.indexOf(u),nx=l[(ix-1+l.length)%l.length];
      u=w;w=nx;
    }
    if(u===u0&&w===w0&&ring.length>=3){
      let A=0;
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length];
        A+=a[0]*b[1]-b[0]*a[1];
      }
      if(A/2>minA)out.push(ring.map(p=>p.slice()));
    }
  }));
  return{polys:out,gaps:gp};
}
$('pMk').onclick=()=>{
  if(!lines.length){$('pMsg').textContent='Belum ada garis.';return}
  $('pMsg').textContent='Memproses...';
  setTimeout(()=>{
    try{
      const r=polygonize();
      polys=r.polys;
      gaps=r.gaps;
      $('pMsg').textContent=polys.length+' poligon dibuat. '+gaps.length+' ujung garis menggantung (cincin merah), kemungkinan celah di pojok atau garis yang menjulur.';
    }catch(x){$('pMsg').textContent='Gagal: '+x.message}
    draw();
  },30);
};
$('pDel').onclick=()=>{polys=[];gaps=[];$('pMsg').textContent='';draw()};
