/* ============================================================================
 * MESIN JEJAK BATAS (metode deteksi "Mesin jejak")
 *
 * Status: diuji pada peta uji buatan dan dua scan contoh (penilaian dari gambar, belum ada data acuan
 * di peta asli). Hasil harus ditinjau petugas sebelum dipakai.
 *
 * Bergantung pada (sudah ada di aplikasi): img, $(id), plotPetaBuildChains, plotPetaNumberEnds,
 * dan isian #pTol.
 *
 * Titik masuk: detectTrace(R, opt)  dengan R = {x, y, w, h} (piksel gambar asli).
 * Keluaran: daftar jalur seperti detect(): {pts, closed, free, nums}; properti .stats berisi ringkasan.
 *
 * Tahap: kontras lokal (garis tipis dan pudar tetap terbaca) -> buang gumpalan kecil -> kerangka 1 piksel
 *   -> graf -> pangkas ranting -> saring tulisan -> saring tanda silang kisi (+) -> pasang garis lurus
 *   (sudut dari perpotongan) -> tutup celah berdasarkan arah garis -> buang goresan tunggal pendek.
 *
 * Yang SENGAJA tidak ada: penyaring bingkai peta. Aturan panjang-garis yang diuji menghapus garis batas
 * asli pada peta berblok sejajar sumbu. Bingkai yang ikut terbaca dibuang petugas secara manual.
 *
 * Opsi (semuanya opsional): minLen, linkMax, maxSide, ridge:false (ambang gelap lama), textFilter:false,
 * plusFilter:false, isoFilter:false.
 *
 * Opsi tambahan (default aman, perilaku lama tetap):
 *   textCfg     : objek ambang filter teks (lihat PP_TEXT_DEFAULTS). Contoh: {dropScore:2.4}
 *   curve       : {curveTurn, curveSmooth, curveEpsScale} untuk mempertahankan garis lengkung.
 *   angTight    : toleransi sudut (derajat) untuk menutup celah lebar yang hampir segaris (default 12).
 *   longFactor  : pengali linkMax untuk celah lebar tersebut (default 1.6).
 * Ringkasan hasil tersedia di chains.stats (teksDibuang, garisPutus, ruasLengkung, linkMax, medianRuas).
 *
 * Mencabut: pilih metode "Standar" di panel Deteksi Otomatis, atau hapus berkas ini dan barisnya di index.html.
 * ============================================================================ */
// ==== PLOTPETA ENGINE BEGIN ====
// Mesin jejak batas bidang: raster -> kerangka 1 px -> graf -> garis lurus yang dipasang ulang
// -> penutup celah berbasis arah -> jalur bernomor. Semua keluaran dalam koordinat gambar (px asli).

// Douglas-Peucker; mengembalikan indeks titik yang dipertahankan.
function ppDP(P,eps){
  const n=P.length;if(n<3){const o=[];for(let i=0;i<n;i++)o.push(i);return o}
  const keep=new Uint8Array(n);keep[0]=keep[n-1]=1;const st=[[0,n-1]];
  while(st.length){
    const [a,b]=st.pop();let m=-1,md=eps;
    const ax=P[a][0],ay=P[a][1],dx=P[b][0]-ax,dy=P[b][1]-ay,L=Math.hypot(dx,dy);
    for(let i=a+1;i<b;i++){
      const d=L<1e-9?Math.hypot(P[i][0]-ax,P[i][1]-ay):Math.abs((P[i][0]-ax)*dy-(P[i][1]-ay)*dx)/L;
      if(d>md){md=d;m=i}
    }
    if(m>=0){keep[m]=1;st.push([a,m],[m,b])}
  }
  const o=[];for(let i=0;i<n;i++)if(keep[i])o.push(i);return o;
}
// Garis lurus terbaik (total least squares) untuk titik P[i0..i1]; ujung-ujungnya dibuang sedikit
// karena kerangka melengkung di dekat sudut dan simpang.
function ppFit(P,i0,i1){
  const n=i1-i0+1,t=Math.max(2,Math.min(12,Math.floor(n*0.2)));
  let a=i0+t,b=i1-t;if(b-a<2){a=i0;b=i1}
  let mx=0,my=0;const c=b-a+1;
  for(let i=a;i<=b;i++){mx+=P[i][0];my+=P[i][1]}
  mx/=c;my/=c;
  let sxx=0,sxy=0,syy=0;
  for(let i=a;i<=b;i++){const x=P[i][0]-mx,y=P[i][1]-my;sxx+=x*x;sxy+=x*y;syy+=y*y}
  const th=0.5*Math.atan2(2*sxy,sxx-syy);let ux=Math.cos(th),uy=Math.sin(th);
  if((P[i1][0]-P[i0][0])*ux+(P[i1][1]-P[i0][1])*uy<0){ux=-ux;uy=-uy}
  return {cx:mx,cy:my,ux,uy,len:Math.hypot(P[i1][0]-P[i0][0],P[i1][1]-P[i0][1])};
}
function ppInter(A,B){
  const den=A.ux*B.uy-A.uy*B.ux;if(Math.abs(den)<1e-9)return null;
  const t=((B.cx-A.cx)*B.uy-(B.cy-A.cy)*B.ux)/den;
  return {x:A.cx+t*A.ux,y:A.cy+t*A.uy,s:Math.abs(den)};
}
// Titik yang paling dekat ke semua garis (kuadrat terkecil); null bila garis-garis hampir sejajar.
function ppNodeLSQ(lines){
  let a=0,b=0,c=0,r1=0,r2=0;
  for(const L of lines){const nx=-L.uy,ny=L.ux,d=nx*L.cx+ny*L.cy;a+=nx*nx;b+=nx*ny;c+=ny*ny;r1+=nx*d;r2+=ny*d}
  const det=a*c-b*b;if(det<0.02*lines.length*lines.length*0.25)return null;
  return [(c*r1-b*r2)/det,(a*r2-b*r1)/det];
}

