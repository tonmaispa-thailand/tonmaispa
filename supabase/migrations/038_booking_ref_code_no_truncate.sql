-- ============================================================
-- 038 — booking ref_code: never truncate past TMS-999
-- ============================================================
-- BUG (live since 001, triggered 2026-10-29 when booking_ref_seq crossed 1000):
--   NEW.ref_code := 'TMS-' || LPAD(nextval('booking_ref_seq')::text, 3, '0');
-- PostgreSQL's LPAD *truncates on the right* when the input is already longer
-- than the target length, so sequence values 1000..1009 all became 'TMS-100',
-- 1010..1019 'TMS-101', and so on. Because bookings.ref_code is UNIQUE, only
-- the first insert in each block of ten succeeded — every other booking that
-- relied on the trigger (public widget, chatbot, dashboard) failed with
-- `duplicate key value violates unique constraint "bookings_ref_code_key"`.
-- Observed for real: K2 race test produced TMS-999, then TMS-100, then six
-- duplicate-key failures in a row.
--
-- FIX: pad to a MINIMUM of 3 digits, never truncate.
--   1..999   -> TMS-001 .. TMS-999   (unchanged, existing codes untouched)
--   1000+    -> TMS-1000, TMS-1001, ... (natural widening)
-- The sequence itself is untouched; the trigger binding is preserved by
-- CREATE OR REPLACE. Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION set_booking_ref_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  IF NEW.ref_code IS NULL OR NEW.ref_code = '' THEN
    n := nextval('booking_ref_seq');
    NEW.ref_code := 'TMS-' || LPAD(n::text, GREATEST(3, length(n::text)), '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Self-check: the formatting rule, evaluated for the three regimes that matter.
DO $$
BEGIN
  ASSERT LPAD(7::text,    GREATEST(3, length(7::text)),    '0') = '007',  'pad small values to 3';
  ASSERT LPAD(999::text,  GREATEST(3, length(999::text)),  '0') = '999',  '3-digit unchanged';
  ASSERT LPAD(1000::text, GREATEST(3, length(1000::text)), '0') = '1000', 'must NOT truncate 1000';
  ASSERT LPAD(1000::text, 3, '0') = '100', 'documents the old bug: plain LPAD truncates';
END $$;
