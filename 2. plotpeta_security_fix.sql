-- PlotPeta: perbaikan keamanan dari hasil pemeriksaan.
-- Jalankan SEKALI di Supabase Dashboard > SQL Editor, SETELAH skema dan migrasi yang sudah ada.
-- Catatan: skrip ini belum diuji di Postgres. Coba dulu di proyek Supabase uji atau database cabang.
BEGIN;

-- 1. PROFILES: pengguna hanya boleh mengubah kolom nama.
--    Sebelumnya pengguna bisa mengubah is_admin miliknya sendiri menjadi true.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (nama) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "User bisa update profil sendiri" ON public.profiles;
CREATE POLICY "User bisa update profil sendiri" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2. TOPUPS: nilai penting ditentukan server, bukan dikirim klien.
CREATE OR REPLACE FUNCTION public.topups_force_values()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_harga INT;
BEGIN
  v_harga := COALESCE((SELECT (value::text)::int FROM public.settings WHERE key = 'harga_paket_50'), 100000);
  NEW.user_id := auth.uid();
  NEW.paket := '50_token';
  NEW.jumlah_token := 50;
  NEW.status := 'menunggu';
  NEW.diputuskan_oleh := NULL;
  NEW.diputuskan_pada := NULL;
  IF NEW.kode_unik IS NULL OR NEW.kode_unik < 0 OR NEW.kode_unik > 999 THEN NEW.kode_unik := 0; END IF;
  NEW.nominal := v_harga + NEW.kode_unik;
  IF NEW.metode NOT IN ('qris','transfer_bank','ewallet','transfer_bank_lain') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid';
  END IF;
  IF NEW.bukti_url IS NULL OR NEW.bukti_url !~ ('^' || auth.uid()::text || '/[0-9]+_bukti\.[A-Za-z0-9]{1,5}$') THEN
    RAISE EXCEPTION 'Bukti pembayaran tidak valid';
  END IF;
  NEW.catatan := left(NEW.catatan, 500);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS topups_force_values_trg ON public.topups;
CREATE TRIGGER topups_force_values_trg BEFORE INSERT ON public.topups
  FOR EACH ROW EXECUTE FUNCTION public.topups_force_values();

-- 3. get_user_tokens: hanya pemilik atau admin yang boleh membaca saldo.
CREATE OR REPLACE FUNCTION public.get_user_tokens(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total INT := 0; v_exp TIMESTAMPTZ; v_batches JSONB;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  SELECT COALESCE(SUM(sisa),0), MIN(kedaluwarsa_pada) INTO v_total, v_exp
  FROM public.token_batches
  WHERE user_id = p_user_id AND sisa > 0 AND kedaluwarsa_pada > now();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'asal',asal,'sisa',sisa,
         'diterima_pada',diterima_pada,'kedaluwarsa_pada',kedaluwarsa_pada) ORDER BY kedaluwarsa_pada), '[]'::jsonb)
  INTO v_batches FROM public.token_batches
  WHERE user_id = p_user_id AND sisa > 0 AND kedaluwarsa_pada > now();
  RETURN jsonb_build_object('balance', v_total, 'earliest_expiry', v_exp, 'batches', v_batches);
END $$;

