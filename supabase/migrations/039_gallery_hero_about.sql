-- ============================================================
-- TON MAI SPA — Hero slideshow + About photo picked from the Gallery
-- Run this manually in the Supabase SQL Editor (click once so NOTHING is
-- highlighted, then Run — the editor runs only a highlighted selection).
--
-- Until now the homepage hero slideshow (8 photos) and the About photo were
-- hardcoded in the components. These columns let the owner pick them from
-- the dashboard Gallery page instead:
--   hero_order  1..10 = shown in the hero slideshow in that order, NULL = not in hero
--   is_about    exactly one photo at most is the About photo
--   about_align which side to keep when the About photo is cropped
--
-- Behavioural no-op on its own: every existing row gets hero_order NULL /
-- is_about false, and the site falls back to the built-in hero slides and
-- About photo until the owner actually picks something.
--
-- Selection is written through two functions (one transaction each) so a
-- reorder can never be left half-applied, and the 10-photo hero cap is also
-- enforced by the database (CHECK 1..10 + UNIQUE on hero_order).
-- ============================================================

ALTER TABLE gallery_photos
  ADD COLUMN IF NOT EXISTS hero_order  int,
  ADD COLUMN IF NOT EXISTS is_about    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS about_align text    NOT NULL DEFAULT 'center';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gallery_photos_hero_order_check') THEN
    ALTER TABLE gallery_photos
      ADD CONSTRAINT gallery_photos_hero_order_check CHECK (hero_order IS NULL OR hero_order BETWEEN 1 AND 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gallery_photos_about_align_check') THEN
    ALTER TABLE gallery_photos
      ADD CONSTRAINT gallery_photos_about_align_check CHECK (about_align IN ('left', 'center', 'right'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS gallery_photos_hero_order_uniq ON gallery_photos (hero_order) WHERE hero_order IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gallery_photos_one_about       ON gallery_photos ((true))     WHERE is_about;

-- Replace the whole hero selection with p_ids (ordered). Empty array clears it.
CREATE OR REPLACE FUNCTION set_gallery_hero(p_ids uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n int := coalesce(array_length(p_ids, 1), 0);
BEGIN
  -- Serialise concurrent callers: two overlapping reorders would otherwise race
  -- on the unique index and the loser would surface a raw 23505 error.
  PERFORM pg_advisory_xact_lock(hashtext('gallery_hero_about'));
  IF n > 10 THEN RAISE EXCEPTION 'HERO_LIMIT: at most 10 hero photos'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_ids) AS x) <> n THEN RAISE EXCEPTION 'HERO_DUPLICATE: a photo was listed twice'; END IF;
  UPDATE gallery_photos SET hero_order = NULL WHERE hero_order IS NOT NULL;
  UPDATE gallery_photos g SET hero_order = o.ord::int
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord) WHERE g.id = o.id;
  IF (SELECT count(*) FROM gallery_photos WHERE hero_order IS NOT NULL) <> n THEN
    RAISE EXCEPTION 'HERO_UNKNOWN_ID: a photo id does not exist';
  END IF;
END $$;

-- Make p_id the About photo (or clear it when p_id is NULL).
CREATE OR REPLACE FUNCTION set_gallery_about(p_id uuid, p_align text DEFAULT 'center') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('gallery_hero_about'));
  UPDATE gallery_photos SET is_about = false WHERE is_about;
  IF p_id IS NOT NULL THEN
    UPDATE gallery_photos SET is_about = true, about_align = p_align WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ABOUT_UNKNOWN_ID: photo does not exist'; END IF;
  END IF;
END $$;

-- Supabase's default privileges grant EXECUTE on new public functions straight to
-- anon / authenticated (not via PUBLIC), so revoking from PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION set_gallery_hero(uuid[])        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_gallery_about(uuid, text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_gallery_hero(uuid[])      TO service_role;
GRANT EXECUTE ON FUNCTION set_gallery_about(uuid, text) TO service_role;
