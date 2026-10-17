# Spesifikasi: PlotPeta, Akses Web Premium (Model Token)

Status: **DRAFT untuk dicek.** Belum ada yang dibuat dari dokumen ini.

Tanda: **[Sepakat]** sudah diputuskan. **[Usulan]** masih usulan. **[Putuskan]** perlu keputusanmu.

Dokumen ini melanjutkan `spesifikasi-digitasi-peta.md` (fitur aplikasi). Di sini hanya dibahas akun, token, data, dan pembayaran.

---

## 1. Produk

- Nama produk: **PlotPeta** (sebelumnya DIGIMAP). **[Sepakat]**
- Alamat awal: subdomain Vercel (misalnya `plotpeta.vercel.app`, tergantung ketersediaan nama). Domain sendiri menyusul. **[Sepakat]**
- Model: **token, bukan langganan berkala.** **[Sepakat]**

## 2. Prinsip data **[Sepakat]**

- **File scan peta (JPG/TIF) tidak diunggah.** Tetap di laptop pengguna dan hanya dibuka di browser.
- **Supabase hanya menyimpan data teks ringkas:** titik kalibrasi, koordinat garis, nomor hak, nomor Su, dan pengaturan, dalam format JSON.
- Pemrosesan (deteksi garis, penggambaran, poligon) berjalan di browser pengguna.
- Satu pengecualian kecil: **foto bukti pembayaran** diunggah ke penyimpanan privat (lihat bagian 7).

## 3. Aturan token

| Hal | Aturan |
|---|---|
| Paket awal | Rp100.000 untuk 50 token (Rp2.000 per token) **[Sepakat]** |
| Pemakaian | 1 download DXF = 1 token, termasuk mengunduh ulang proyek yang sama **[Sepakat]** |
| Pembelian berikutnya | Token baru ditambahkan ke token yang masih berlaku **[Sepakat]** |
| Kedaluwarsa | **Semua token (gratis dan beli) kedaluwarsa.** Sementara **1 bulan** sejak diterima, dan lamanya bisa diubah admin **[Sepakat]** |
| Cara hitung kedaluwarsa | Tiap penambahan token punya masa berlaku sendiri, dan pemakaian mengambil token yang paling cepat kedaluwarsa lebih dulu **[Usulan, mohon dicek]** |
| Perubahan masa berlaku | Berlaku untuk token yang diterima setelah perubahan, bukan untuk token yang sudah ada **[Usulan]** |
| Download gagal | Token dikembalikan ke kelompok asalnya. Jika kelompok itu sudah kedaluwarsa, token berlaku 1 hari lagi **[Usulan]** |
| Token habis atau kedaluwarsa | Tidak bisa download DXF **[Sepakat]**. Pengguna tetap bisa bekerja dan menyimpan proyek **[Usulan]** |
| Uji coba gratis | 3 token gratis saat mendaftar, satu kali per akun, ikut kedaluwarsa **[Sepakat]** |
| Paket lain | Hanya paket 50 token dulu. Paket lain bisa ditambah nanti. |

Aplikasi menampilkan sisa token dan tanggal kedaluwarsa terdekat (misalnya "5 token berlaku sampai 20 November"). Masa berlaku harus tertulis jelas di halaman beli dan di syarat layanan, karena pembeli perlu tahu sebelum membayar.

## 4. Arsitektur **[Usulan]**

| Bagian | Dipakai untuk |
|---|---|
| Vercel (hosting statis) | Menyajikan aplikasi PlotPeta dan halaman admin. Halaman di claude.ai tidak bisa dipakai karena tidak boleh terhubung ke Supabase. |
| Supabase Auth | Daftar (verifikasi email), masuk, lupa kata sandi |
| Supabase Postgres | Proyek, kelompok token, riwayat token, permintaan isi ulang, pengaturan |
| Supabase Storage (privat) | Foto bukti pembayaran |
| Supabase Edge Function `export-dxf` | Membuat DXF di server dan memotong token |