-- 4. search_path tetap untuk semua fungsi SECURITY DEFINER lainnya.
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.consume_token_dxf(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_approve_topup(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_reject_topup(uuid, text) SET search_path = public, pg_temp;

-- 5. Fungsi token hanya untuk pengguna yang sudah masuk (bukan anonim).
REVOKE EXECUTE ON FUNCTION public.get_user_tokens(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.consume_token_dxf(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_approve_topup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_topup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tokens(uuid), public.consume_token_dxf(uuid),
  public.admin_approve_topup(uuid), public.admin_reject_topup(uuid, text) TO authenticated;

-- 6. Pendaftaran tidak gagal bila pengaturan token terhapus.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_masa_hari INT; v_token_gratis INT; v_batch_id UUID;
BEGIN
  v_masa_hari := COALESCE((SELECT (value::text)::int FROM public.settings WHERE key = 'masa_berlaku_token_hari'), 30);
  v_token_gratis := COALESCE((SELECT (value::text)::int FROM public.settings WHERE key = 'token_gratis_daftar'), 3);
  INSERT INTO public.profiles (id, email, nama, is_admin)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name',
             NEW.raw_user_meta_data->>'nama', split_part(NEW.email,'@',1)), FALSE)
  ON CONFLICT (id) DO NOTHING;
  IF v_token_gratis > 0 THEN
    INSERT INTO public.token_batches (user_id, asal, jumlah_awal, sisa, kedaluwarsa_pada)
    VALUES (NEW.id, 'gratis', v_token_gratis, v_token_gratis, now() + (v_masa_hari || ' days')::interval)
    RETURNING id INTO v_batch_id;
    INSERT INTO public.token_ledger (user_id, batch_id, jenis, jumlah, catatan)
    VALUES (NEW.id, v_batch_id, 'gratis', v_token_gratis, 'Bonus selamat datang (token gratis uji coba)');
  END IF;
  RETURN NEW;
END $$;

-- 7. PROJECTS: tegakkan batas 5 MB per proyek dan 20 proyek per akun di database.
CREATE OR REPLACE FUNCTION public.projects_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.ukuran := octet_length(NEW.data::text);
  IF NEW.ukuran > 5242880 THEN RAISE EXCEPTION 'Proyek melebihi batas 5 MB'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM public.projects WHERE user_id = NEW.user_id) >= 20 THEN
      RAISE EXCEPTION 'Batas 20 proyek per akun tercapai';
    END IF;
  ELSE
    NEW.user_id := OLD.user_id;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_guard_trg ON public.projects;
CREATE TRIGGER projects_guard_trg BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_guard();
DROP POLICY IF EXISTS "User kelola proyek sendiri" ON public.projects;
CREATE POLICY "User kelola proyek sendiri" ON public.projects
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 8. Bucket bukti transfer: batasi ukuran dan jenis file.
UPDATE storage.buckets SET file_size_limit = 2621440, allowed_mime_types = ARRAY['image/jpeg','image/png']
WHERE id = 'bukti-transfer';

-- 9. KOREKSI TOKEN ADMIN lewat fungsi atomik (admin.html perlu memanggil ini, bukan insert langsung).
CREATE OR REPLACE FUNCTION public.admin_koreksi_token(
  p_user_id UUID, p_jumlah INT, p_hari INT DEFAULT 30, p_catatan TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_batch UUID; v_perlu INT; v_ambil INT; r RECORD; v_cat TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Akses ditolak');
  END IF;
  IF p_jumlah IS NULL OR p_jumlah = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jumlah tidak valid');
  END IF;
  v_cat := left(COALESCE(NULLIF(trim(p_catatan), ''), 'Koreksi manual admin'), 300);
  IF p_jumlah > 0 THEN
    IF p_hari IS NULL OR p_hari < 1 OR p_hari > 3650 THEN p_hari := 30; END IF;
    INSERT INTO public.token_batches (user_id, asal, jumlah_awal, sisa, kedaluwarsa_pada)
    VALUES (p_user_id, 'koreksi', p_jumlah, p_jumlah, now() + (p_hari || ' days')::interval)
    RETURNING id INTO v_batch;
    INSERT INTO public.token_ledger (user_id, batch_id, jenis, jumlah, catatan)
    VALUES (p_user_id, v_batch, 'koreksi', p_jumlah, v_cat);
  ELSE
    v_perlu := -p_jumlah;
    FOR r IN SELECT id, sisa FROM public.token_batches
             WHERE user_id = p_user_id AND sisa > 0 AND kedaluwarsa_pada > now()
             ORDER BY kedaluwarsa_pada FOR UPDATE LOOP
      EXIT WHEN v_perlu <= 0;
      v_ambil := LEAST(r.sisa, v_perlu);
      UPDATE public.token_batches SET sisa = sisa - v_ambil WHERE id = r.id;
      INSERT INTO public.token_ledger (user_id, batch_id, jenis, jumlah, catatan)
      VALUES (p_user_id, r.id, 'koreksi', -v_ambil, v_cat);
      v_perlu := v_perlu - v_ambil;
    END LOOP;
    IF v_perlu > 0 THEN
      RAISE EXCEPTION 'Saldo pengguna kurang % token', v_perlu;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'message', 'Koreksi token berhasil');
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_koreksi_token(uuid, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_koreksi_token(uuid, int, int, text) TO authenticated;

COMMIT;

-- PEMERIKSAAN SETELAH MENJALANKAN (jalankan terpisah):
-- 1) Daftar admin, pastikan hanya akunmu:
--    SELECT id, email, is_admin FROM public.profiles WHERE is_admin;
-- 2) Cari permintaan isi ulang yang janggal (jumlah_token bukan 50):
--    SELECT id, user_id, jumlah_token, nominal, status FROM public.topups WHERE jumlah_token <> 50 OR status <> 'menunggu';
-- 3) Cari kelompok token yang mencurigakan:
--    SELECT * FROM public.token_batches WHERE asal = 'koreksi' OR jumlah_awal > 50 ORDER BY diterima_pada DESC;
