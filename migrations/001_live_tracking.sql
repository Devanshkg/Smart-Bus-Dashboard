-- Phase 1 · live-device tracking schema
-- Run in order; idempotent.

CREATE TABLE IF NOT EXISTS live_devices (
  code       TEXT PRIMARY KEY,          -- 6-char pairing code
  token      TEXT NOT NULL,             -- device secret (QR / URL param)
  label      TEXT NOT NULL,             -- e.g. "Bus 7"
  color      TEXT,                      -- marker colour hex
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ                -- NULL until first fix
);

CREATE TABLE IF NOT EXISTS live_positions (
  device_code TEXT NOT NULL REFERENCES live_devices(code) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading     REAL,
  speed       REAL,                     -- m/s
  accuracy    REAL,                     -- meters
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_positions_dev_ts
  ON live_positions (device_code, ts DESC);