// Citra -> biner. Otsu + rata-rata lokal supaya peta pudar atau tidak rata tetap terbaca.
function ppBinarize(R,sc){
  const w=Math.max(32,Math.round(R.w*sc)),h=Math.max(32,Math.round(R.h*sc)),N=w*h;
  const oc=document.createElement('canvas');oc.width=w;oc.height=h;
  const cx=oc.getContext('2d',{willReadFrequently:true});
  cx.fillStyle='#fff';cx.fillRect(0,0,w,h);cx.imageSmoothingQuality='high';
  cx.drawImage(img,R.x,R.y,R.w,R.h,0,0,w,h);
  const rgba=cx.getImageData(0,0,w,h).data,gray=new Uint8Array(N),hist=new Uint32Array(256);
  for(let i=0;i<N;i++){const v=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);gray[i]=v;hist[v]++}
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let sumB=0,wB=0,best=-1,thr=170;
  for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=N-wB;if(!wF)break;sumB+=t*hist[t];const d=sumB/wB-(sum-sumB)/wF;const s=wB*wF*d*d;if(s>best){best=s;thr=t}}
  const I=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=gray[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row}}
  const bin=new Uint8Array(N),rad=14;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=Math.max(0,x-rad),x1=Math.min(w,x+rad+1),y0=Math.max(0,y-rad),y1=Math.min(h,y+rad+1);
    const m=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
    const i=y*w+x,lt=Math.max(65,Math.min(thr,m-7));
    if(gray[i]<lt)bin[i]=1;
  }
  for(let x=0;x<w;x++){bin[x]=0;bin[(h-1)*w+x]=0}
  for(let y=0;y<h;y++){bin[y*w]=0;bin[y*w+w-1]=0}
  return {bin,w,h};
}
// Deteksi garis tipis dan pudar lewat kontras lokal (punggung/lembah intensitas), bukan ambang gelap mutlak.
// Garis abu-abu muda tetap terbaca selama lebih gelap dari sekitarnya, dan noda lebar tidak ikut.
function ppBinarizeRidge(R,sc,sigma,rel){
  const w=Math.max(32,Math.round(R.w*sc)),h=Math.max(32,Math.round(R.h*sc)),N=w*h;
  const oc=document.createElement('canvas');oc.width=w;oc.height=h;
  const cx=oc.getContext('2d',{willReadFrequently:true});
  cx.fillStyle='#fff';cx.fillRect(0,0,w,h);cx.imageSmoothingQuality='high';
  cx.drawImage(img,R.x,R.y,R.w,R.h,0,0,w,h);
  const rgba=cx.getImageData(0,0,w,h).data,g=new Float32Array(N),hist=new Uint32Array(256);
  for(let i=0;i<N;i++){const v=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);g[i]=v;hist[v]++}
  let cnt=0,med=128,mean=0;for(let k=0;k<256;k++){cnt+=hist[k];if(cnt>=N/2&&med===128&&k!==128)med=k;mean+=k*hist[k]}
  if(mean/N>med+0)for(let i=0;i<N;i++)g[i]=255-g[i]; // peta berlatar gelap: balik supaya tinta tetap gelap
  const s=sigma||1.3,rad=Math.ceil(3*s),ker=new Float32Array(2*rad+1);let ks=0;
  for(let i=-rad;i<=rad;i++){ker[i+rad]=Math.exp(-i*i/(2*s*s));ks+=ker[i+rad]}
  for(let i=0;i<ker.length;i++)ker[i]/=ks;
  const tmp=new Float32Array(N),G=new Float32Array(N);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let a=0;for(let k=-rad;k<=rad;k++){const xx=Math.min(w-1,Math.max(0,x+k));a+=g[y*w+xx]*ker[k+rad]}tmp[y*w+x]=a}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let a=0;for(let k=-rad;k<=rad;k++){const yy=Math.min(h-1,Math.max(0,y+k));a+=tmp[yy*w+x]*ker[k+rad]}G[y*w+x]=a}
  const Rr=new Float32Array(N);let mx=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,Ixx=G[i+1]-2*G[i]+G[i-1],Iyy=G[i+w]-2*G[i]+G[i-w],Ixy=(G[i+w+1]-G[i+w-1]-G[i-w+1]+G[i-w-1])/4;
    const a=(Ixx+Iyy)/2,b=Math.sqrt(((Ixx-Iyy)/2)*((Ixx-Iyy)/2)+Ixy*Ixy),l1=a+b,l2=a-b;
    let r=l1-0.3*Math.max(0,l2);if(r<0)r=0;Rr[i]=r;if(r>mx)mx=r;
  }
  const B=2048,hh=new Uint32Array(B);let nz=0;
  for(let i=0;i<N;i++){const r=Rr[i];if(r>0){hh[Math.min(B-1,(r/mx*B)|0)]++;nz++}}
  const pct=q=>{let c=0,tg=nz*q;for(let k=0;k<B;k++){c+=hh[k];if(c>=tg)return (k+1)/B*mx}return mx};
  const p997=pct(0.997),pmed=pct(0.5);
  // Ambang ridge = porsi dari puncak + lantai derau. Lantai derau (6*pmed) DIBATASI
  // terhadap puncak: pada peta BERSIH hampir semua respons positif berasal dari garis,
  // sehingga pmed ikut tinggi dan 6*pmed bisa melebihi puncak -> tidak ada piksel lolos
  // (gejala: peta bersih menghasilkan 0 garis). Batas 0.30*p997 menjaga hasil tetap aman
  // untuk peta berderau (di sana pmed kecil, jadi batas ini tidak berpengaruh).
  const t=Math.max((rel||0.10)*p997,Math.min(6*pmed,0.30*p997));
  const bin=new Uint8Array(N);
  for(let i=0;i<N;i++)if(Rr[i]>t)bin[i]=1;
  for(let x=0;x<w;x++){bin[x]=0;bin[(h-1)*w+x]=0}
  for(let y=0;y<h;y++){bin[y*w]=0;bin[y*w+w-1]=0}
  return {bin,w,h};
}
// Buang gumpalan kecil (huruf, angka, titik, simbol). Garis batas membentuk satu jaringan besar.
function ppDropSmall(bin,w,h,minSide){
  const N=w*h,q=new Int32Array(N),seen=new Uint8Array(N);
  for(let s=0;s<N;s++){
    if(!bin[s]||seen[s])continue;
    let qh=0,qt=0,x0=1e9,y0=1e9,x1=-1,y1=-1;q[qt++]=s;seen[s]=1;
    while(qh<qt){
      const i=q[qh++],x=i%w,y=(i/w)|0;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;
        if(xx<0||yy<0||xx>=w||yy>=h)continue;
        const j=yy*w+xx;if(bin[j]&&!seen[j]){seen[j]=1;q[qt++]=j}
      }
    }
    if(Math.max(x1-x0,y1-y0)+1<minSide)for(let k=0;k<qt;k++)bin[q[k]]=0;
  }
}
// Zhang-Suen + pembersihan sudut-L supaya kerangka benar-benar setebal 1 piksel
// (tanpa ini garis miring menjadi tangga yang terpecah jadi ratusan simpul kecil).
function ppThin(bin,w,h){
  const N=w*h;let act=[];for(let i=w+1;i<N-w-1;i++)if(bin[i])act.push(i);
  const mark=[];let changed=true,iter=0;
  while(changed&&iter++<40){
    changed=false;
    for(let phase=0;phase<2;phase++){
      mark.length=0;
      for(const i of act){
        if(!bin[i])continue;
        const p0=bin[i-w],p1=bin[i-w+1],p2=bin[i+1],p3=bin[i+w+1],p4=bin[i+w],p5=bin[i+w-1],p6=bin[i-1],p7=bin[i-w-1];
        const B=p0+p1+p2+p3+p4+p5+p6+p7;if(B<2||B>6)continue;
        const A=(!p0&&p1)+(!p1&&p2)+(!p2&&p3)+(!p3&&p4)+(!p4&&p5)+(!p5&&p6)+(!p6&&p7)+(!p7&&p0);
        if(A!==1)continue;
        if(phase===0){if(p0*p2*p4||p2*p4*p6)continue}else{if(p0*p2*p6||p0*p4*p6)continue}
        mark.push(i);
      }
      if(mark.length){changed=true;for(const i of mark)bin[i]=0}
      act=act.filter(i=>bin[i]);
    }
  }
  // Hapus piksel "sederhana" (bilangan konektivitas Yokoi = 1) yang bukan ujung. Ini membuang
  // sisa tangga pada garis miring tanpa memutus jaringan, sehingga tiap ruas lurus bergaris 1 piksel.
  for(let pass=0;pass<8;pass++){
    let ch=false;
    for(const i of act){
      if(!bin[i])continue;
      const x1=bin[i+1],x2=bin[i-w+1],x3=bin[i-w],x4=bin[i-w-1],x5=bin[i-1],x6=bin[i+w-1],x7=bin[i+w],x8=bin[i+w+1];
      if(x1+x2+x3+x4+x5+x6+x7+x8<2)continue;
      const n1=1-x1,n2=1-x2,n3=1-x3,n4=1-x4,n5=1-x5,n6=1-x6,n7=1-x7,n8=1-x8;
      const N8=(n1-n1*n2*n3)+(n3-n3*n4*n5)+(n5-n5*n6*n7)+(n7-n7*n8*n1);
      if(N8===1){bin[i]=0;ch=true}
    }
    if(!ch)break;
    act=act.filter(i=>bin[i]);
  }
}
// Kerangka 1 px -> graf (simpul = ujung dan simpang; sisi = jalur piksel di antaranya).
function ppSkeletonGraph(bin,w,h){
  const N=w*h,off=[-w-1,-w,-w+1,-1,1,w-1,w,w+1];
  const deg=new Uint8Array(N),nodeOf=new Int32Array(N).fill(-1),seen=new Uint8Array(N),pix=[];
  for(let i=w+1;i<N-w-1;i++)if(bin[i]){let d=0;for(const o of off)d+=bin[i+o];deg[i]=d;pix.push(i)}
  const nodes=[],edges=[];
  for(const i of pix){
    if(deg[i]===2||nodeOf[i]>=0||deg[i]===0)continue;
    const id=nodes.length,q=[i];nodeOf[i]=id;let sx=0,sy=0;
    for(let k=0;k<q.length;k++){
      const u=q[k];sx+=u%w;sy+=(u/w|0);
      for(const o of off){const v=u+o;if(bin[v]&&deg[v]!==2&&deg[v]!==0&&nodeOf[v]<0){nodeOf[v]=id;q.push(v)}}
    }
    nodes.push({x:sx/q.length+0.5,y:sy/q.length+0.5,members:q});
  }
  const walk=(start,first)=>{
    const path=[start];let prev=start,cur=first,guard=0;
    while(guard++<N){
      path.push(cur);
      if(nodeOf[cur]>=0)break;
      seen[cur]=1;
      let nx=-1;for(const o of off){const q=cur+o;if(bin[q]&&q!==prev){nx=q;break}}
      if(nx<0)return {path,end:-1};
      if(seen[nx]&&nodeOf[nx]<0)return {path,end:-1};
      prev=cur;cur=nx;
    }
    return {path,end:nodeOf[path[path.length-1]]};
  };
  const pt=i=>[i%w+0.5,((i/w)|0)+0.5];
  const emit=(a,r)=>{
    const interior=r.path.slice(1,r.end>=0?-1:undefined).map(pt);
    const b=r.end>=0?r.end:-1;if(b<0)return;
    edges.push({a,b,pts:[[nodes[a].x,nodes[a].y],...interior,[nodes[b].x,nodes[b].y]]});
  };
  for(let a=0;a<nodes.length;a++)for(const m of nodes[a].members)for(const o of off){
    const n=m+o;if(!bin[n]||nodeOf[n]===a||seen[n])continue;
    if(nodeOf[n]>=0){continue}
    emit(a,walk(m,n));
  }
  for(const i of pix){ // lingkaran tertutup tanpa simpul
    if(deg[i]!==2||seen[i]||nodeOf[i]>=0)continue;
    const id=nodes.length;nodeOf[i]=id;nodes.push({x:i%w+0.5,y:((i/w)|0)+0.5,members:[i]});
    for(const o of off){const n=i+o;if(bin[n]&&!seen[n]){emit(id,walk(i,n));break}}
  }
  return {nodes,edges};
}
const ppLen=P=>{let L=0;for(let i=1;i<P.length;i++)L+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);return L};
// Pangkas ranting pendek yang menempel di simpang (sisa huruf, tepi kasar, ujung menjulur),
// lalu gabungkan sisi di simpul berderajat 2 menjadi satu jalur.
function ppMergeDeg2(edges){
  let merged=true,guard=0;
  while(merged&&guard++<100000){
    merged=false;
    const inc=new Map();edges.forEach((e,k)=>{(inc.get(e.a)||inc.set(e.a,[]).get(e.a)).push(k);(inc.get(e.b)||inc.set(e.b,[]).get(e.b)).push(k)});
    const dead=new Set(),add=[];
    for(const [n,ks] of inc){
      if(ks.length!==2||ks[0]===ks[1]||dead.has(ks[0])||dead.has(ks[1]))continue;
      const e1=edges[ks[0]],e2=edges[ks[1]];
      const p1=e1.b===n?e1.pts:e1.pts.slice().reverse(),a1=e1.b===n?e1.a:e1.b;
      const p2=e2.a===n?e2.pts:e2.pts.slice().reverse(),b2=e2.a===n?e2.b:e2.a;
      dead.add(ks[0]);dead.add(ks[1]);add.push({a:a1,b:b2,pts:p1.concat(p2.slice(1))});merged=true;
    }
    if(merged)edges=edges.filter((_,k)=>!dead.has(k)).concat(add);
  }
  return edges;
}
function ppCleanGraph(G,spurLen,isoLen){
  let {nodes,edges}=G;
  edges=ppMergeDeg2(edges);
  for(let pass=0;pass<6;pass++){
    const d=new Int32Array(nodes.length);for(const e of edges){d[e.a]++;d[e.b]++}
    const keep=[];let ch=false;
    for(const e of edges){
      const L=ppLen(e.pts);
      const spur=e.a!==e.b&&((d[e.a]===1&&d[e.b]>=3)||(d[e.b]===1&&d[e.a]>=3))&&L<spurLen;
      const iso=d[e.a]===1&&d[e.b]===1&&e.a!==e.b&&L<isoLen;
      if(spur||iso){ch=true;continue}
      keep.push(e);
    }
    edges=ch?ppMergeDeg2(keep):keep;
    if(!ch)break;
  }
  return {nodes,edges};
}
// ---- Saringan tulisan / nomor bidang -----------------------------------------
// Versi lama hanya membuang ruas pendek yang bergerombol, sehingga nomor bidang
// ("Su. 123/45", "M. 678") yang ruasnya agak panjang dan lurus tetap lolos.
// Versi ini menilai beberapa ciri sekaligus (semua dapat di-tune lewat opt.textCfg):
//   1) panjang ruas (pendek / sedang),
//   2) kepadatan tetangga dalam radius kecil,
//   3) banyak ujung bebas di sekitar (huruf tidak menyambung ke jaringan batas),
//   4) orientasi beragam dalam klaster (ciri huruf/angka),
//   5) komponen terhubung kecil (satu huruf = 1-3 ruas) dan kelurusan rendah.
// DUA hal dilindungi agar garis batas tidak ikut terbuang:
//   - garis putus-putus: ruasnya sejajar, sebaris, dan orientasinya seragam;
//   - ruas yang menghubungkan dua simpang (derajat >= 2) atau bertetangga dengan
//     ruas panjang: bagian jaringan batas, bukan tulisan.
const PP_TEXT_DEFAULTS={
  radius:45,        // radius tetangga (px gambar asli)
  shortLen:45,      // batas "ruas pendek"
  mediumLen:250,    // ruas di atas ini tidak pernah dibuang oleh filter ini
  longSup:180,      // ruas >= ini dianggap "dukungan garis panjang"
  dropScore:2.0,    // skor minimum untuk membuang (naik = lebih longgar)
  maxCompEdges:8,   // komponen <= ini dianggap kecil (huruf)
  longGuard:2,      // jumlah dukungan garis panjang yang menahan pembuangan
  parDeg:15,        // toleransi sudut untuk dianggap sejajar (derajat)
  dashPar:0.65,     // porsi tetangga sejajar agar dicurigai garis putus-putus
  dashSpread:18,    // sebaran orientasi maksimum (derajat) untuk garis putus-putus
  dashPenalty:2.5,  // pengurang skor untuk garis putus-putus yang dilindungi
  interiorBonus:1.2 // pengurang skor bila kedua ujung menempel di simpang
};
// Statistik jaringan ruas untuk menyetel ambang secara adaptif.
// medLen (px asli) = median panjang ruas; shortRatio = porsi ruas < 60 px
// (peta pudar/putus-putus atau banyak tulisan); perMpx = kerapatan ruas.
function ppEdgeStats(edges,pxs,areaOrig){
  const lens=edges.map(e=>ppLen(e.pts)/pxs).sort((a,b)=>a-b);
  const n=lens.length,med=n?lens[(n/2)|0]:0;
  let short=0;for(const L of lens)if(L<60)short++;
  const area=Math.max(1,areaOrig||1);
  return {n,medLen:med,shortRatio:n?short/n:0,perMpx:n/(area/1e6)};
}
// Ambang filter teks diturunkan dari minLen (panjang garis minimum pilihan pengguna)
// dan dari statistik jaringan. Default tetap sama dengan perilaku lama (aman).
function ppTextCfg(stats,opt){
  opt=opt||{};
  const minLen=opt.minLen??120;
  const shortLen=Math.max(30,Math.min(95,0.45*minLen));
  const cfg=Object.assign({},PP_TEXT_DEFAULTS,{
    shortLen,
    radius:Math.max(35,Math.min(110,shortLen)),
    mediumLen:Math.max(160,Math.min(340,3.5*shortLen)),
    longSup:Math.max(120,Math.min(260,2.6*shortLen))
  });
  // Peta pudar/putus-putus: banyak ruas pendek -> filter dilonggarkan supaya
  // garis putus-putus yang menjadi batas bidang tidak ikut terbuang.
  if(stats&&stats.shortRatio>0.55)cfg.dropScore+=0.35;
  if(stats&&stats.shortRatio>0.72)cfg.dropScore+=0.25;
  // Penyetelan cepat saat uji lapangan tanpa mengubah berkas:
  //   window.ppTextCfgOverride={dropScore:2.4, shortLen:60}  lalu jalankan deteksi lagi.
  if(typeof window!=='undefined'&&window.ppTextCfgOverride)Object.assign(cfg,window.ppTextCfgOverride);
  return Object.assign(cfg,opt.textCfg||{});
}
function ppTextFilter(edges,pxs,opt){
  const o=Object.assign({},PP_TEXT_DEFAULTS,(opt&&opt.textCfg)||opt||{});
  if(!edges.length)return edges;
  const R=o.radius*pxs,Ls=o.shortLen*pxs,Lm=o.mediumLen*pxs,Lg=o.longSup*pxs;
  const parTol=o.parDeg*Math.PI/180;
  const info=edges.map(e=>{
    const P=e.pts,L=ppLen(P),a=P[0],b=P[P.length-1];
    const ch=Math.hypot(b[0]-a[0],b[1]-a[1]);
    return {L,S:L>1e-9?ch/L:1,ang:Math.atan2(b[1]-a[1],b[0]-a[0]),a,b,m:P[(P.length/2)|0]};
  });
  // Derajat simpul + ukuran komponen terhubung (huruf = komponen kecil).
  const deg=new Map(),parent=new Map();
  const find=x=>{let r=x;while(parent.get(r)!==r)r=parent.get(r);while(parent.get(x)!==r){const y=parent.get(x);parent.set(x,r);x=y}return r};
  for(const e of edges){
    deg.set(e.a,(deg.get(e.a)||0)+1);deg.set(e.b,(deg.get(e.b)||0)+1);
    if(!parent.has(e.a))parent.set(e.a,e.a);
    if(!parent.has(e.b))parent.set(e.b,e.b);
    const ra=find(e.a),rb=find(e.b);if(ra!==rb)parent.set(ra,rb);
  }
  const compSize=new Map();
  for(const e of edges){const r=find(e.a);compSize.set(r,(compSize.get(r)||0)+1)}
  // Kisi spasial hanya untuk ruas yang mungkin dibuang (ruas panjang tidak perlu tetangga).
  const cell=Math.max(R,1),grid=new Map();
  info.forEach((f,i)=>{
    if(f.L>Lm)return;
    const k=Math.floor(f.m[0]/cell)+','+Math.floor(f.m[1]/cell);
    const arr=grid.get(k);if(arr)arr.push(i);else grid.set(k,[i]);
  });
  const keep=[];let dropped=0,dashes=0;
  edges.forEach((e,i)=>{
    const f=info[i];
    if(f.L>=Lm){keep.push(e);return}          // ruas panjang tidak pernah dibuang di sini
    const cx=Math.floor(f.m[0]/cell),cy=Math.floor(f.m[1]/cell),nbs=[];
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){
      const arr=grid.get((cx+a)+','+(cy+b));if(!arr)continue;
      for(const j of arr){
        if(j===i)continue;
        const g=info[j];if(Math.hypot(g.m[0]-f.m[0],g.m[1]-f.m[1])<=R)nbs.push(j);
      }
    }
    const nNb=nbs.length,angs=[];
    let nEnd=0,nPar=0,nLong=0,nCol=0;
    const ux=Math.cos(f.ang),uy=Math.sin(f.ang);
    for(const j of nbs){
      const g=info[j];angs.push(g.ang);
      if(g.L>=Lg)nLong++;
      for(const p of [g.a,g.b])if(Math.hypot(p[0]-f.m[0],p[1]-f.m[1])<=R)nEnd++;
      let da=Math.abs(g.ang-f.ang)%Math.PI;da=Math.min(da,Math.PI-da);
      if(da<=parTol)nPar++;
      // sebaris dengan ruas ini? (untuk mengenali garis putus-putus)
      const vx=g.m[0]-f.m[0],vy=g.m[1]-f.m[1];
      if(Math.abs(vx*uy-vy*ux)<=Math.max(6*pxs,0.25*f.L))nCol++;
    }
    const par=nNb?nPar/nNb:0,col=nNb?nCol/nNb:0;
    let spread=0;
    if(angs.length>=2){
      angs.sort((x,y)=>x-y);
      let gap=angs[0]+Math.PI-angs[angs.length-1];
      for(let k=1;k<angs.length;k++)gap=Math.max(gap,angs[k]-angs[k-1]);
      spread=(Math.PI-gap)*180/Math.PI;
    }
    const isDash=par>=o.dashPar&&spread<=o.dashSpread&&col>=0.5;
    const comp=compSize.get(find(e.a))||1;
    let score=0;
    if(f.L<Ls)score+=1.2;
    else score+=0.8*(1-(f.L-Ls)/Math.max(1,Lm-Ls));
    score+=Math.min(1.2,nNb/6);
    score+=Math.min(1.0,nEnd/(2+2*Math.max(1,nNb)));
    if(spread>25)score+=Math.min(1.0,(spread-25)/45);
    score+=1.4*(1-f.S);
    if(comp<=o.maxCompEdges&&f.L<Ls*2.5)score+=0.5;
    score-=1.1*par;
    if(nLong>=o.longGuard)score-=0.8;
    if((deg.get(e.a)||0)>=2&&(deg.get(e.b)||0)>=2)score-=o.interiorBonus;
    if(comp>o.maxCompEdges)score-=0.3;
    if(isDash){score-=o.dashPenalty;dashes++}
    // goresan terpencil yang pendek dan berkelok: hampir pasti bukan batas bidang
    const isolated=comp<=3&&f.L<Lm&&f.S<0.55;
    if(isolated||score>=o.dropScore)dropped++;else keep.push(e);
  });
  keep.stats={teksDibuang:dropped,garisPutus:dashes};
  return keep;
}
// Buang tanda silang kisi (+): komponen graf kecil berujung 4 yang membentuk salib.
// Salib yang menempel pada garis batas ikut jaringan besar dan tidak disentuh di sini.
function ppDropPlusMarks(G,pxs){
  const {nodes,edges}=G,par=nodes.map((_,i)=>i);
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x};
  for(const e of edges)par[find(e.a)]=find(e.b);
  const comps=new Map();
  edges.forEach((e,k)=>{const r=find(e.a);(comps.get(r)||comps.set(r,{edges:[],nodes:new Set()}).get(r)).edges.push(k);const c=comps.get(r);c.nodes.add(e.a);c.nodes.add(e.b)});
  const drop=new Set();let n=0;
  for(const c of comps.values()){
    if(c.edges.length<4||c.edges.length>6)continue;
    const deg=new Map();let L=0,x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const k of c.edges){const e=edges[k];deg.set(e.a,(deg.get(e.a)||0)+1);deg.set(e.b,(deg.get(e.b)||0)+1);L+=ppLen(e.pts);for(const p of e.pts){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1]}}
    const ends=[...deg].filter(([,d])=>d===1).map(([id])=>id);
    if(ends.length!==4)continue;
    const bw=(x1-x0)/pxs,bh=(y1-y0)/pxs;
    if(Math.max(bw,bh)<25||Math.max(bw,bh)>190||Math.max(bw,bh)/Math.max(1,Math.min(bw,bh))>1.7)continue;
    const cx=ends.reduce((s,i)=>s+nodes[i].x,0)/4,cy=ends.reduce((s,i)=>s+nodes[i].y,0)/4;
    const an=ends.map(i=>Math.atan2(nodes[i].y-cy,nodes[i].x-cx)).sort((a,b)=>a-b);
    let ok=true;for(let i=0;i<4;i++){let d=(an[(i+1)%4]-an[i]+2*Math.PI)%(2*Math.PI);if(d<Math.PI/3||d>2*Math.PI/3)ok=false}
    if(!ok)continue;
    for(const k of c.edges)drop.add(k);n++;
  }
  G.edges=edges.filter((_,k)=>!drop.has(k));
  return n;
}
// Tanda silang berpusat terbuka: empat goresan pendek terpisah (dua mendatar, dua tegak) mengelilingi satu titik.
function ppDropOpenPlus(G,pxs){
  const {nodes,edges}=G,par=nodes.map((_,i)=>i);
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x};
  for(const e of edges)par[find(e.a)]=find(e.b);
  const cnt=new Map();for(const e of edges){const r=find(e.a);cnt.set(r,(cnt.get(r)||0)+1)}
  const arms=[];
  edges.forEach((e,k)=>{
    if(cnt.get(find(e.a))!==1||e.a===e.b)return;
    const L=ppLen(e.pts)/pxs,p=e.pts[0],q=e.pts[e.pts.length-1],ch=Math.hypot(q[0]-p[0],q[1]-p[1])/pxs;
    if(L<8||L>80||ch/L<0.9)return;
    arms.push({k,p,q,ang:Math.atan2(q[1]-p[1],q[0]-p[0])});
  });
  const cell=70*pxs,grid=new Map();
  arms.forEach((a,i)=>{const mx=(a.p[0]+a.q[0])/2,my=(a.p[1]+a.q[1])/2;a.m=[mx,my];const key=Math.floor(mx/cell)+','+Math.floor(my/cell);(grid.get(key)||grid.set(key,[]).get(key)).push(i)});
  const angDiff=(a,b)=>{let d=Math.abs(a-b)%Math.PI;return Math.min(d,Math.PI-d)};
  const pairs=[];
  arms.forEach((A,i)=>{
    const cx=Math.floor(A.m[0]/cell),cy=Math.floor(A.m[1]/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const l=grid.get((cx+dx)+','+(cy+dy));if(!l)continue;
      for(const j of l){if(j<=i)continue;const B=arms[j];
        if(angDiff(A.ang,B.ang)>12*Math.PI/180)continue;
        let best=null;for(const ea of [A.p,A.q])for(const eb of [B.p,B.q]){const d=Math.hypot(ea[0]-eb[0],ea[1]-eb[1]);if(!best||d<best.d)best={d,ea,eb}}
        const gap=best.d/pxs;if(gap<2||gap>45)continue;
        const ux=Math.cos(A.ang),uy=Math.sin(A.ang),vx=best.eb[0]-best.ea[0],vy=best.eb[1]-best.ea[1];
        const along=Math.abs(vx*ux+vy*uy)/Math.max(1e-9,best.d);if(along<0.9)continue;
        pairs.push({i,j,m:[(best.ea[0]+best.eb[0])/2,(best.ea[1]+best.eb[1])/2],ang:A.ang});
      }}
  });
  const drop=new Set();let n=0;
  for(let a=0;a<pairs.length;a++)for(let b=a+1;b<pairs.length;b++){
    const P=pairs[a],Q=pairs[b];
    if(Math.hypot(P.m[0]-Q.m[0],P.m[1]-Q.m[1])>12*pxs)continue;
    const d=angDiff(P.ang,Q.ang);if(Math.abs(d-Math.PI/2)>25*Math.PI/180)continue;
    const ids=new Set([P.i,P.j,Q.i,Q.j]);if(ids.size!==4)continue;
    if([...ids].some(x=>drop.has(arms[x].k)))continue;
    ids.forEach(x=>drop.add(arms[x].k));n++;
  }
  // varian tiga goresan: satu pasangan segaris ditambah satu goresan tegak lurus di dekat titik tengahnya
  for(const P of pairs){
    if(drop.has(arms[P.i].k)||drop.has(arms[P.j].k))continue;
    let pick=-1,bd=1e9;
    arms.forEach((C,c)=>{
      if(c===P.i||c===P.j||drop.has(C.k))return;
      if(Math.abs(angDiff(P.ang,C.ang)-Math.PI/2)>25*Math.PI/180)return;
      const d=Math.min(Math.hypot(C.p[0]-P.m[0],C.p[1]-P.m[1]),Math.hypot(C.q[0]-P.m[0],C.q[1]-P.m[1]));
      if(d<=22*pxs&&d<bd){bd=d;pick=c}
    });
    if(pick>=0){drop.add(arms[P.i].k);drop.add(arms[P.j].k);drop.add(arms[pick].k);n++}
  }
  G.edges=edges.filter((_,k)=>!drop.has(k));
  return n;
}
// Metrik kelengkungan polyline: total belok (derajat), belok terbesar, dan jumlah
// belokan tajam (>= 25 derajat). Kurva sungai/jalan = banyak belokan kecil;
// sudut bidang = satu belokan besar.
function ppCurveMetrics(pts){
  let turn=0,maxTurn=0,bigTurns=0;
  for(let i=1;i<pts.length-1;i++){
    const a=pts[i-1],b=pts[i],c=pts[i+1];
    const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
    const lu=Math.hypot(ux,uy),lv=Math.hypot(vx,vy);
    if(lu<1e-9||lv<1e-9)continue;
    const t=Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(lu*lv))))*180/Math.PI;
    turn+=t;if(t>maxTurn)maxTurn=t;if(t>=25)bigTurns++;
  }
  return {turn,maxTurn,bigTurns};
}
// Penghalusan ringan (rata-rata berbobot 1-2-1); ujung tidak digeser.
function ppSmoothLine(pts,passes){
  let P=pts.map(p=>[p[0],p[1]]);
  for(let k=0;k<(passes|0);k++){
    if(P.length<3)break;
    const Q=P.map(p=>[p[0],p[1]]);
    for(let i=1;i<P.length-1;i++){
      Q[i][0]=(P[i-1][0]+2*P[i][0]+P[i+1][0])/4;
      Q[i][1]=(P[i-1][1]+2*P[i][1]+P[i+1][1])/4;
    }
    P=Q;
  }
  return P;
}
// Pasang garis lurus pada tiap ruas (Douglas-Peucker), lalu hitung ulang sudut dan simpang dari
// perpotongan garis-garis itu. Hasilnya tidak menggeser sudut ke dalam seperti kerangka mentah.
// Ruas yang terdeteksi LENGKUNG (total belok tinggi tanpa belokan tajam) tidak dipaksa lurus:
// titik Douglas-Peucker dipertahankan (dengan epsilon lebih longgar) lalu dihaluskan ringan.
function ppRefineGraph(G,eps,opt){
  const o=Object.assign({curveTurn:35,curveSmooth:1,curveEpsScale:1.8},opt||{});
  const {nodes,edges}=G,pos=nodes.map(n=>[n.x,n.y]),ends=nodes.map(()=>[]);
  for(const e of edges){
    const P=e.pts;
    // Kelengkungan diukur pada polyline yang sudah diringkas Douglas-Peucker (eps 2 px):
    // kerangka piksel mentah punya "tangga" yang membuat sudut lokal tampak tajam.
    const coarse=ppDP(P,2).map(k=>P[k]);
    const met=ppCurveMetrics(coarse);
    e.curve=P.length>=5&&met.turn>=o.curveTurn&&met.bigTurns===0;
    e.metrics=met;
    const eEps=e.curve?Math.max(eps,eps*o.curveEpsScale):eps;
    const idx=ppDP(P,eEps);e.idx=idx;e.fits=[];
    if(e.curve)continue;   // ruas lengkung: jangan dipasangi garis lurus
    for(let k=0;k<idx.length-1;k++)e.fits.push(ppFit(P,idx[k],idx[k+1]));
    ends[e.a].push(e.fits[0]);ends[e.b].push(e.fits[e.fits.length-1]);
  }
  nodes.forEach((n,i)=>{
    const L=ends[i].filter(f=>f.len>=8);
    if(L.length>=2){const x=ppNodeLSQ(L);if(x&&Math.hypot(x[0]-n.x,x[1]-n.y)<=5)pos[i]=x}
    else if(L.length===1&&ends[i].length===1){
      const f=L[0],t=(n.x-f.cx)*f.ux+(n.y-f.cy)*f.uy,x=f.cx+t*f.ux,y=f.cy+t*f.uy;
      if(Math.hypot(x-n.x,y-n.y)<=3)pos[i]=[x,y];
    }
  });
  for(const e of edges){
    const P=e.pts,v=[pos[e.a]];
    if(e.curve){
      const mid=e.idx.slice(1,-1).map(k=>P[k]);
      for(const p of ppSmoothLine(mid,o.curveSmooth))v.push(p);
      v.push(pos[e.b]);e.v=v;continue;
    }
    for(let k=1;k<e.idx.length-1;k++){
      const A=e.fits[k-1],B=e.fits[k],o2=P[e.idx[k]];let q=o2;
      if(A.len>=6&&B.len>=6){const X=ppInter(A,B);if(X&&X.s>=0.12&&Math.hypot(X.x-o2[0],X.y-o2[1])<=4)q=[X.x,X.y]}
      v.push(q);
    }
    v.push(pos[e.b]);e.v=v;
  }
  return edges;
}
// Tutup celah berdasarkan ARAH garis (bukan sekadar jarak):
//  - ujung bertemu ujung yang saling menghadap: dijembatani lurus,
//  - celah LEBIH LEBAR hanya ditutup bila kedua ujung hampir segaris (angTight),
//    aman untuk garis scan yang terputus,
//  - dua ujung yang garisnya berpotongan di depan: disatukan di titik sudut,
//  - ujung yang menembak ke tengah garis lain: ditarik sampai menempel (T-junction).
function plotPetaCloseGaps(segs,o){
  const snap=o.snap??0.6,linkMax=o.linkMax,cosT=Math.cos((o.angMax??40)*Math.PI/180);
  // Parameter baru (default = perilaku lama + jangkauan tambahan yang aman):
  //  angTight  : toleransi sudut untuk celah lebar (derajat, default 12)
  //  longFactor: pengali linkMax untuk celah lebar yang hampir segaris (default 1.6)
  const cosTight=Math.cos((o.angTight??12)*Math.PI/180),longFactor=Math.max(1,o.longFactor??1.6);
  const nodes=[],grid=new Map(),cell=Math.max(snap*2,1);
  const nodeOf=(x,y)=>{
    const cx=Math.floor(x/cell),cy=Math.floor(y/cell);let best=-1,bd=snap;
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const l=grid.get((cx+a)+','+(cy+b));if(l)for(const id of l){const d=Math.hypot(nodes[id].x-x,nodes[id].y-y);if(d<=bd){bd=d;best=id}}}
    if(best>=0)return best;
    nodes.push({x,y,adj:[]});const k=cx+','+cy;(grid.get(k)||grid.set(k,[]).get(k)).push(nodes.length-1);return nodes.length-1;
  };
  const E=[];
  for(const s of segs){const a=nodeOf(s[0][0],s[0][1]),b=nodeOf(s[1][0],s[1][1]);if(a===b)continue;E.push({a,b});nodes[a].adj.push(E.length-1);nodes[b].adj.push(E.length-1)}
  if(!(linkMax>0)||!E.length)return {segs:E.map(e=>[[nodes[e.a].x,nodes[e.a].y],[nodes[e.b].x,nodes[e.b].y]]),stats:{join:0,corner:0,tee:0,jauh:0}};
  const other=(e,n)=>E[e].a===n?E[e].b:E[e].a;
  // rantai: telusuri lewat simpul berderajat 2 untuk mendapat id rantai, panjang, dan arah di ujung bebas
  const chain=new Int32Array(E.length).fill(-1),chains=[];
  for(let k=0;k<E.length;k++){
    if(chain[k]>=0)continue;const id=chains.length,st=[k];let len=0;chain[k]=id;
    while(st.length){const e=st.pop();len+=Math.hypot(nodes[E[e].a].x-nodes[E[e].b].x,nodes[E[e].a].y-nodes[E[e].b].y);
      for(const n of [E[e].a,E[e].b])if(nodes[n].adj.length===2)for(const f of nodes[n].adj)if(chain[f]<0){chain[f]=id;st.push(f)}}
    chains.push({len});
  }
  const free=[];nodes.forEach((n,i)=>{if(n.adj.length===1)free.push(i)});
  const dirOf=n=>{
    let cur=n,e=nodes[n].adj[0],far=[nodes[n].x,nodes[n].y],len=0,pv=null;const Lb=Math.max(40,linkMax*0.5);
    while(true){
      const m=other(e,cur),p=[nodes[m].x,nodes[m].y],v=[p[0]-far[0],p[1]-far[1]],vl=Math.hypot(v[0],v[1]);
      if(pv&&vl>1e-9&&(v[0]*pv[0]+v[1]*pv[1])/(vl*Math.hypot(pv[0],pv[1]))<Math.cos(25*Math.PI/180))break;
      if(vl>1e-9)pv=v;len+=vl;far=p;
      if(len>=Lb||nodes[m].adj.length!==2)break;
      const nx=nodes[m].adj.find(x=>x!==e);cur=m;e=nx;
    }
    const dx=nodes[n].x-far[0],dy=nodes[n].y-far[1],L=Math.hypot(dx,dy);
    return L<1e-9?null:[dx/L,dy/L];
  };
  const info=new Map();for(const n of free){const u=dirOf(n);if(u)info.set(n,{u,ch:chain[nodes[n].adj[0]]})}
  const cands=[];
  const fl=[...info.keys()];
  for(let i=0;i<fl.length;i++)for(let j=i+1;j<fl.length;j++){
    const a=fl[i],b=fl[j],A=info.get(a),B=info.get(b),vx=nodes[b].x-nodes[a].x,vy=nodes[b].y-nodes[a].y,d=Math.hypot(vx,vy);
    if(d>linkMax*Math.max(1.6,longFactor))continue;
    if(A.ch===B.ch&&chains[A.ch].len<4*Math.max(d,1))continue;
    const cA=d>1e-9?(A.u[0]*vx+A.u[1]*vy)/d:1,cB=d>1e-9?-(B.u[0]*vx+B.u[1]*vy)/d:1;
    if(d<=linkMax&&cA>=cosT&&cB>=cosT){cands.push({cost:d*(1+(1-cA)+(1-cB)),t:'join',a,b});continue}
    // Celah lebar: hanya bila kedua ujung hampir segaris (bukti arah kuat),
    // sehingga garis yang tidak berhubungan tidak ikut tersambung.
    if(d<=linkMax*longFactor&&cA>=cosTight&&cB>=cosTight){
      cands.push({cost:d*2.4+(1-cA)*40+(1-cB)*40,t:'join',a,b,jauh:true});continue;
    }
    const den=A.u[0]*B.u[1]-A.u[1]*B.u[0];
    if(Math.abs(den)<0.34)continue;
    const ta=((nodes[b].x-nodes[a].x)*B.u[1]-(nodes[b].y-nodes[a].y)*B.u[0])/den;
    const tb=((nodes[b].x-nodes[a].x)*A.u[1]-(nodes[b].y-nodes[a].y)*A.u[0])/den;
    if(ta<-2||tb<-2||ta>linkMax||tb>linkMax)continue;
    cands.push({cost:(Math.max(ta,0)+Math.max(tb,0))*1.05,t:'corner',a,b,X:[nodes[a].x+ta*A.u[0],nodes[a].y+ta*A.u[1]]});
  }
  for(const a of fl){
    const A=info.get(a),ax=nodes[a].x,ay=nodes[a].y;let best=null;
    for(let k=0;k<E.length;k++){
      if(chain[k]===A.ch)continue;
      const p=nodes[E[k].a],q=nodes[E[k].b],dx=q.x-p.x,dy=q.y-p.y,L=Math.hypot(dx,dy);if(L<1e-9)continue;
      const den=A.u[0]*dy-A.u[1]*dx;if(Math.abs(den)/L<0.26)continue;
      const t=((p.x-ax)*dy-(p.y-ay)*dx)/den,s=((p.x-ax)*A.u[1]-(p.y-ay)*A.u[0])/den;
      if(t<-1||t>linkMax)continue;
      const eps=2/L;if(s<-eps||s>1+eps)continue;
      if(!best||t<best.t)best={t,s:Math.max(0,Math.min(1,s)),k};
    }
    if(best)cands.push({cost:Math.max(best.t,0)*1.12,t:'tee',a,k:best.k,s:best.s,X:[ax+best.t*A.u[0],ay+best.t*A.u[1]]});
  }
  cands.sort((x,y)=>x.cost-y.cost);
  const used=new Set(),out=[],splits=new Map(),st={join:0,corner:0,tee:0,jauh:0};
  const P=n=>[nodes[n].x,nodes[n].y];
  for(const c of cands){
    if(used.has(c.a)||(c.b!==undefined&&used.has(c.b)))continue;
    used.add(c.a);if(c.b!==undefined)used.add(c.b);st[c.t]++;if(c.jauh)st.jauh++;
    if(c.t==='join')out.push([P(c.a),P(c.b)]);
    else if(c.t==='corner'){out.push([P(c.a),c.X.slice()]);out.push([P(c.b),c.X.slice()])}
    else{out.push([P(c.a),c.X.slice()]);(splits.get(c.k)||splits.set(c.k,[]).get(c.k)).push({s:c.s,X:c.X.slice()})}
  }
  const res=[];
  E.forEach((e,k)=>{
    const a=P(e.a),b=P(e.b),sp=splits.get(k);
    if(!sp){res.push([a,b]);return}
    sp.sort((x,y)=>x.s-y.s);let prev=a;
    for(const q of sp){if(Math.hypot(q.X[0]-prev[0],q.X[1]-prev[1])>1e-6)res.push([prev,q.X]);prev=q.X}
    res.push([prev,b]);
  });
  return {segs:res.concat(out),stats:st};
}
// Pelacak batas: kembalikan jalur bernomor seperti detect(), siap diperiksa dan diterima.
function detectTrace(R,opt){
  opt=opt||{};
  const minLen=opt.minLen??120,linkMax=opt.linkMax??120;
  const sc=Math.min(1,(opt.maxSide||2600)/Math.max(R.w,R.h));
  const {bin,w,h}=opt.ridge===false?ppBinarize(R,sc):ppBinarizeRidge(R,sc,opt.sigma,opt.rel);
  const sx=w/R.w,sy=h/R.h,pxs=Math.sqrt(sx*sy);
  ppDropSmall(bin,w,h,Math.max(10,0.4*minLen*pxs));
  ppThin(bin,w,h);
  let G=ppSkeletonGraph(bin,w,h);
  const overMax=Math.max(10,Math.min(30,0.15*minLen));
  G=ppCleanGraph(G,overMax*pxs,0.35*minLen*pxs);
  // Statistik jaringan (median panjang ruas, porsi ruas pendek) untuk ambang adaptif.
  const stat=ppEdgeStats(G.edges,pxs,(w/sx)*(h/sy));
  let nPlus=0,nText=0,nDash=0;
  if(opt.textFilter!==false){
    const textCfg=ppTextCfg(stat,opt);
    const kept=ppTextFilter(G.edges,pxs,textCfg);
    if(kept.stats){nText=kept.stats.teksDibuang||0;nDash=kept.stats.garisPutus||0}
    G.edges=kept;G=ppCleanGraph(G,overMax*pxs,0.35*minLen*pxs);
  }
  if(opt.plusFilter!==false){nPlus=ppDropPlusMarks(G,pxs)+ppDropOpenPlus(G,pxs);G=ppCleanGraph(G,overMax*pxs,0.35*minLen*pxs)}
  const edges=ppRefineGraph(G,1.2,opt.curve);
  let nCurve=0;for(const e of edges)if(e.curve)nCurve++;
  const segs=[];
  for(const e of edges)for(let i=0;i<e.v.length-1;i++){
    const a=[R.x+e.v[i][0]/sx,R.y+e.v[i][1]/sy],b=[R.x+e.v[i+1][0]/sx,R.y+e.v[i+1][1]/sy];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])>1e-6)segs.push([a,b]);
  }
  // linkMax adaptif: peta besar/beresolusi tinggi punya celah scan lebih lebar (px asli).
  // Batas atas dijaga (180 px) supaya area seleksi kecil tidak jadi terlalu agresif.
  const linkEff=Math.max(linkMax,Math.min(0.02*Math.max(R.w,R.h),180));
  const closed=plotPetaCloseGaps(segs,{
    linkMax:linkEff,snap:0.6,
    angTight:opt.angTight??12,
    longFactor:opt.longFactor??1.6
  });
  const attachTol=Math.max(3,+($('pTol')?$('pTol').value:8)||8);
  let chains=plotPetaBuildChains(closed.segs,0.8,attachTol);
  if(opt.isoFilter!==false){const IW=img.width,IH=img.height,minIso=Math.max(0.35*minLen,0.016*Math.max(IW,IH));
    chains=chains.filter(c=>{if(c.closed||!c.free||!c.free[0]||!c.free[1])return true;let L=0;for(let i=1;i<c.pts.length;i++)L+=Math.hypot(c.pts[i][0]-c.pts[i-1][0],c.pts[i][1]-c.pts[i-1][1]);return L>=minIso})}
  chains=chains.filter(c=>{let L=0;for(let i=1;i<c.pts.length;i++)L+=Math.hypot(c.pts[i][0]-c.pts[i-1][0],c.pts[i][1]-c.pts[i-1][1]);return c.closed||L>=Math.max(12,0.35*minLen)});
  plotPetaNumberEnds(chains);
  chains.stats=Object.assign({},closed.stats,{
    abaikanSilang:nPlus,
    teksDibuang:nText,
    garisPutus:nDash,
    ruasLengkung:nCurve,
    linkMax:Math.round(linkEff),
    medianRuas:Math.round(stat.medLen)
  });
  return chains;
}
// ==== PLOTPETA ENGINE END ====
