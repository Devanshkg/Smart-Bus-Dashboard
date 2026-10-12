-- Phase 6 · school accounts & per-school isolation
-- Adds schools + membership, ties live devices to a school, and moves the
-- route/stop templates into per-school tables. Idempotent.
--
-- Applies AFTER 001_live_tracking.sql and 002_route_assignment.sql.
-- The neon_auth schema is owned by Neon Auth and is left untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS schools (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_id is the Neon Auth JWT "sub" claim.
CREATE TABLE IF NOT EXISTS school_members (
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  role       text NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);

CREATE INDEX IF NOT EXISTS school_members_user_idx ON school_members (user_id);

-- Devices created before auth have no school and stay hidden until re-paired.
ALTER TABLE live_devices
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS live_devices_school_idx ON live_devices (school_id);

CREATE TABLE IF NOT EXISTS routes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code       text NOT NULL,          -- 'R1'..'R6'
  name       text NOT NULL,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE TABLE IF NOT EXISTS stops (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq      int  NOT NULL,
  name     text NOT NULL,
  lat      double precision NOT NULL,
  lng      double precision NOT NULL,
  traffic  text,                     -- traffic hint for the segment STARTING here
  UNIQUE (route_id, seq)
);

-- ---------------------------------------------------------------------------
-- Seed the existing Stonehill demo so the current dashboard keeps working.
-- Fixed school id keeps this seed idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO schools (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Stonehill International School')
ON CONFLICT (id) DO NOTHING;

-- Route + stop templates for Stonehill (from data.js).
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R1', 'Whitefield', '#0B5FD9')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'Whitefield', 12.9698, 77.7499, 'green'),
    (1, 'Hope Farm Junction', 12.978, 77.752, 'yellow'),
    (2, 'Kadugodi', 12.999, 77.76, 'green'),
    (3, 'Seegehalli', 13.022, 77.774, 'yellow'),
    (4, 'Budigere Cross', 13.046, 77.744, 'yellow'),
    (5, 'Hunasamaranahalli', 13.1445, 77.595, 'yellow'),
    (6, 'Jala Hobli Office', 13.162, 77.5955, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R1'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R2', 'Sarjapur Road', '#7C3AED')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'Sarjapur Road', 12.9063, 77.6822, 'green'),
    (1, 'Kaikondrahalli', 12.914, 77.68, 'green'),
    (2, 'Bellandur', 12.926, 77.676, 'yellow'),
    (3, 'Devarabisanahalli', 12.931, 77.678, 'yellow'),
    (4, 'Marathahalli Bridge', 12.955, 77.698, 'red'),
    (5, 'KR Puram', 12.9716, 77.5946, 'yellow'),
    (6, 'Bommenahalli', 13.1535, 77.5948, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R2'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R3', 'Marathahalli', '#DC2626')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'Marathahalli', 12.9562, 77.7019, 'red'),
    (1, 'Brookefield', 12.966, 77.716, 'red'),
    (2, 'Varthur', 12.939, 77.735, 'yellow'),
    (3, 'Whitefield Main Road', 12.9698, 77.7499, 'yellow'),
    (4, 'ITPL', 12.979, 77.71, 'green'),
    (5, 'KR Puram', 12.9716, 77.5946, 'yellow'),
    (6, 'Bommenahalli', 13.1535, 77.5948, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R3'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R4', 'Indiranagar', '#0D9488')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'Indiranagar', 12.9719, 77.6412, 'green'),
    (1, 'CMH Road', 12.978, 77.638, 'yellow'),
    (2, 'Domlur', 12.962, 77.638, 'yellow'),
    (3, 'HAL Airport Road', 12.951, 77.668, 'yellow'),
    (4, 'Marathahalli', 12.9562, 77.7019, 'yellow'),
    (5, 'Bommenahalli', 13.1535, 77.5948, 'green'),
    (6, 'Jala Hobli Office', 13.162, 77.5955, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R4'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R5', 'KR Puram', '#EA580C')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'KR Puram', 12.9716, 77.5946, 'green'),
    (1, 'Mahadevapura', 12.991, 77.686, 'yellow'),
    (2, 'Benniganahalli', 12.995, 77.661, 'yellow'),
    (3, 'OAR Junction', 13.011, 77.554, 'yellow'),
    (4, 'Nagavara', 13.043, 77.626, 'yellow'),
    (5, 'Hennur Cross', 13.04, 77.655, 'green'),
    (6, 'Bommenahalli', 13.1535, 77.5948, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R5'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
INSERT INTO routes (school_id, code, name, color) VALUES ('11111111-1111-1111-1111-111111111111', 'R6', 'Electronic City', '#DB2777')
  ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
INSERT INTO stops (route_id, seq, name, lat, lng, traffic)
  SELECT r.id, v.seq, v.name, v.lat, v.lng, v.traffic
  FROM routes r, (VALUES
    (0, 'Electronic City Phase 1', 12.844, 77.66, 'green'),
    (1, 'Electronic City Phase 2', 12.83, 77.69, 'yellow'),
    (2, 'Silk Board', 12.9177, 77.6227, 'yellow'),
    (3, 'BTM Layout', 12.9166, 77.6101, 'yellow'),
    (4, 'Koramangala', 12.9352, 77.6245, 'yellow'),
    (5, 'Domlur', 12.962, 77.638, 'green'),
    (6, 'Bommenahalli', 13.1535, 77.5948, 'green'),
    (7, 'Stonehill School', 13.170998, 77.596295, NULL)
  ) AS v(seq, name, lat, lng, traffic)
  WHERE r.school_id = '11111111-1111-1111-1111-111111111111' AND r.code = 'R6'
  ON CONFLICT (route_id, seq) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, traffic = EXCLUDED.traffic;
