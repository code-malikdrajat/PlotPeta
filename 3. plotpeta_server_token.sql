-- PlotPeta: fungsi token untuk Edge Function export-dxf.
-- Jalankan SETELAH plotpeta_security_fix.sql. Belum diuji di Postgres, coba dulu di proyek uji.
BEGIN;

-- Dipanggil HANYA oleh server (service_role): potong 1 token milik p_user_id.
CREATE OR REPLACE FUNCTION public.server_consume_token(p_user_id UUID, p_project_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_batch UUID; v_ledger UUID; v_total INT;
BEGIN
  SELECT id INTO v_batch FROM public.token_batches
  WHERE user_id = p_user_id AND sisa > 0 AND kedaluwarsa_pada > now()
  ORDER BY kedaluwarsa_pada LIMIT 1 FOR UPDATE;
  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Token habis atau sudah kedaluwarsa. Silakan lakukan isi ulang token.');
  END IF;
  UPDATE public.token_batches SET sisa = sisa - 1 WHERE id = v_batch;
  INSERT INTO public.token_ledger (user_id, batch_id, jenis, jumlah, project_id, catatan)
  VALUES (p_user_id, v_batch, 'pakai', -1, p_project_id, 'Download DXF bidang tanah')
  RETURNING id INTO v_ledger;
  SELECT COALESCE(SUM(sisa), 0) INTO v_total FROM public.token_batches
  WHERE user_id = p_user_id AND sisa > 0 AND kedaluwarsa_pada > now();
  RETURN jsonb_build_object('success', true, 'ledger_id', v_ledger, 'remaining_balance', v_total);
END $$;

-- Dipanggil HANYA oleh server: kembalikan 1 token dari satu catatan pemakaian (hanya sekali).
CREATE OR REPLACE FUNCTION public.server_refund_token(p_ledger_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.token_ledger WHERE id = p_ledger_id AND jenis = 'pakai' FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Catatan pemakaian tidak ditemukan');
  END IF;
  IF EXISTS (SELECT 1 FROM public.token_ledger WHERE jenis = 'kembali' AND catatan = 'refund:' || p_ledger_id::text) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Token sudah pernah dikembalikan');
  END IF;
  UPDATE public.token_batches
  SET sisa = sisa + 1, kedaluwarsa_pada = GREATEST(kedaluwarsa_pada, now() + interval '1 day')
  WHERE id = r.batch_id;
  INSERT INTO public.token_ledger (user_id, batch_id, jenis, jumlah, catatan)
  VALUES (r.user_id, r.batch_id, 'kembali', 1, 'refund:' || p_ledger_id::text);
  RETURN jsonb_build_object('success', true, 'message', 'Token dikembalikan');
END $$;

REVOKE EXECUTE ON FUNCTION public.server_consume_token(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.server_refund_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_consume_token(uuid, uuid), public.server_refund_token(uuid) TO service_role;

-- Pengguna tidak lagi memotong token sendiri dari browser. DXF hanya keluar lewat Edge Function.
REVOKE EXECUTE ON FUNCTION public.consume_token_dxf(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
