-- Phase 3 · route assignment for live devices
-- Adds an optional school-route id so a paired live bus can be placed on one
-- of the dashboard's six routes (stop-based ETA, snap-to-route, attendance).
-- Idempotent.

ALTER TABLE live_devices ADD COLUMN IF NOT EXISTS route_id TEXT;