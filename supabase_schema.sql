-- ====================================================================
-- SKEMA DATABASE PLOTPETA (SUPABASE POSTGRESQL)
-- Berdasarkan spesifikasi-saas-supabase.md
-- Jalankan skrip ini di: Supabase Dashboard -> SQL Editor -> New Query
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABEL: PROFILES
-- Menyimpan info profil pengguna dan status admin
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    nama TEXT,
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. TABEL: SETTINGS
-- Pengaturan global aplikasi (masa berlaku token, harga paket, rekening, dll)
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Default Settings
INSERT INTO public.settings (key, value, description)
VALUES 
    ('masa_berlaku_token_hari', '30'::jsonb, 'Masa berlaku token dalam hari sejak diterima (default 30)'),
    ('token_gratis_daftar', '3'::jsonb, 'Jumlah token gratis saat pengguna pertama kali mendaftar'),
    ('harga_paket_50', '100000'::jsonb, 'Harga paket 50 token dalam Rupiah'),
    ('rekening_info', '{"bank": "BCA", "nomor": "123-456-7890", "atas_nama": "PlotPeta Official", "qris_url": ""}'::jsonb, 'Informasi pembayaran transfer / QRIS')
ON CONFLICT (key) DO NOTHING;

-- 4. TABEL: TOKEN_BATCHES
-- Menyimpan kelompok token (gratis / beli) beserta sisa dan tanggal kedaluwarsa
CREATE TABLE IF NOT EXISTS public.token_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    asal TEXT NOT NULL CHECK (asal IN ('gratis', 'beli', 'koreksi')),
    jumlah_awal INT NOT NULL CHECK (jumlah_awal > 0),
    sisa INT NOT NULL CHECK (sisa >= 0),
    diterima_pada TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    kedaluwarsa_pada TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_batches_user ON public.token_batches(user_id, kedaluwarsa_pada);

-- 5. TABEL: PROJECTS
-- Menyimpan proyek cloud pengguna (maks 20 proyek per user, maks 5MB per proyek)
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    data JSONB NOT NULL,
    ukuran INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON public.projects(user_id);

-- 6. TABEL: TOPUPS
-- Permintaan isi ulang token manual oleh pengguna
CREATE TABLE IF NOT EXISTS public.topups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    paket TEXT NOT NULL DEFAULT '50_token',
    jumlah_token INT NOT NULL DEFAULT 50,
    nominal INT NOT NULL,
    kode_unik INT NOT NULL DEFAULT 0,
    metode TEXT NOT NULL DEFAULT 'qris',
    bukti_url TEXT,
    status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'disetujui', 'ditolak')),
    catatan TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    diputuskan_oleh UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    diputuskan_pada TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_topups_status ON public.topups(status, created_at DESC);

-- 7. TABEL: TOKEN_LEDGER
-- Buku besar pencatatan riwayat keluar-masuk setiap token
CREATE TABLE IF NOT EXISTS public.token_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES public.token_batches(id) ON DELETE SET NULL,
    jenis TEXT NOT NULL CHECK (jenis IN ('gratis', 'beli', 'pakai', 'kembali', 'kedaluwarsa', 'koreksi')),
    jumlah INT NOT NULL, -- Positif jika bertambah, negatif jika dipakai
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    topup_id UUID REFERENCES public.topups(id) ON DELETE SET NULL,
    catatan TEXT,
    waktu TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_user ON public.token_ledger(user_id, waktu DESC);

-- ====================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;

