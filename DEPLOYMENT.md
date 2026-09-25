# Deployment ke Vercel (Container)

MediaVault di-deploy sebagai **Vercel Container** (`Dockerfile.vercel`, dengan
yt-dlp + ffmpeg di dalam image). Auto-deploy aktif: setiap push ke `main`
memicu build container.

## 1. Prasyarat akun

- Repo GitHub terhubung ke project Vercel `mediadownloader` (team
  `rakairhamnas-projects`), sudah berjalan.
- PostgreSQL yang bisa diakses publik (mis. Vercel Postgres, Neon, Supabase).

## 2. Set environment variable `DATABASE_URL` (wajib)

Container runtime membaca `process.env.DATABASE_URL` (lihat `src/lib/config.ts`).
Tanpa ini semua request DB gagal.

```bash
# production
vercel env add DATABASE_URL production
# (tempel connection string, contoh:)
# postgresql://user:pass@host:5432/dbname?schema=public
```

> Untuk Neon/Supabase gunakan connection string **direct** (bukan pooled).
> Jika pakai pooler ala PgBouncer, tambahkan `pgbouncer=true` pada *direct URL*
> Prisma (`DIRECT_URL`) — lihat dokumentasi penyedia DB.

## 3. Siapkan schema di database

Setelah `DATABASE_URL` production diset, jalankan sekali dari lokal:

```bash
vercel pull --environment=production       # menulis .vercel/.env.production.local
npx prisma db push                         # membuat tabel (idempoten)
```

Schema-nya tersimpan di DB dan bertahan melewati redeploy, jadi cukup sekali
(kecuali ada perubahan `prisma/schema.prisma`).

## 4. Deploy

```bash
git push origin main     # auto-deploy via integrasi GitHub
# atau dari CLI:
vercel --prod
```

Cek status: `vercel ls` / `vercel inspect <url>` / dashboard Vercel.

## 5. Verifikasi setelah deploy

```bash
curl -s https://mediadownloader-rakairhamnas-projects.vercel.app/api/settings
curl -s -X POST https://.../api/analyze -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

## 6. Keterbatasan yang WAJIB dipahami (container Vercel)

- **Skala instance = 1.** Antrian job, progress, dan file selesai download
  hidup di memori + filesystem instance. Set di dashboard
  **Project → Settings → Container → Min Instances = 1** (dan jangan pakai
  Max > 1), supaya instance tidak mati saat idle (scale-to-zero) — karena kalau
  mati, job yang sedang berjalan ikut mati (dicatat `failed` oleh reconcile
  setelah 30 menit).
- **Storage ephemeral.** File di `/app/.mediavault` hilang saat redeploy /
  instance di-recycle, dan request bisa dilayani instans yang berbeda dari
  yang men-download. **Solusi bawaan:** aktifkan mirror Supabase Storage
  (bagian 8) — setelah itu file hasil download tersaji permanen di
  `GET /api/downloads/:id/file` meski lintas instans. Tanpa mirror, unduhan
  harus diambil (tombol download) sebelum instance berganti.
- **Durasi.** Download lama (video besar) bergantung pada umur instance;
  the instance tidak mati selama ada request — polling progress dari UI
  membuatnya tetap hidup.
- **Memory.** Deploy container Hobby/Pro default 1 GB. Untuk download video
  besar (merge ffmpeg) bisa dinaikkan (Settings → Container).
- **Region.** `regions: ["sin1"]` di `vercel.json` = instance berjalan di
  Singapura (latensi baik untuk Indonesia). Build selalu jalan di `iad1`
  (Washington, D.C.) — normal.

## 7. Catatan Dockerfile

- Base image **Debian slim** (bukan Alpine): engine query Prisma 5 versi musl
  menautkan `libssl.so.1.1` yang tidak ada di Alpine modern (OpenSSL 3).
  Di Debian engine `debian-openssl-3.0.x` ter-load dengan benar.
- `npm ci` → `npx prisma generate` → `npm run build` (generate client WAJIB
  sebelum type-check; di Docker, schema baru ter-copy setelah `npm ci`).
- `outputFileTracingIncludes` di `next.config.ts` memastikan Prisma client +
  engine ikut ter-trace ke output `standalone` (tanpa ini, container boot tapi
  semua query DB gagal).
- Runtime pakai `node server.js` (standalone) sebagai user `nextjs` non-root.

## 8. (Opsional) Supabase Storage — file hasil download yang persisten

Tanpa ini, file hanya ada di disk instans yang men-download (hilang saat
instans berganti — lihat bagian 6). Dengan mirror ini, `GET
/api/downloads/:id/file` membaca dari Supabase Storage sehingga file tetap
tersaji lintas instans/redeploy.

1. Buat bucket di dashboard/API Supabase (harus **private**; nama default
   `mediavault`):
   ```bash
   curl -X POST https://<ref>.supabase.co/storage/v1/bucket \
     -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE" \
     -H "Content-Type: application/json" \
     -d '{"name":"mediavault","public":false}'
   ```
2. Set env di Vercel (production/preview/development):
   ```bash
   vercel env add SUPABASE_URL production
   vercel env add SUPABASE_SERVICE_ROLE_KEY production
   vercel env add SUPABASE_STORAGE_BUCKET production   # opsional, default mediavault
   ```
3. Redeploy (`vercel redeploy <url> --prod` atau push ke `main`).

Perilaku:
- File **≤ limit objek plan free (~50 MB)** di-mirror otomatis saat download
  selesai (MP3, video kecil). Status `completed` baru ditulis **setelah**
  mirror berhasil — jadi `completed` = file durable.
- Video > limit tetap tersimpan di disk instans (degradasi: hanya tersaji di
  instans yang sama). Log `[Storage] Mirror upload failed` mengindikasikan ini.
- `DELETE /api/downloads/:id` ikut menghapus objek di bucket (idempoten).
- Tanpa env SUPABASE_* fitur ini non-aktif (perilaku disk-only, cocok untuk
  dev lokal). Akses file pakai service-role key dari server-side saja; browser
  tidak pernah melihat key tersebut.