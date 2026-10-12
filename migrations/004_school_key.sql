-- Phase 7 · per-school Google Maps API key.
-- Applies AFTER 003_schools.sql. Idempotent.
--
-- The column stays nullable at the DB level (legacy rows exist); presence is
-- enforced by the application (onboarding + settings both require a key).
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS google_maps_api_key text;
