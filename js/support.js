// PlotPeta: Pengumuman berjalan dan chat bantuan
(function(){
 const el=id=>document.getElementById(id); let notices=[], chatRows=[];
 // Tempatkan running text sebagai strip pertama di halaman, di atas header aplikasi.
 const ticker=el('ppNoticeBar'); if(ticker && document.body.firstElementChild!==ticker) document.body.insertBefore(ticker, document.body.firstElementChild);
 const headerTicker=el('ppNoticeBar'); if(headerTicker&&document.body&&document.body.firstElementChild!==headerTicker){document.body.insertBefore(headerTicker,document.body.firstElementChild);}
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function renderNotices(){
   const box=el('ppHelpNotices');
   if(box) box.innerHTML=notices.length?notices.map(n=>`<div class="ppmsg"><b>${safe(n.title)}</b><div style="white-space:pre-wrap;margin-top:4px">${safe(n.body)}</div><small style="color:var(--text-muted)">${new Date(n.created_at).toLocaleString('id-ID')}</small></div>`).join(''):'<div style="color:var(--text-muted)">Belum ada pengumuman.</div>';
   const track=el('ppTickerTrack');
   if(track){const items=notices.map(n=>`<span class="ppTickerItem"><strong>${safe(n.title)}:</strong> ${safe(n.body).replace(/\n/g,' ')}</span>`).join('');track.innerHTML=items?items+items:'<span>Belum ada pengumuman terbaru.</span>';track.style.animationDuration=Math.max(18,notices.reduce((sum,n)=>sum+(String(n.title||'').length+String(n.body||'').length)*0.12,0))+'s';}
   const bar=el('ppNoticeBar');
   if(bar) bar.style.display=notices.length?'flex':'none';
 }
 async function loadNotices(){if(!window.sb && !sb)return;const client=window.sb||sb;const {data,error}=await client.from('announcements').select('id,title,body,created_at').eq('is_published',true).order('created_at',{ascending:false}).limit(10);if(!error){notices=data||[];renderNotices();}}
 async function loadChat(){
   const client=window.sb||sb;
   const status=el('ppChatStatus');
   if(!client||!window.currentUser && !currentUser){if(status)status.textContent='Silakan masuk dengan Google untuk mengirim pesan.';return;}
   const user=window.currentUser||currentUser;
   const {data,error}=await client.from('support_messages').select('id,user_id,sender_role,message,created_at').eq('user_id',user.id).order('created_at',{ascending:true}).limit(200);
   if(error){if(status)status.textContent='Chat belum siap. Pastikan SQL pengumuman dan chat sudah dijalankan.';return;}
   chatRows=data||[];
   const messages=el('ppChatMessages');
   if(messages){messages.innerHTML=chatRows.map(m=>`<div class="ppmsg ${m.sender_role==='user'?'mine':'admin-reply'}"><b>${m.sender_role==='admin'?'Admin PlotPeta':'Anda'}</b><div style="white-space:pre-wrap;margin-top:4px">${safe(m.message)}</div><small style="color:var(--text-muted)">${new Date(m.created_at).toLocaleString('id-ID')}</small></div>`).join('')||'<div style="color:var(--text-muted)">Belum ada pesan. Silakan tulis pesan di bawah.</div>';messages.scrollTop=messages.scrollHeight;}
   if(status)status.textContent='Pesan hanya dapat dilihat oleh Anda dan admin.';
 }
 const helpFab=el('btnHelpZoom')||el('ppHelpFab')||el('btnHelpHeader'),helpPanel=el('ppHelpPanel'),helpClose=el('ppHelpClose');
 function setHelpOpen(open){
   if(helpPanel){helpPanel.style.display=open?'block':'none';helpPanel.setAttribute('aria-hidden',open?'false':'true');}
   if(helpFab)helpFab.setAttribute('aria-expanded',open?'true':'false');
   if(open){if(helpClose)helpClose.focus();loadNotices();loadChat();}
   else if(helpFab)helpFab.focus();
 }
 if(helpFab){helpFab.setAttribute('aria-controls','ppHelpPanel');helpFab.setAttribute('aria-expanded','false');}
 window.setHelpOpen=setHelpOpen;
 if(helpClose)helpClose.onclick=()=>setHelpOpen(false);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&helpPanel&&helpPanel.style.display==='block'){event.preventDefault();setHelpOpen(false);}});

 // Dropdown bantuan terpusat: tombol ? di zoom controls.
 const helpMenu=el('helpMenu'),helpBtn=el('btnHelpZoom');
 function closeHelpMenu(){if(!helpMenu)return;helpMenu.hidden=true;if(helpBtn)helpBtn.setAttribute('aria-expanded','false');}
 function positionHelpMenu(){
   if(!helpMenu||!helpBtn)return;
   const r=helpBtn.getBoundingClientRect();
   const mw=helpMenu.offsetWidth||250, mh=helpMenu.offsetHeight||240;
   let left=r.right-mw;
   let top=r.top-mh-8;
   if(left<8)left=8;
   if(left+mw>innerWidth-8)left=innerWidth-mw-8;
   if(top<8)top=Math.min(r.bottom+8,innerHeight-mh-8);
   if(top<8)top=8;
   helpMenu.style.left=Math.max(8,left)+'px';
   helpMenu.style.top=Math.max(8,top)+'px';
   helpMenu.style.right='auto';
   helpMenu.style.bottom='auto';
 }
 function toggleHelpMenu(){
   if(!helpMenu)return;
   if(helpMenu.hidden){helpMenu.hidden=false;positionHelpMenu();if(helpBtn)helpBtn.setAttribute('aria-expanded','true');}
   else closeHelpMenu();
 }
 if(helpBtn&&helpMenu){
   helpBtn.onclick=e=>{e.stopPropagation();toggleHelpMenu();};
   helpMenu.addEventListener('click',e=>{
     const item=e.target.closest('[data-help]');
     if(!item)return;
     const key=item.dataset.help;
     closeHelpMenu();
     if(key==='support'){setHelpOpen(true);return;}
     if(typeof window.ppShowInfo==='function')window.ppShowInfo(key);
   });
   document.addEventListener('click',e=>{
     if(helpMenu.hidden)return;
     if(e.target.closest('#helpMenu')||e.target.closest('#btnHelpZoom'))return;
     closeHelpMenu();
   });
   document.addEventListener('keydown',e=>{
     if(e.key==='Escape'&&!helpMenu.hidden){e.preventDefault();closeHelpMenu();helpBtn.focus();}
   });
   addEventListener('resize',()=>{if(!helpMenu.hidden)positionHelpMenu();});
   addEventListener('scroll',()=>{if(!helpMenu.hidden)positionHelpMenu();},true);
 }
 function startChatCooldown(sec){const b=el('ppChatSend');if(!b)return;if(!b.dataset.label)b.dataset.label=b.textContent;const label=b.dataset.label;let left=sec;b.disabled=true;b.textContent=label+' ('+left+')';const t=setInterval(()=>{left--;if(left<=0){clearInterval(t);b.disabled=false;b.textContent=label;}else b.textContent=label+' ('+left+')';},1000);}
 const chatInput=el('ppChatInput'),chatSend=el('ppChatSend');
 if(chatInput)chatInput.maxLength=1000;
 if(chatSend)chatSend.onclick=async()=>{const client=window.sb||sb;const user=window.currentUser||currentUser;const message=chatInput.value.trim();if(!user){const s=el('ppChatStatus');if(s)s.textContent='Silakan masuk dengan Google terlebih dahulu.';return;}if(!message)return;chatSend.disabled=true;const {error}=await client.from('support_messages').insert({user_id:user.id,sender_role:'user',message});if(error){const wait=/Tunggu (\d+) detik/.exec(error.message||'');const s=el('ppChatStatus');if(s)s.textContent=(error.code==='P0001'&&error.message)?error.message:'Pesan gagal dikirim. Periksa koneksi lalu coba lagi.';if(wait)startChatCooldown(+wait[1]);else chatSend.disabled=false;return;}chatInput.value='';await loadChat();startChatCooldown(20);};
 // Variabel sb/currentUser dideklarasikan pada script utama; pemanggilan aman setelah DOM tersedia.
 setTimeout(loadNotices,1200);if(window.sb){window.sb.auth.onAuthStateChange(()=>setTimeout(loadChat,500));}
})();
