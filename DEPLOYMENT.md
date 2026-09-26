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
- **TikTok/Instagram diblokir di Vercel.** IP datacenter Vercel diblokir
  oleh TikTok/IG di level TLS/network (deterministik; tidak bisa diperbaiki
  dari kode di sisi server). Gunakan **download worker** (bagian 9) yang
  berjalan di mesin dengan IP residential untuk sumber-sumber ini.

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

## 9. Download Worker (untuk TikTok/Instagram)

TikTok dan beberapa sumber lain **memblokir IP datacenter Vercel** secara
deterministik (blokir di level TLS/network), jadi download dari Vercel
selamanya gagal terlepas dari kode. Solusinya: **download worker**, sebuah
proses Node mandiri yang dijalankan di mesin biasa (IP residential/non
datacenter) dan menjalankan workflow yt-dlp + ffmpeg yang **persis sama**
dengan server (fungsi di `src/lib/ytdlp.ts` tidak diubah).

Arsitektur: Next.js (Vercel) tetap API + UI + PostgreSQL (source of truth),
logika download jalan di worker; file selesai tetap di-mirror ke Supabase
Storage. Worker **bukan** endpoint command: hanya menerima data job terstruktur
(`jobId`, `url`, `formatId`, opsi audio, metadata) dan memakai kredensial
auth berupa shared secret.

### 9.1 Mode routing

`executionMode` di Settings (`GET/POST /api/settings`) atau override
per-request `executor` di body `POST /api/downloads`:

- `vercel`: jalankan di server ini (perilaku lama).
- `worker`: kirim langsung ke worker.
- `auto` (default): coba server ini dulu. Jika gagal dengan error
  network/extractor (`YTDLP_ERROR`, `TIMEOUT`, `DOWNLOAD_ERROR`), job
  di-*handoff* ke worker **sekali saja**; tidak ada retry buta 6×. Error
  asli disimpan di field `handoffError` (dan digabung ke pesan job bila
  worker ikut gagal); error user (format salah dsb.) tidak pernah di-handoff.

`retry` mempertahankan executor job; `cancel` membatalkan di worker
(menghentikan proses download di sana).

### 9.2 Env (worker & Vercel)

```
WORKER_URL            # URL endpoint worker, mis. http://127.0.0.1:8787 (dev)
WORKER_SHARED_SECRET  # random hex kuat, SAMA di mesin worker dan Vercel
```

- Mesin worker: taruh di `.env.local` bersama `DATABASE_URL` (worker menulis
  status job langsung ke PostgreSQL yang sama).
- Vercel: `vercel env add WORKER_URL production` dan
  `vercel env add WORKER_SHARED_SECRET production`.

**Penting:** Vercel production tidak bisa menjangkau `127.0.0.1` mesin rumah.
`WORKER_URL` production harus URL yang bisa diakses Vercel (domain publik,
tunnel, atau VPN ke mesin rumah Anda). Tanpa `WORKER_URL`/secret, worker
non-aktif dan semua job jalan lokal (`auto` = `vercel`).

### 9.3 Menjalankan worker

```bash
npm ci
# pastikan .env.local berisi DATABASE_URL, WORKER_URL, WORKER_SHARED_SECRET
npm run worker          # tsx worker/index.ts, listen di WORKER_URL
```

Contoh unit systemd (`/etc/systemd/system/mediavault-worker.service`):

```
[Unit]
Description=MediaVault download worker
After=network.target postgresql.service

[Service]
WorkingDirectory=/home/anda/mediavault
ExecStart=/usr/bin/npm run worker
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Poin keamanan (sudah diterapkan di kode):
- Tanpa `WORKER_SHARED_SECRET` worker menolak start.
- Setiap request diverifikasi Bearer secret dengan perbandingan timing-safe.
- Hanya payload job terstruktur diterima; validasi URL penuh dipertahankan
  (tanpa melemahkan), DNS probe dilewati seperti di API.
- Worker memakai yt-dlp/ffmpeg workflow yang sama; tidak ada proxy/cookie
  atau jalur anti-bot baru.
- Jangan expose worker ke internet tanpa HTTPS/tunnel; itu solusi untuk akses
  Vercel, bukan untuk publik.

### 9.4 Verifikasi

```bash
curl -s -H "Authorization: Bearer $WORKER_SHARED_SECRET" $WORKER_URL/v1/health
# => {"data":{"ok":true,"service":"mediavault-worker",...}}

# di Vercel, tes job TikTok:
curl -s -X POST https://<deploy>/api/downloads -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/...","type":"video","executor":"worker"}'
```