**Mengapa DXF dibuat di server:** kode di browser bisa diubah pengguna sehingga hitungan token di browser bisa dilewati. Kalau DXF hanya keluar dari server setelah token dipotong, token tidak bisa dilewati.

## 5. Skema database **[Usulan]**

- `profiles`: id (sama dengan id pengguna Auth), nama, `is_admin`, dibuat pada.
- `token_batches`: id, user_id, asal (gratis atau beli), jumlah awal, sisa, diterima pada, kedaluwarsa pada. Saldo pengguna adalah jumlah `sisa` dari kelompok yang belum kedaluwarsa.
- `token_ledger`: id, user_id, batch_id, jenis (gratis, beli, pakai, kembali, kedaluwarsa, koreksi), jumlah, project_id, topup_id, waktu. Setiap perubahan tercatat di sini.
- `topups`: id, user_id, paket, jumlah token, nominal, kode unik, metode, path bukti, status (menunggu, disetujui, ditolak), catatan, dibuat, diputuskan oleh, diputuskan pada.
- `projects`: id, user_id, nama, `data` (JSON, maksimal 5 MB), ukuran, dibuat pada, diubah pada.
- `settings`: kunci dan nilai, misalnya `masa_berlaku_token_hari` (awal 30) dan harga paket.

Keamanan baris (Row Level Security): pengguna hanya bisa membaca dan mengubah barisnya sendiri. `token_batches`, `token_ledger`, `settings`, dan status `topups` hanya bisa diubah lewat fungsi server. Hanya admin yang bisa melihat semua `topups`, semua bukti, dan mengubah `settings`.

## 6. Alur download DXF **[Usulan]**

1. Pengguna menekan Simpan DXF. Browser mengirim JSON proyek ke `export-dxf` beserta tanda masuk (token login).
2. Server memotong 1 token dari kelompok yang paling cepat kedaluwarsa dan belum habis, dalam satu operasi atomik. Kalau tidak ada token berlaku, jawab "token habis" dan tampilkan tombol isi ulang.
3. Server membuat DXF (dan ZIP), lalu mengirimkannya.
4. Jika pembuatan gagal, token dikembalikan dan dicatat di `token_ledger`.

## 7. Isi ulang token: pembayaran manual **[Sepakat: manual dulu]**

Metode: QRIS, transfer bank, atau dompet digital, lalu pengguna mengirim bukti dan admin menyetujui.

Alur **[Usulan]**:
1. Pengguna memilih paket 50 token. Aplikasi menampilkan petunjuk bayar: gambar QRIS, nomor rekening, nomor dompet digital, dan **nominal dengan kode unik** (misalnya Rp100.123) supaya pembayaran mudah dicocokkan.
2. Pengguna membayar, lalu mengunggah foto bukti (penyimpanan privat, maksimal sekitar 2 MB). Status permintaan: menunggu.
3. Admin membuka halaman admin, melihat permintaan menunggu beserta bukti, lalu menekan **Setujui** atau **Tolak** (dengan catatan).
4. Setujui memanggil fungsi server khusus admin yang membuat kelompok token baru (50 token, kedaluwarsa sesuai pengaturan) dan mencatatnya. Satu permintaan tidak bisa disetujui dua kali.
5. Pengguna melihat saldo bertambah.

Notifikasi ke admin (email atau WhatsApp) bisa ditambah belakangan. Awalnya admin memeriksa halaman admin secara berkala. **[Sepakat sementara]**

Pembayaran otomatis lewat gateway (Midtrans, Xendit, Tripay) bisa ditambah nanti, tanpa mengubah aturan token.

## 8. Halaman admin (HTML sendiri) **[Sepakat]**

Satu file HTML terpisah (misalnya `admin.html`) di Vercel yang sama. Isinya **[Usulan]**:

