# Contributing

Terima kasih sudah mau berkontribusi pada PlotPeta.

## Cara berkontribusi
1. Fork repository ini
2. Buat branch baru untuk perubahan Anda
3. Lakukan perubahan yang relevan
4. Pastikan tidak menambahkan credential atau secret ke repo
5. Commit dengan pesan yang jelas
6. Ajukan pull request ke branch utama

## Panduan sebelum submit PR
- Pastikan fitur yang Anda tambahkan sudah dites secara dasar
- Hindari mengekspos API key atau secret ke source code
- Gunakan nama branch yang jelas, misalnya:
  - `feat/dxf-export`
  - `fix/token-validation`
  - `docs/readme-improvement`

## Struktur commit yang disarankan
```bash
git checkout -b feat/nama-fitur
git add .
git commit -m "feat: tambah fitur X"
```

## Developer notes
- Jaga agar proses setup tetap sederhana untuk pemula
- Dokumentasikan setiap perubahan yang cukup penting
- Jika ada perubahan pada database atau Supabase schema, jelaskan di PR Anda
- Jika Anda menambah environment variable baru, tambahkan juga ke `.env.example`

## Menggunakan file environment
Salin `.env.example` menjadi `.env` lalu isi nilai yang sesuai dengan environment lokal Anda.

## Pertanyaan
Jika ada kebutuhan bantuan atau ada yang belum jelas, silakan buat issue atau diskusikan di pull request yang relevan.
