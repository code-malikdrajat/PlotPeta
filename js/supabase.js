// PlotPeta: Akun, token, cloud, top-up, riwayat token, ekspor DXF (Supabase)

// ====================================================================
// ==================== SUPABASE SAAS INTEGRATION =====================
// ====================================================================
const SUPABASE_URL = 'https://fqkqoqphqosacatqnwqj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UwScoKPnmBFGgPy-A2nNag_JSeT1caZ';
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let currentUser = null;
let currentProfile = null;
let currentTokenBalance = 0;
let currentUniqueCode = Math.floor(100 + Math.random() * 899);
let currentPaketHarga = 100000; // diganti dari server (get_harga_paket); 100000 hanya cadangan jika gagal dimuat

// Auth Modal
function openAuthModal(tab = 'login'){
  $('modalAuth').classList.add('open');
  $('authAlert').className = 'form-alert';
  $('authAlert').textContent = '';
  $('authAlert').style.display = 'block';
  $('authModalTitle').textContent = 'Lanjutkan ke PlotPeta';
}
function closeAuthModal(){ $('modalAuth').classList.remove('open'); }
$('btnOpenAuth').onclick = () => openAuthModal('login');

// Google Sign-In Integration
const GOOGLE_CLIENT_ID = '224656203331-upgvdvulha36kqo2n2dmpbuk4dd3tisl.apps.googleusercontent.com';

async function signInWithGoogle(){
  $('authAlert').className = 'form-alert';
  $('authAlert').style.display = 'none';
  if(!$('authConsent') || !$('authConsent').checked){
    $('authAlert').className = 'form-alert error';
    $('authAlert').textContent = 'Centang persetujuan Syarat & Ketentuan dan Kebijakan Privasi terlebih dahulu.';
    $('authAlert').style.display = 'block';
    return;
  }

  try {
    // 1. Coba OAuth redirect Supabase
    const redirectUrl = window.location.origin + window.location.pathname;
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          client_id: GOOGLE_CLIENT_ID,
          prompt: 'select_account'
        }
      }
    });

    if(error){
      console.warn('OAuth redirect failed, attempting Google One Tap:', error);
      triggerGoogleIdentity();
    }
  } catch(err){
    console.warn('OAuth exception, attempting Google One Tap:', err);
    triggerGoogleIdentity();
  }
}

function triggerGoogleIdentity(){
  if(window.google && window.google.accounts && window.google.accounts.id){
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      auto_select: false
    });
    google.accounts.id.prompt((notification) => {
      if(notification.isNotDisplayed() || notification.isSkippedMoment()){
        alert('Untuk login Google: pastikan provider Google telah diaktifkan di Supabase Dashboard (Authentication -> Providers -> Google) dengan Client ID ini.');
      }
    });
  } else {
    alert('Google Sign-In sedang dimuat. Silakan coba kembali dalam beberapa detik.');
  }
}

async function handleGoogleCredentialResponse(response){
  if(!response || !response.credential) return;
  $('authAlert').className = 'form-alert success';
  $('authAlert').textContent = 'Memverifikasi akun Google...';
  $('authAlert').style.display = 'block';

  const { data, error } = await sb.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential,
    client_id: GOOGLE_CLIENT_ID
  });

  if(error){
    $('authAlert').className = 'form-alert error';
    $('authAlert').textContent = 'Gagal masuk dengan Google: ' + error.message;
    $('authAlert').style.display = 'block';
  } else {
    closeAuthModal();
  }
}