- Masuk dengan akun admin. Halaman hanya berfungsi untuk akun `is_admin`. Menyembunyikan alamat bukan pengamanan, jadi pembatasan sebenarnya dijaga oleh aturan baris dan fungsi server.
- Daftar permintaan isi ulang menunggu, dengan bukti dan tombol Setujui atau Tolak.
- **Pengaturan masa berlaku token** (dalam hari, awal 30).
- Daftar pengguna beserta saldo dan tanggal kedaluwarsa terdekat.
- Koreksi token manual (tambah atau kurangi, dengan catatan).
- Riwayat token dan riwayat permintaan.

## 9. Perubahan di aplikasi pengguna **[Usulan]**

- Halaman daftar dan masuk.
- Daftar proyek di akun: simpan, buka, ganti nama, hapus. Simpan otomatis ke cloud setelah perubahan (ditunda beberapa detik).
- Batas cloud: 20 proyek per akun dan 5 MB per proyek. **[Sepakat sementara]**
- Pengguna membuka file peta dari laptopnya setiap kali membuka proyek. Gambar peta tidak ikut disimpan.
- **Simpan proyek lokal (`.json`):** tetap tersedia, gratis, dan tidak memakai token. Batas 5 MB per proyek. **[Sepakat]**
- Tombol Simpan DXF memanggil server dan menampilkan sisa token.
- Halaman isi ulang token, unggah bukti, dan riwayat token.

## 10. Keamanan dan privasi **[Usulan]**

- Verifikasi email saat mendaftar, supaya 3 token gratis tidak mudah disalahgunakan dengan banyak akun. Pembatasan ini tidak sempurna, risikonya perlu diterima.
- Batas ukuran JSON per proyek dan batas jumlah permintaan per menit.
- Bukti bayar hanya bisa dibaca pemiliknya dan admin.
- Pengguna bisa menghapus proyek dan akunnya.
- Syarat layanan (termasuk masa berlaku token), kebijakan privasi, dan kebijakan pengembalian dana (refund) ditulis sebelum dibuka untuk umum. Untuk ketentuan hukum dan pajak, konsultasikan dengan ahlinya.

## 11. Risiko dan batas

- Deteksi otomatis berjalan di browser sehingga kodenya bisa disalin. Nilai yang terlindungi di server adalah pembuatan DXF dan akun.
- Kualitas deteksi baru diuji pada satu peta. Perlu uji pada beberapa jenis peta dan kualitas scan sebelum dijual, dan calon pengguna perlu tahu bahwa hasil deteksi tetap dikoreksi manual.
- Persetujuan manual membutuhkan admin yang rutin memeriksa. Pengguna menunggu selama admin belum menyetujui.
- Komputer pengguna yang lemah bisa lambat untuk TIF yang sangat besar.
- Nama PlotPeta perlu dicek agar tidak bentrok dengan produk atau merek lain.

## 12. Keputusan

Sudah diputuskan: nama PlotPeta, domain Vercel dulu, model token, paket 50 token Rp100.000, semua token kedaluwarsa (sementara 1 bulan, bisa diubah admin), pengembalian token jika gagal, 3 token gratis, pembayaran manual dengan persetujuan admin, halaman admin HTML sendiri, simpan proyek lokal gratis dengan batas 5 MB per proyek.

Perlu dicek: cara hitung kedaluwarsa per kelompok token (bagian 3).

Disiapkan oleh kamu nanti: nomor rekening, QRIS, dan dompet digital yang ditampilkan; syarat layanan, kebijakan privasi, dan kebijakan refund.

## 13. Urutan pembuatan **[Usulan]**

1. Pasang aplikasi di Vercel tanpa login (versi uji).
2. Supabase Auth dan simpan proyek ke cloud.
3. Edge Function `export-dxf` beserta kelompok token, kedaluwarsa, dan 3 token gratis.
4. Halaman isi ulang token, unggah bukti, dan halaman admin.
5. Uji beta dengan beberapa pengguna sebelum dibuka untuk umum.
