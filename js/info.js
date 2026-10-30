// PlotPeta: Modal panduan, syarat, dan privasi
/* PlotPeta information modal handlers */
(() => {
  const modal = document.getElementById('infoModal');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  const close = document.getElementById('modalClose');
  if (!modal || !title || !body || !close) return;

  // ISI DUA NILAI INI sebelum dipublikasikan (identitas pengendali data wajib jelas bagi pengguna).
  const PP_PENGELOLA = '[ISI: nama pengelola / penyelenggara PlotPeta]';
  const PP_EMAIL = '[ISI: email kontak pelindungan data]';
  const PP_UPDATED = '23 Oktober 2026';
  const ul = 'style="padding-left:18px;margin:6px 0"';

  const content = {
    help: {
      title: 'Panduan Penggunaan',
      body: `<p><strong>PlotPeta: Solusi Cerdas Digitasi Peta</strong></p>
        <ol ${ul}>
          <li><strong>Buka peta:</strong> klik <em>Buka peta</em> lalu pilih gambar scan JPG, PNG, atau TIFF. Gambar diproses di browser Anda dan tidak diunggah ke server.</li>
          <li><strong>Kalibrasi (opsional):</strong> mode lokal tidak memerlukan kalibrasi. Untuk koordinat peta/UTM, pilih mode koordinat peta, klik empat titik referensi, isi koordinat X dan Y yang benar, lalu klik <em>Terapkan</em>.</li>
          <li><strong>Deteksi Cepat:</strong> pilih alat <em>Deteksi Cepat</em>, lalu tarik area atau klik <em>Deteksi seluruh peta</em>. Parameter dihitung otomatis dari gambar; garis dobel dibuang dan persilangan dipotong otomatis. Metode lain tersedia di bagian Lanjutan pada laci alat. Periksa kandidat (oranye) sebelum klik <em>Terima semua</em>.</li>
          <li><strong>Edit:</strong> gunakan <em>Garis penuh</em>, <em>Edit Garis</em>, dan <em>Hapus</em> untuk memperbaiki hasil.</li>
          <li><strong>Teks bidang:</strong> pilih alat <em>Teks bidang</em>, klik peta, lalu ketik nomor hak dan surat ukur.</li>
          <li><strong>Simpan:</strong> <em>Simpan lokal</em> menyimpan proyek ke komputer Anda. <em>Cloud</em> (perlu login) menyimpan data garis, teks, dan kalibrasi ke akun Anda; gambar peta tidak ikut diunggah.</li>
          <li><strong>Ekspor DXF:</strong> memerlukan login dan 1 token. Setelah diunduh, buka di aplikasi CAD dan periksa skala, koordinat, serta layer.</li>
        </ol>
        <p><strong>Tentang data Anda:</strong></p>
        <ul ${ul}>
          <li>Peta terakhir dan pekerjaan Anda disimpan sementara di browser ini untuk pemulihan otomatis. Di komputer bersama, klik <em>Hapus peta</em> atau keluar (logout) setelah selesai; keduanya membersihkan data pemulihan tersebut.</li>
          <li>Isi teks bidang hanya dengan data yang diperlukan. Jika memuat data pribadi pemilik tanah, pastikan Anda berwenang memprosesnya, terutama sebelum menyimpannya ke cloud.</li>
          <li>Pada bukti transfer, tutup atau samarkan informasi yang tidak perlu (misalnya saldo rekening).</li>
        </ul>
        <p>Selalu periksa hasil digitasi sebelum dipakai untuk pekerjaan resmi.</p>`
    },
    tos: {
      title: 'Syarat & Ketentuan',
      body: `<p style="color:var(--text-muted);font-size:11.5px">Terakhir diperbarui: ${PP_UPDATED}</p>
        <p><strong>1. Layanan.</strong> PlotPeta adalah aplikasi web untuk membantu digitasi peta, kalibrasi koordinat, dan menyiapkan berkas DXF. Layanan dikelola oleh ${PP_PENGELOLA} ("Kami").</p>
        <p><strong>2. Akun.</strong> Login memakai akun Google. Anda berusia minimal 18 tahun, memberikan data yang benar, dan menjaga keamanan akun Anda. Anda bertanggung jawab atas aktivitas yang terjadi melalui akun Anda.</p>
        <p><strong>3. Token dan pembayaran.</strong> Satu unduhan DXF memakai 1 token. Isi ulang dilakukan melalui transfer/QRIS sesuai nominal dan paket yang tampil di aplikasi, lalu diverifikasi manual oleh admin berdasarkan bukti yang Anda kirim. Token dapat memiliki masa berlaku yang ditampilkan di aplikasi. Mohon periksa nominal, paket, dan masa berlaku sebelum membayar.</p>
        <p><strong>4. Tanggung jawab atas hasil.</strong> Digitasi, termasuk deteksi otomatis, dapat mengandung kesalahan. Anda wajib memeriksa geometri, koordinat, skala, teks, dan layer sebelum menggunakan hasilnya, terlebih untuk dokumen resmi pertanahan. Hasil tidak menggantikan pemeriksaan oleh tenaga yang berwenang.</p>
        <p><strong>5. Peta dan data yang Anda masukkan.</strong> Anda menyatakan berhak menggunakan peta yang dibuka. Jika peta atau teks yang Anda masukkan memuat data pribadi pihak lain (misalnya nama atau nomor hak pemilik tanah), Anda bertanggung jawab memiliki dasar yang sah untuk memprosesnya. Hak atas peta dan hasil digitasi tetap pada Anda atau pemiliknya semula.</p>
        <p><strong>6. Larangan.</strong> Dilarang mengganggu atau mengakali sistem (termasuk token dan pembayaran), mengunggah bukti pembayaran palsu atau milik orang lain, mengirim konten melawan hukum melalui fitur chat, atau mengakses data pengguna lain.</p>
        <p><strong>7. Data pribadi.</strong> Pemrosesan data pribadi Anda diatur dalam <a href="#" data-info="privacy">Kebijakan Privasi</a>, yang merupakan bagian dari Syarat ini.</p>
        <p><strong>8. Pembatasan tanggung jawab.</strong> Layanan disediakan sebagaimana adanya. Sejauh diizinkan hukum, Kami tidak bertanggung jawab atas kerugian tidak langsung akibat penggunaan hasil digitasi. Ketentuan ini tidak menghapus hak Anda yang dijamin peraturan perundang-undangan, termasuk hak sebagai subjek data pribadi dan hak konsumen.</p>
        <p><strong>9. Perubahan.</strong> Syarat dapat diperbarui. Perubahan yang berarti akan diumumkan di aplikasi; menggunakan layanan setelah itu berarti menerima perubahan tersebut.</p>
        <p><strong>10. Hukum dan kontak.</strong> Syarat ini tunduk pada hukum Republik Indonesia. Pertanyaan: ${PP_EMAIL} atau menu <em>Bantuan &amp; Pesan</em>.</p>`
    },
    privacy: {
      title: 'Kebijakan Privasi',
      body: `<p style="color:var(--text-muted);font-size:11.5px">Terakhir diperbarui: ${PP_UPDATED}. Disusun mengacu pada UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP) dan peraturan pelaksanaannya.</p>
        <p><strong>1. Pengendali data pribadi.</strong> ${PP_PENGELOLA}. Kontak pelindungan data: ${PP_EMAIL}.</p>
        <p><strong>2. Data yang kami proses</strong></p>
        <ul ${ul}>
          <li><strong>Akun:</strong> nama, alamat email, dan ID akun dari login Google.</li>
          <li><strong>Token dan pembayaran:</strong> saldo, riwayat pemakaian token, serta riwayat isi ulang (nominal, metode, kode unik, catatan, dan foto bukti transfer yang Anda unggah; foto ini dapat memuat nama pengirim atau nomor rekening).</li>
          <li><strong>Proyek cloud (opsional):</strong> nama proyek, garis, teks bidang (nomor hak, surat ukur), kalibrasi, dan pengaturan layer. Gambar peta tidak diunggah.</li>
          <li><strong>Ekspor DXF:</strong> data garis, teks, poligon, dan kalibrasi dikirim ke server hanya untuk membuat berkas DXF dan memotong token.</li>
          <li><strong>Pesan bantuan:</strong> isi percakapan Anda dengan admin.</li>
          <li><strong>Di perangkat Anda saja:</strong> gambar peta terakhir dan pekerjaan untuk pemulihan otomatis (penyimpanan browser), serta preferensi tema dan alat favorit. Data ini tidak dikirim ke server dan dihapus lewat <em>Hapus peta</em>, logout, atau pengaturan browser.</li>
          <li><strong>Data teknis:</strong> saat halaman dimuat, penyedia layanan pihak ketiga (lihat poin 4) dapat menerima alamat IP dan informasi perangkat Anda.</li>
        </ul>
        <p><strong>3. Tujuan dan dasar pemrosesan.</strong> (a) Persetujuan Anda: login dan penggunaan fitur akun, termasuk proyek cloud dan chat. (b) Pelaksanaan perjanjian layanan: pengelolaan token, verifikasi pembayaran, dan pembuatan DXF. (c) Kewajiban hukum dan kepentingan yang sah: pencatatan transaksi, pencegahan penyalahgunaan, dan keamanan sistem. Data tidak dipakai untuk tujuan lain tanpa pemberitahuan dan, bila perlu, persetujuan Anda.</p>
        <p><strong>4. Pihak yang memproses data.</strong> Kami memakai Supabase (autentikasi, basis data, penyimpanan, dan fungsi server) serta Google (login, Google Fonts). Pustaka tertentu dimuat dari jsDelivr. Kami tidak menjual data pribadi Anda. Admin PlotPeta dapat melihat data yang diperlukan untuk memverifikasi pembayaran dan menjawab chat. Data juga dapat diungkapkan bila diwajibkan oleh peraturan perundang-undangan.</p>
        <p><strong>5. Transfer ke luar Indonesia.</strong> Server penyedia layanan di atas dapat berada di luar wilayah Indonesia. Transfer dilakukan dengan memperhatikan ketentuan UU PDP, dan hanya sebatas yang diperlukan untuk menjalankan layanan.</p>
        <p><strong>6. Penyimpanan.</strong> Data disimpan selama akun aktif dan selama diperlukan untuk tujuan di atas. Percakapan di fitur chat bantuan dihapus otomatis setelah 90 hari tanpa aktivitas, dan hanya admin yang dapat menghapus pesan secara manual. Setelah masa retensi berakhir, atau saat Anda menghapus akun, data dihapus atau dimusnahkan, kecuali peraturan perundang-undangan menentukan lain (misalnya pencatatan transaksi).</p>
        <p><strong>7. Hak Anda sebagai subjek data pribadi.</strong> Anda berhak: mendapat informasi tentang pemrosesan data Anda; melengkapi atau memperbaiki data; mengakses dan memperoleh salinan data; mengakhiri pemrosesan, menghapus, atau memusnahkan data; menarik kembali persetujuan; menunda atau membatasi pemrosesan; menggunakan dan mengirimkan data Anda ke pengendali lain sebagaimana diatur UU PDP; serta menuntut ganti rugi atas pelanggaran pemrosesan data Anda. Beberapa hak dapat dikecualikan oleh undang-undang.</p>
        <p><strong>8. Cara menggunakan hak.</strong> Anda dapat menghapus akun dan seluruh datanya sendiri lewat menu akun &rarr; <em>Hapus Akun</em>. Untuk hak lainnya, ajukan permohonan tertulis ke ${PP_EMAIL} atau melalui menu <em>Bantuan &amp; Pesan</em> setelah login. Cantumkan akun Google Anda dan hak yang diminta. Kami dapat meminta verifikasi identitas dan akan menanggapi dalam waktu wajar.</p>
        <p><strong>9. Menarik persetujuan.</strong> Anda dapat menarik persetujuan kapan saja. Perlu diketahui, tanpa data akun dan token, fitur yang memerlukan login (cloud, token, ekspor DXF) tidak dapat digunakan. Penarikan tidak memengaruhi pemrosesan yang sudah sah sebelumnya.</p>
        <p><strong>10. Keamanan dan kegagalan pelindungan data.</strong> Kami menerapkan langkah teknis dan organisasi yang wajar, seperti koneksi terenkripsi dan pembatasan akses data. Bila terjadi kegagalan pelindungan data pribadi, Kami akan memberi tahu Anda secara tertulis dan menyampaikannya kepada lembaga yang berwenang paling lambat 3 x 24 jam sesuai UU PDP.</p>
        <p><strong>11. Anak.</strong> Layanan ditujukan bagi pengguna berusia 18 tahun ke atas dan tidak sengaja mengumpulkan data anak.</p>
        <p><strong>12. Perubahan.</strong> Kebijakan ini dapat diperbarui; perubahan yang berarti akan diumumkan di aplikasi.</p>`
    }
  };
  function show(key) {
    const item = content[key];
    if (!item) return;
    title.textContent = item.title;
    body.innerHTML = item.body;
    modal.classList.remove('hide');
    close.focus();
  }
  window.ppShowInfo = show;
  body.addEventListener('click', e => { const l = e.target.closest('[data-info]'); if (l) { e.preventDefault(); show(l.dataset.info); } });
  document.getElementById('btnHelp')?.addEventListener('click', e => { e.preventDefault(); show('help'); });
  document.getElementById('btnTos')?.addEventListener('click', e => { e.preventDefault(); show('tos'); });
  document.getElementById('btnPrivacy')?.addEventListener('click', e => { e.preventDefault(); show('privacy'); });
  document.getElementById('btnHelpHeader')?.addEventListener('click', e => { e.preventDefault(); show('help'); });
  document.getElementById('btnTosHeader')?.addEventListener('click', e => { e.preventDefault(); show('tos'); });
  document.getElementById('btnPrivacyHeader')?.addEventListener('click', e => { e.preventDefault(); show('privacy'); });
  close.addEventListener('click', () => modal.classList.add('hide'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hide'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hide')) modal.classList.add('hide'); });
})();