-- Helper function: cek apakah user saat ini adalah admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT COALESCE(
        (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
        FALSE
    );
$$;

-- PROFILES POLICIES
DROP POLICY IF EXISTS "User bisa melihat profil sendiri" ON public.profiles;
CREATE POLICY "User bisa melihat profil sendiri" ON public.profiles
    FOR SELECT USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "User bisa update profil sendiri" ON public.profiles;
CREATE POLICY "User bisa update profil sendiri" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- SETTINGS POLICIES
DROP POLICY IF EXISTS "Semua user bisa membaca settings" ON public.settings;
CREATE POLICY "Semua user bisa membaca settings" ON public.settings
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Hanya admin bisa update settings" ON public.settings;
CREATE POLICY "Hanya admin bisa update settings" ON public.settings
    FOR ALL USING (public.is_admin());

-- TOKEN_BATCHES POLICIES
-- Pengguna hanya bisa membaca kelompok token miliknya
DROP POLICY IF EXISTS "User membaca token batches sendiri" ON public.token_batches;
CREATE POLICY "User membaca token batches sendiri" ON public.token_batches
    FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- PROJECTS POLICIES
DROP POLICY IF EXISTS "User kelola proyek sendiri" ON public.projects;
CREATE POLICY "User kelola proyek sendiri" ON public.projects
    FOR ALL USING (auth.uid() = user_id);

-- TOPUPS POLICIES
DROP POLICY IF EXISTS "User melihat dan membuat topup sendiri" ON public.topups;
CREATE POLICY "User melihat dan membuat topup sendiri" ON public.topups
    FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "User bisa insert topup baru" ON public.topups;
CREATE POLICY "User bisa insert topup baru" ON public.topups
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- TOKEN_LEDGER POLICIES
DROP POLICY IF EXISTS "User melihat riwayat token sendiri" ON public.token_ledger;
CREATE POLICY "User melihat riwayat token sendiri" ON public.token_ledger
    FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- ====================================================================
-- 9. TRIGGERS & BUSINESS LOGIC FUNCTIONS
-- ====================================================================

-- Trigger saat user baru mendaftar di Supabase Auth
-- 1. Buat record di public.profiles
-- 2. Berikan 3 token gratis dengan masa aktif sesuai setting (default 30 hari)
-- 3. Catat di token_batches dan token_ledger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_masa_hari INT := 30;
    v_token_gratis INT := 3;
    v_batch_id UUID;
BEGIN
    -- Ambil setting masa berlaku dan token gratis jika ada
    SELECT COALESCE((value::text)::int, 30) INTO v_masa_hari
    FROM public.settings WHERE key = 'masa_berlaku_token_hari';
    
    SELECT COALESCE((value::text)::int, 3) INTO v_token_gratis
    FROM public.settings WHERE key = 'token_gratis_daftar';

    -- 1. Insert Profile
    INSERT INTO public.profiles (id, email, nama, is_admin)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'nama', split_part(NEW.email, '@', 1)),
        FALSE
    );

    -- 2. Insert Token Batch Gratis
    IF v_token_gratis > 0 THEN
        INSERT INTO public.token_batches (
            user_id,
            asal,
            jumlah_awal,
            sisa,
            kedaluwarsa_pada
        ) VALUES (
            NEW.id,
            'gratis',
            v_token_gratis,
            v_token_gratis,
            TIMEZONE('utc'::text, NOW()) + (v_masa_hari || ' days')::interval
        ) RETURNING id INTO v_batch_id;

        -- 3. Insert Ledger
        INSERT INTO public.token_ledger (
            user_id,
            batch_id,
            jenis,
            jumlah,
            catatan
        ) VALUES (
            NEW.id,
            v_batch_id,
            'gratis',
            v_token_gratis,
            'Bonus selamat datang (3 token gratis uji coba)'
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ====================================================================
-- 10. RPC: HITUNG SALDO TOKEN AKTIF USER
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_user_tokens(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_sisa INT := 0;
    v_earliest_exp TIMESTAMPTZ;
    v_batches JSONB;
BEGIN
    -- Hitung total sisa token yang BELUM kedaluwarsa
    SELECT 
        COALESCE(SUM(sisa), 0),
        MIN(kedaluwarsa_pada)
    INTO 
        v_total_sisa,
        v_earliest_exp
    FROM public.token_batches
    WHERE user_id = p_user_id
      AND sisa > 0
      AND kedaluwarsa_pada > TIMEZONE('utc'::text, NOW());

    -- Daftar batch aktif
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id,
        'asal', asal,
        'sisa', sisa,
        'diterima_pada', diterima_pada,
        'kedaluwarsa_pada', kedaluwarsa_pada
    ) ORDER BY kedaluwarsa_pada ASC), '[]'::jsonb)
    INTO v_batches
    FROM public.token_batches
    WHERE user_id = p_user_id
      AND sisa > 0
      AND kedaluwarsa_pada > TIMEZONE('utc'::text, NOW());

    RETURN jsonb_build_object(
        'balance', v_total_sisa,
        'earliest_expiry', v_earliest_exp,
        'batches', v_batches
    );
END;
$$;

