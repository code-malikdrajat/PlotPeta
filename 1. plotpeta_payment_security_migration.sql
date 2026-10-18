-- PlotPeta: migrasi pemisahan informasi pembayaran + bucket QRIS.
-- Jalankan di Supabase Dashboard > SQL Editor setelah skema awal.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_settings (
  key TEXT PRIMARY KEY CHECK (key = 'main'),
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

-- Pindahkan data rekening lama sebelum menghapusnya dari settings internal.
INSERT INTO public.payment_settings (key, value)
SELECT 'main', value FROM public.settings WHERE key = 'rekening_info'
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Semua user bisa membaca settings" ON public.settings;
DROP POLICY IF EXISTS "Hanya admin bisa update settings" ON public.settings;
DROP POLICY IF EXISTS "Hanya admin boleh mengelola settings internal" ON public.settings;
CREATE POLICY "Hanya admin boleh mengelola settings internal" ON public.settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Informasi pembayaran dapat dibaca publik" ON public.payment_settings;
CREATE POLICY "Informasi pembayaran dapat dibaca publik" ON public.payment_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Hanya admin boleh mengubah informasi pembayaran" ON public.payment_settings;
CREATE POLICY "Hanya admin boleh mengubah informasi pembayaran" ON public.payment_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DELETE FROM public.settings WHERE key = 'rekening_info';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('qris', 'qris', true, 2097152, ARRAY['image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg','image/png'];

DROP POLICY IF EXISTS "Admin upload QRIS resmi" ON storage.objects;
CREATE POLICY "Admin upload QRIS resmi" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'qris' AND public.is_admin());
DROP POLICY IF EXISTS "Admin ganti QRIS resmi" ON storage.objects;
CREATE POLICY "Admin ganti QRIS resmi" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'qris' AND public.is_admin())
  WITH CHECK (bucket_id = 'qris' AND public.is_admin());
DROP POLICY IF EXISTS "Admin hapus QRIS resmi" ON storage.objects;
CREATE POLICY "Admin hapus QRIS resmi" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'qris' AND public.is_admin());

COMMIT;