// User Dropdown toggle
$('userMenuBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('userMenuWrap').classList.toggle('open');
  $('userMenuBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', () => {
  $('userMenuWrap').classList.remove('open');
  $('userMenuBtn').setAttribute('aria-expanded', 'false');
});

async function logout(){
  try{ if(window.__ppClear) await window.__ppClear(); }catch(_){}
  await sb.auth.signOut();
  window.location.reload();
}

// ==================== HAPUS AKUN ====================
function openDeleteAccountModal(){
  if(!currentUser) return;
  $('delAccTokens').textContent = currentTokenBalance;
  $('delAccConfirm').value = '';
  $('delAccAlert').className = 'form-alert';
  $('delAccAlert').textContent = '';
  $('btnDelAccount').disabled = true;
  $('modalDeleteAcc').classList.add('open');
}
$('delAccConfirm').addEventListener('input', e => {
  $('btnDelAccount').disabled = e.target.value.trim().toUpperCase() !== 'HAPUS';
});
async function deleteMyAccount(){
  if(!currentUser || $('delAccConfirm').value.trim().toUpperCase() !== 'HAPUS') return;
  const btn = $('btnDelAccount');
  btn.disabled = true; btn.textContent = 'Menghapus...';
  $('delAccAlert').className = 'form-alert'; $('delAccAlert').textContent = '';
  let errMsg = '';
  try{
    const { data, error } = await sb.functions.invoke('delete-account', { body: { confirm: 'HAPUS' } });
    if(error){
      errMsg = error.message;
      const ctx = error.context;
      if(ctx && typeof ctx.json === 'function'){
        try{ const j = await ctx.json(); if(j && j.message) errMsg = j.message; }catch(_){}
      }
    } else if(!data || !data.ok){
      errMsg = (data && data.message) || 'Penghapusan gagal. Coba lagi.';
    }
  }catch(e){ errMsg = e.message; }
  btn.textContent = 'Hapus akun saya';
  if(errMsg){
    btn.disabled = false;
    $('delAccAlert').className = 'form-alert error';
    $('delAccAlert').textContent = errMsg;
    return;
  }
  try{ if(window.__ppClear) await window.__ppClear(); }catch(_){}
  try{ await sb.auth.signOut({ scope: 'local' }); }catch(_){}
  alert('Akun dan data Anda telah dihapus dari PlotPeta.');
  window.location.reload();
}

// Update User UI State
async function updateAuthState(session){
  if(session && session.user){
    currentUser = session.user;
    $('btnOpenAuth').style.display = 'none';
    $('tokenPill').style.display = 'inline-flex';
    $('btnCloudProjects').style.display = 'inline-flex';
    $('userMenuWrap').style.display = 'inline-block';

    // Ambil profil (galat di sini tidak boleh menghentikan pengambilan saldo token)
    try{
      const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
      currentProfile = profile;
      const displayName = profile?.nama || currentUser.email.split('@')[0];
      $('userName').textContent = displayName;
      $('userEmail').textContent = currentUser.email;
      $('userAvatar').textContent = displayName.charAt(0).toUpperCase();
      const adminEl = $('adminLink');
      if(adminEl) adminEl.style.display = profile?.is_admin ? 'flex' : 'none';
    }catch(e){
      console.warn('Gagal memuat profil:', e);
    }

    await fetchUserTokens();
  } else {
    currentUser = null;
    currentProfile = null;
    $('btnOpenAuth').style.display = 'inline-flex';
    $('tokenPill').style.display = 'none';
    $('btnCloudProjects').style.display = 'none';
    $('userMenuWrap').style.display = 'none';
  }
}

// Fetch Token Balance
async function fetchUserTokens(tries){
  if(!currentUser) return;
  tries = tries || 0;
  let data = null, error = null;
  try{
    const r = await sb.rpc('get_user_tokens', { p_user_id: currentUser.id });
    data = r.data; error = r.error;
  }catch(e){ error = e; }
  if(error || !data){
    console.warn('get_user_tokens gagal (percobaan ' + (tries + 1) + '):', error);
    if(tries < 3){
      await new Promise(r => setTimeout(r, 800 * (tries + 1)));
      return fetchUserTokens(tries + 1);
    }
    $('tokenCount').textContent = '?';
    $('tokenPill').title = 'Gagal memuat saldo token. Muat ulang halaman.';
    return;
  }
  currentTokenBalance = data.balance || 0;
  $('tokenCount').textContent = currentTokenBalance;
  if(data.earliest_expiry){
    const expDate = new Date(data.earliest_expiry).toLocaleDateString('id-ID', { day:'numeric', month:'short' });
    $('tokenPill').title = `${currentTokenBalance} token aktif (berlaku s.d. ${expDate})`;
  } else {
    $('tokenPill').title = `${currentTokenBalance} token aktif`;
  }
}

// ==================== CLOUD PROJECTS MODAL ====================
$('btnCloudProjects').onclick = () => {
  $('modalCloud').classList.add('open');
  switchCloudTab('list');
  loadCloudProjects();
};

function switchCloudTab(tab){
  $('tabBtnCloudList').classList.toggle('active', tab === 'list');
  $('tabBtnCloudSave').classList.toggle('active', tab === 'save');
  $('tabCloudList').style.display = tab === 'list' ? 'block' : 'none';
  $('tabCloudSave').style.display = tab === 'save' ? 'block' : 'none';
}

async function loadCloudProjects(){
  if(!currentUser) return;
  const listEl = $('cloudProjectsList');
  listEl.innerHTML = '<div class="mu" style="text-align:center;padding:20px">Memuat data proyek cloud...</div>';

  const { data: projects, error } = await sb.from('projects')
    .select('id, nama, ukuran, updated_at')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if(error || !projects || projects.length === 0){
    listEl.innerHTML = '<div class="mu" style="text-align:center;padding:24px">Belum ada proyek yang disimpan di cloud.</div>';
    $('cloudProjectCount').textContent = '0 / 20 proyek digunakan';
    return;
  }

  $('cloudProjectCount').textContent = `${projects.length} / 20 proyek digunakan`;
  listEl.innerHTML = projects.map(p => {
    const fDate = new Date(p.updated_at).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const szKb = Math.round((p.ukuran || 0) / 1024);
    return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nama)}</div>
          <div class="mu" style="font-size:11px;margin-top:2px">${fDate} &bull; ${szKb} KB</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn pri" style="padding:4px 8px;font-size:11px" data-cact="open" data-id="${esc(p.id)}">Buka</button>
          <button class="btn danger" style="padding:4px 8px;font-size:11px" data-cact="del" data-id="${esc(p.id)}" data-nama="${esc(p.nama)}">Hapus</button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveCurrentToCloud(){
  if(!currentUser) return;
  const name = $('cloudSaveName').value.trim();
  if(!name){ alert('Masukkan nama proyek terlebih dahulu.'); return; }

  const o = {
    v: 1,
    size: [iw, ih],
    coordinateMode: cal.mode,
    cal: cal.pts.map((p,i)=>({ p, x: $('cx'+i).value, y: $('cy'+i).value })),
    lines,
    texts,
    polys,
    th: $('th').value,
    ly: ['lP','lD','lSu','lM','lPoly'].map(i => $(i).value)
  };
  const jsonStr = JSON.stringify(o);
  const szBytes = new TextEncoder().encode(jsonStr).length;

  if(szBytes > 5 * 1024 * 1024){
    alert('Ukuran data proyek melebihi batas 5 MB.');
    return;
  }

  $('btnSaveToCloud').disabled = true;
  $('btnSaveToCloud').textContent = 'Menyimpan...';

  const { error } = await sb.from('projects').insert({
    user_id: currentUser.id,
    nama: name,
    data: o,
    ukuran: szBytes
  });

  $('btnSaveToCloud').disabled = false;
  $('btnSaveToCloud').textContent = 'Simpan ke Cloud';

  if(error){
    alert('Gagal menyimpan: ' + error.message);
  } else {
    alert('Proyek berhasil disimpan ke cloud!');
    dirty = false;
    if(window.__ppSaved) await window.__ppSaved();
    $('cloudSaveName').value = '';
    switchCloudTab('list');
    loadCloudProjects();
  }
}

async function openCloudProject(id){
  const { data: p, error } = await sb.from('projects').select('*').eq('id', id).single();
  if(error || !p){ alert('Gagal memuat proyek dari cloud'); return; }

  const o = p.data || {};
  lines = o.lines || []; erasePick = null;
  polys = o.polys || []; gaps = []; cand = []; cal.ok = false; cal.M = null;
  texts = o.texts || [];
  cal.pts = (o.cal || []).map(c => c.p);
  setCoordMode(o.coordinateMode || (cal.pts.length===4?'map':'local'));
  crs();
  (o.cal || []).forEach((c, i) => {
    $('cx' + i).value = c.x;
    $('cy' + i).value = c.y;
  });
  $('th').value = o.th || 5;
  if(o.ly) ['lP','lD','lSu','lM','lPoly'].forEach((i, k) => { $(i).value = o.ly[k]; });

  hist = []; cur = []; selT = -1;
  tform(); stat();
  if(cal.pts.length === 4) fitCal();
  dirty = false;
  draw();
  $('modalCloud').classList.remove('open');
  alert(`Proyek "${p.nama}" berhasil dimuat. Pastikan membuka file peta yang sesuai jika belum dibuka.`);
}

async function deleteCloudProject(id, name){
  if(!confirm(`Hapus proyek "${name}" dari cloud?`)) return;
  await sb.from('projects').delete().eq('id', id);
  loadCloudProjects();
}

// ==================== TOP-UP TOKEN MODAL ====================
function openTopupModal(){
  if(!currentUser){
    openAuthModal('login');
    return;
  }
  currentUniqueCode = Math.floor(100 + Math.random() * 899);
  $('topupNominalDisplay').textContent = 'Rp ' + (currentPaketHarga + currentUniqueCode).toLocaleString('id-ID');
  loadPaketHarga();
  $('modalTopup').classList.add('open');
  $('topupAlert').className = 'form-alert';
  $('topupAlert').textContent = '';
  loadPublicPaymentInfo();
  loadUserTopupHistory();
}
// Harga paket diambil dari server agar sama dengan pengaturan admin (server tetap menghitung nominal sendiri).
async function loadPaketHarga(){
  try{
    const { data, error } = await sb.rpc('get_harga_paket');
    const n = Number(data);
    if(!error && Number.isFinite(n) && n > 0) currentPaketHarga = n;
  }catch(_){}
  $('topupNominalDisplay').textContent = 'Rp ' + (currentPaketHarga + currentUniqueCode).toLocaleString('id-ID');
}
$('btnTopupPill').onclick = openTopupModal;

async function loadPublicPaymentInfo(){
  if(!sb) return;
  const { data, error } = await sb.from('payment_settings').select('value').eq('key', 'main').maybeSingle();
  if(error){
    console.error('Informasi pembayaran tidak dapat dimuat:', error.message);
    return;
  }
  const r = data?.value || {};
  $('userBankName').textContent = r.bank_name || r.bank || 'Belum diatur';
  $('userBankNorek').textContent = r.bank_norek || r.nomor || '-';
  $('userBankAn').textContent = r.bank_an || r.atas_nama || '-';
  $('userBankCard').style.display = (r.bank_name || r.bank || r.bank_norek || r.nomor) ? '' : 'none';
  $('userEwalletName').textContent = r.ewallet_name || '-';
  $('userEwalletNomor').textContent = r.ewallet_nomor || '-';
  $('userEwalletAn').textContent = r.ewallet_an || '-';
  $('userEwalletCard').style.display = (r.ewallet_name || r.ewallet_nomor) ? '' : 'none';
  const hasQris = Boolean(r.qris_url);
  $('userQrisSection').style.display = hasQris ? '' : 'none';
  if(hasQris){
    $('userQrisImg').src = r.qris_url;
    $('userQrisZoomImg').src = r.qris_url;
  } else {
    $('userQrisImg').removeAttribute('src');
    $('userQrisZoomImg').removeAttribute('src');
  }
  $('btnCopyBankNorek').disabled = !(r.bank_norek || r.nomor);
  $('btnCopyEwalletNomor').disabled = !r.ewallet_nomor;
}

$('btnCopyBankNorek').onclick = async () => { const value = $('userBankNorek').textContent.trim(); if(value && value !== '-') { try { await navigator.clipboard.writeText(value); alert('Nomor rekening disalin.'); } catch { alert('Tidak dapat menyalin otomatis. Silakan salin nomor rekening secara manual.'); } } };
$('btnCopyEwalletNomor').onclick = async () => { const value = $('userEwalletNomor').textContent.trim(); if(value && value !== '-') { try { await navigator.clipboard.writeText(value); alert('Nomor dompet digital disalin.'); } catch { alert('Tidak dapat menyalin otomatis. Silakan salin nomor secara manual.'); } } };

async function handleTopupSubmit(e){
  e.preventDefault();
  if(!currentUser) return;

  const fileInput = $('topupBuktiFile');
  const file = fileInput.files[0];
  if(!file){ alert('Pilih foto bukti pembayaran'); return; }
  if(file.size > 2.5 * 1024 * 1024){ alert('Ukuran foto bukti maksimal 2.5 MB'); return; }

  $('btnSubmitTopup').disabled = true;
  $('btnSubmitTopup').textContent = 'Mengunggah bukti...';

  // Upload ke storage bukti-transfer (private)
  const ext = file.name.split('.').pop() || 'jpg';
  const filePath = `${currentUser.id}/${Date.now()}_bukti.${ext}`;
  const { error: uploadError } = await sb.storage.from('bukti-transfer').upload(filePath, file);

  if(uploadError){
    $('btnSubmitTopup').disabled = false;
    $('btnSubmitTopup').textContent = 'Kirim Konfirmasi Pembayaran';
    $('topupAlert').className = 'form-alert error';
    $('topupAlert').textContent = 'Gagal upload foto bukti: ' + uploadError.message;
    return;
  }

  // Insert ke tabel topups
  const nominal = currentPaketHarga + currentUniqueCode;
  const metode = $('topupMetode').value;
  const catatan = $('topupCatatan').value.trim();

  const { error: insertError } = await sb.from('topups').insert({
    user_id: currentUser.id,
    paket: '50_token',
    jumlah_token: 50,
    nominal: nominal,
    kode_unik: currentUniqueCode,
    metode: metode,
    bukti_url: filePath,
    catatan: catatan
  });

  $('btnSubmitTopup').disabled = false;
  $('btnSubmitTopup').textContent = 'Kirim Konfirmasi Pembayaran';

  if(insertError){
    $('topupAlert').className = 'form-alert error';
    $('topupAlert').textContent = 'Gagal menyimpan transaksi: ' + insertError.message;
  } else {
    $('topupAlert').className = 'form-alert success';
    $('topupAlert').textContent = 'Bukti pembayaran berhasil dikirim! Admin akan segera memeriksa dan menyetujui token Anda.';
    fileInput.value = '';
    $('topupCatatan').value = '';
    loadUserTopupHistory();
  }
}

async function loadUserTopupHistory(){
  if(!currentUser) return;
  const { data: topups } = await sb.from('topups')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const container = $('userTopupHistory');
  if(!topups || topups.length === 0){
    container.innerHTML = '<div class="mu">Belum ada riwayat top-up.</div>';
    return;
  }

  container.innerHTML = topups.map(t => {
    let badge = '<span style="color:var(--warning);font-weight:600">&bull; Menunggu Verifikasi</span>';
    if(t.status === 'disetujui') badge = '<span style="color:var(--success);font-weight:600">&#10003; Disetujui (+50 Token)</span>';
    if(t.status === 'ditolak') badge = `<span style="color:var(--danger);font-weight:600">&times; Ditolak (${esc(t.catatan || 'Bukti tidak valid')})</span>`;
    const fDate = new Date(t.created_at).toLocaleDateString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    return `
      <div style="background:var(--bg-input);padding:6px 10px;border-radius:7px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <b>Rp ${t.nominal.toLocaleString('id-ID')}</b> <span class="mu">(${esc(t.metode)})</span>
          <div class="mu" style="font-size:10.5px">${fDate}</div>
        </div>
        <div style="font-size:11px">${badge}</div>
      </div>
    `;
  }).join('');
}

// ==================== TOKEN LEDGER MODAL ====================
async function openLedgerModal(){
  if(!currentUser) return;
  $('modalLedger').classList.add('open');
  const c = $('ledgerList');
  c.innerHTML = '<div class="mu" style="text-align:center;padding:20px">Memuat riwayat token...</div>';

  const { data: ledger, error } = await sb.from('token_ledger')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('waktu', { ascending: false })
    .limit(40);

  if(error || !ledger || ledger.length === 0){
    c.innerHTML = '<div class="mu" style="text-align:center;padding:24px">Belum ada riwayat transaksi token.</div>';
    return;
  }

  c.innerHTML = ledger.map(l => {
    const isPlus = l.jumlah > 0;
    const clr = isPlus ? 'var(--success)' : 'var(--danger)';
    const sign = isPlus ? '+' : '';
    const fDate = new Date(l.waktu).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <b style="color:${clr}">${sign}${l.jumlah} Token</b> <span style="font-size:11.5px;color:var(--text-main)">(${esc(l.jenis)})</span>
          <div class="mu" style="font-size:11px;margin-top:2px">${esc(l.catatan || '-')}</div>
        </div>
        <div class="mono" style="font-size:11px;color:var(--text-muted)">${fDate}</div>
      </div>
    `;
  }).join('');
}

// ==================== EXPORT DXF DENGAN VERIFIKASI TOKEN ====================
$('exp').onclick = async () => {
  if(!ready()) return;

  // 1. Cek Sesi Pengguna
  if(!currentUser){
    alert('Untuk mengunduh file DXF AutoCAD, silakan masuk atau daftar akun terlebih dahulu.\n\nDapatkan 3 token gratis saat mendaftar akun baru!');
    openAuthModal('register');
    return;
  }

  // 2. Server membuat DXF, memotong 1 token, lalu mengirim file
  $('exp').disabled = true;
  const originalExpText = $('exp').innerHTML;
  $('exp').innerHTML = '<span>Membuat DXF di server...</span>';

  const payload = {
    size: [iw, ih],
    coordinateMode: cal.mode,
    cal: cal.pts.map((p, i) => ({ p, x: $('cx' + i).value, y: $('cy' + i).value })),
    lines, texts, polys,
    th: $('th').value,
    ly: ['lP','lD','lSu','lM','lPoly'].map(i => $(i).value)
  };
  let res = null, errMsg = '', noToken = false;
  try{
    const { data, error } = await sb.functions.invoke('export-dxf', { body: payload });
    if(error){
      errMsg = error.message;
      const ctx = error.context;
      if(ctx && typeof ctx.json === 'function'){
        noToken = ctx.status === 402;
        try{ const j = await ctx.json(); if(j && j.message) errMsg = j.message; }catch(_){}
      }
    } else {
      res = data;
    }
  }catch(e){ errMsg = e.message; }
  $('exp').disabled = false;
  $('exp').innerHTML = originalExpText;

  if(!res || !res.ok){
    alert(errMsg || (res && res.message) || 'Gagal membuat DXF. Coba lagi.');
    if(noToken) openTopupModal();
    return;
  }

  await fetchUserTokens();
  const s = res.dxf;
  const ok = await save('bidang_tanah.dxf', new Blob([s], { type: 'application/octet-stream' }));
  if(!ok){
    $('outbox').classList.remove('hide');
    $('out').value = s;
    $('out').select();
    $('outmsg').textContent = 'Simpan otomatis tidak tersedia. Salin teks ini ke Notepad, simpan sebagai bidang_tanah.dxf.';
  } else {
    if(window.__ppSaved) await window.__ppSaved();
    alert(`Berhasil mengunduh DXF!\n1 token telah dipotong. Sisa saldo token Anda: ${res.remaining} token.`);
  }
};

// Listen Auth state change
if(sb){
  // Proses perubahan sesi satu per satu, dan jangan panggil Supabase langsung di dalam
  // callback onAuthStateChange (bisa macet saat halaman baru dimuat).
  let authChain = Promise.resolve();
  const queueAuth = (session) => {
    authChain = authChain.then(() => updateAuthState(session)).catch(e => console.error('updateAuthState:', e));
  };
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => queueAuth(session), 0);
  });
  sb.auth.getSession().then(({ data: { session } }) => {
    queueAuth(session);
  });

  // Tangkap error jika redirect OAuth gagal dari Supabase
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const queryParams = new URLSearchParams(window.location.search);
  const authErr = hashParams.get('error_description') || queryParams.get('error_description');
  if(authErr){
    setTimeout(() => {
      alert('Gagal autentikasi Google: ' + decodeURIComponent(authErr).replace(/\+/g, ' '));
      history.replaceState(null, '', window.location.pathname);
    }, 400);
  }
}

// Tombol daftar proyek memakai atribut data-*, tanpa kode di dalam HTML
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cact]');
  if(!b) return;
  if(b.dataset.cact === 'open') openCloudProject(b.dataset.id);
  else if(b.dataset.cact === 'del') deleteCloudProject(b.dataset.id, b.dataset.nama);
});