-- ====================================================================
-- 11. RPC: POTONG TOKEN ATOMIK UNTUK DOWNLOAD DXF
-- Memotong 1 token dari batch yang paling cepat kedaluwarsa (FIFO)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.consume_token_dxf(p_project_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_batch_id UUID;
    v_sisa_batch INT;
    v_total_sisa INT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Pengguna belum masuk (Unauthorized)');
    END IF;

    -- Cari batch token yang masih aktif dan paling cepat kedaluwarsa (FOR UPDATE agar atomik)
    SELECT id, sisa
    INTO v_batch_id, v_sisa_batch
    FROM public.token_batches
    WHERE user_id = v_user_id
      AND sisa > 0
      AND kedaluwarsa_pada > TIMEZONE('utc'::text, NOW())
    ORDER BY kedaluwarsa_pada ASC
    LIMIT 1
    FOR UPDATE;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Token habis atau sudah kedaluwarsa. Silakan lakukan isi ulang token.');
    END IF;

    -- Potong 1 token
    UPDATE public.token_batches
    SET sisa = sisa - 1
    WHERE id = v_batch_id;

    -- Catat di ledger
    INSERT INTO public.token_ledger (
        user_id,
        batch_id,
        jenis,
        jumlah,
        project_id,
        catatan
    ) VALUES (
        v_user_id,
        v_batch_id,
        'pakai',
        -1,
        p_project_id,
        'Download DXF bidang tanah'
    );

    -- Hitung total sisa terbaru
    SELECT COALESCE(SUM(sisa), 0)
    INTO v_total_sisa
    FROM public.token_batches
    WHERE user_id = v_user_id
      AND sisa > 0
      AND kedaluwarsa_pada > TIMEZONE('utc'::text, NOW());

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Berhasil memotong 1 token',
        'remaining_balance', v_total_sisa
    );
END;
$$;

-- ====================================================================
-- 12. RPC ADMIN: SETUJUI TOPUP (APPROVE)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.admin_approve_topup(p_topup_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_topup RECORD;
    v_masa_hari INT := 30;
    v_batch_id UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya admin yang dapat menyetujui');
    END IF;

    SELECT * INTO v_topup
    FROM public.topups
    WHERE id = p_topup_id
    FOR UPDATE;

    IF v_topup.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Topup tidak ditemukan');
    END IF;

    IF v_topup.status != 'menunggu' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Topup ini sudah pernah diproses');
    END IF;

    -- Ambil setting masa berlaku
    SELECT COALESCE((value::text)::int, 30) INTO v_masa_hari
    FROM public.settings WHERE key = 'masa_berlaku_token_hari';

    -- Update status topup
    UPDATE public.topups
    SET status = 'disetujui',
        diputuskan_oleh = v_admin_id,
        diputuskan_pada = TIMEZONE('utc'::text, NOW())
    WHERE id = p_topup_id;

    -- Buat batch token baru
    INSERT INTO public.token_batches (
        user_id,
        asal,
        jumlah_awal,
        sisa,
        kedaluwarsa_pada
    ) VALUES (
        v_topup.user_id,
        'beli',
        v_topup.jumlah_token,
        v_topup.jumlah_token,
        TIMEZONE('utc'::text, NOW()) + (v_masa_hari || ' days')::interval
    ) RETURNING id INTO v_batch_id;

    -- Catat di ledger
    INSERT INTO public.token_ledger (
        user_id,
        batch_id,
        jenis,
        jumlah,
        topup_id,
        catatan
    ) VALUES (
        v_topup.user_id,
        v_batch_id,
        'beli',
        v_topup.jumlah_token,
        p_topup_id,
        'Top-up ' || v_topup.jumlah_token || ' token via ' || v_topup.metode || ' (Rp ' || v_topup.nominal || ')'
    );

    RETURN jsonb_build_object('success', true, 'message', 'Top-up berhasil disetujui');
END;
$$;

-- ====================================================================
-- 13. RPC ADMIN: TOLAK TOPUP (REJECT)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.admin_reject_topup(p_topup_id UUID, p_catatan TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_id UUID := auth.uid();
    v_topup RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak: Hanya admin yang dapat menolak');
    END IF;

    SELECT * INTO v_topup
    FROM public.topups
    WHERE id = p_topup_id
    FOR UPDATE;

    IF v_topup.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Topup tidak ditemukan');
    END IF;

    IF v_topup.status != 'menunggu' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Topup ini sudah pernah diproses');
    END IF;

    UPDATE public.topups
    SET status = 'ditolak',
        catatan = COALESCE(p_catatan, catatan),
        diputuskan_oleh = v_admin_id,
        diputuskan_pada = TIMEZONE('utc'::text, NOW())
    WHERE id = p_topup_id;

    RETURN jsonb_build_object('success', true, 'message', 'Top-up telah ditolak');
END;
$$;

-- ====================================================================
-- 14. STORAGE BUCKET: BUKTI PEMBAYARAN
-- Simpan foto bukti pembayaran secara privat
-- ====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('bukti-transfer', 'bukti-transfer', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Storage: User hanya bisa upload dan baca bukti miliknya
DROP POLICY IF EXISTS "User bisa upload bukti sendiri" ON storage.objects;
CREATE POLICY "User bisa upload bukti sendiri" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'bukti-transfer' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "User dan Admin bisa baca bukti" ON storage.objects;
CREATE POLICY "User dan Admin bisa baca bukti" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'bukti-transfer'
        AND (auth.uid()::text = (storage.foldername(name))[1] OR public.is_admin())
    );
