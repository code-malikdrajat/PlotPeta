# PlotPeta

PlotPeta adalah aplikasi web untuk digitalisasi peta bidang tanah dan ekspor hasil kerja ke file DXF yang bisa dibuka di AutoCAD. Aplikasi ini membantu pengguna melakukan kalibrasi koordinat, menggambar garis dan poligon, menambahkan label, lalu mengekspor hasil kerja ke format yang siap dipakai untuk kebutuhan teknis.

Demo live:
- https://plotpeta.vercel.app/

## Fitur utama
- Digitasi peta di canvas browser
- Kalibrasi koordinat untuk mengubah data lokal ke koordinat nyata
- Penggambaran garis, poligon, dan teks pada peta
- Ekspor hasil digitasi ke file DXF
- Autentikasi pengguna lewat Supabase / Google Sign-In
- Manajemen token untuk fitur ekspor DXF
- Panel admin untuk pemeriksaan dan kebutuhan operasional

## Teknologi yang dipakai
- Frontend: HTML, JavaScript / TypeScript
- Backend / fungsi server: Supabase Edge Functions (Deno)
- Database: PostgreSQL / Supabase SQL
- Deployment: Vercel
- Data spasial: SQL / PLpgSQL, dan struktur data yang mendukung digitasi peta

## Arsitektur umum
- Frontend utama berada di `index.html`
- Logika utama aplikasi berada di `index.ts`
- Struktur database dan fungsi backend ada di file SQL di root repository
- Supabase dipakai untuk autentikasi, token, dan proses server-side
- Proses ekspor DXF dilakukan lewat edge function yang mengecek login dan saldo token pengguna

## Prasyarat
Sebelum menjalankan project, pastikan perangkat Anda sudah memiliki:
- Node.js (jika ada kebutuhan frontend atau build)
- PostgreSQL / project Supabase aktif
- Akses ke Vercel atau platform deployment yang dipakai
- Variabel environment untuk koneksi Supabase

## Cara menjalankan project
### 1) Clone repository
```bash
git clone https://github.com/code-malikdrajat/PlotPeta.git
cd PlotPeta
```

### 2) Siapkan environment variables
Buat file `.env` atau sesuaikan konfigurasi deployment Anda dengan variabel berikut:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOWED_ORIGIN=https://plotpeta.vercel.app
```

> Jangan pernah membagikan `SUPABASE_SERVICE_ROLE_KEY` ke publik atau ke repository yang tidak aman.

### 3) Jalankan aplikasi lokal
Untuk setup frontend statis:
```bash
python3 -m http.server 5000
```
Lalu buka di browser:
```bash
http://localhost:5000
```

Jika project menggunakan package manager / dev server:
```bash
npm install
npm run dev
```

### 4) Jalankan database dan migrasi SQL
Jika repository memiliki file SQL migrasi, jalankan file tersebut pada database Supabase atau PostgreSQL Anda:

```bash
psql -d your_database -f supabase_schema.sql
```

Atau untuk migrasi spesifik:
```bash
psql -d your_database -f "1. plotpeta_payment_security_migration.sql"
psql -d your_database -f "2. plotpeta_security_fix.sql"
psql -d your_database -f "3. plotpeta_server_token.sql"
```

## Struktur file utama
```text
.
├── README.md
├── index.html
├── index.ts
├── admin.html
├── supabase_schema.sql
├── vercel.json
├── 1. plotpeta_payment_security_migration.sql
├── 2. plotpeta_security_fix.sql
├── 3. plotpeta_server_token.sql
├── spesifikasi-saas-supabase.md
├── .env.example
├── CONTRIBUTING.md
├── LICENSE
└── ...
```

## Alur kerja aplikasi
1. Pengguna membuka aplikasi di browser.
2. Pengguna melakukan digitasi dan kalibrasi koordinat pada canvas.
3. Data peta disimpan ke struktur proyek untuk ditampilkan ulang.
4. Saat ekspor DXF, aplikasi memvalidasi user dan token.
5. Edge Function membuat file DXF dan mengirim hasil ke browser.

## Cara mencoba demo
- Buka: https://plotpeta.vercel.app/
- Masuk menggunakan akun yang tersedia pada sistem
- Lakukan digitasi peta dan export ke DXF

## Kontribusi
Kami sangat terbuka terhadap kontribusi dari siapa pun. Jika Anda ingin membantu, silakan:
1. Fork repository ini
2. Buat branch baru
3. Lakukan perubahan yang relevan
4. Ajukan pull request dengan penjelasan yang jelas

Silakan baca `CONTRIBUTING.md` untuk panduan lengkap.

## Lisensi
Project ini dilisensikan di bawah MIT License. Lihat file `LICENSE` untuk detail lengkap.

## Catatan penting
- Project ini menggabungkan frontend browser dengan backend Supabase
- Fitur ekspor DXF memerlukan validasi autentikasi dan token
- Pastikan semua credential dan key sensitif tidak dibagikan ke publik

## Kontak
- GitHub: https://github.com/code-malikdrajat
- Project: PlotPeta
