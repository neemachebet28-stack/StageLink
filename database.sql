-- ==================================================
-- STAGELINK — DATABASE FOUNDATION (PHASE 1)
-- ==================================================
-- Scope: users, roles, organizations only.
-- Later phases will extend this schema with counties, towns,
-- stages, routes, vehicles, trips, bookings, payments, etc.
--
-- Engine: InnoDB (transactions + foreign keys required throughout
-- StageLink, especially for seat holds and bookings in later phases).
-- Charset: utf8mb4 (full Unicode support, incl. emoji in notifications).
-- ==================================================

CREATE DATABASE IF NOT EXISTS stagelink
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE stagelink;

-- Ensures this script's own multi-byte characters (Kenyan place names,
-- the en dash in route display names, etc.) are interpreted correctly
-- regardless of the client's own default charset when it runs this file.
SET NAMES utf8mb4;

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- roles
-- --------------------------------------------------
-- Fixed set of platform roles. Kept as a table (rather than an ENUM)
-- so future roles can be added without an ALTER TABLE migration on
-- every role-bearing table, and so role metadata (description) has
-- somewhere to live.
-- --------------------------------------------------
DROP TABLE IF EXISTS roles;
CREATE TABLE roles (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(30) NOT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (name, description) VALUES
  ('passenger', 'Books and manages trips as a member of the public'),
  ('operator',  'Manages a transport organization: trips, vehicles, drivers, bookings'),
  ('driver',    'Boarding staff assigned to trips; verifies tickets and marks boarding'),
  ('admin',     'Platform administrator with cross-organization oversight');

-- --------------------------------------------------
-- organizations
-- --------------------------------------------------
-- A tenant on the platform. Every operator-owned record in later
-- phases (routes, vehicles, trips, drivers, bookings, revenue...)
-- will carry an organization_id and must be scoped to it server-side.
-- --------------------------------------------------
DROP TABLE IF EXISTS organizations;
CREATE TABLE organizations (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                VARCHAR(150) NOT NULL,
  slug                VARCHAR(160) NOT NULL,
  logo_url            VARCHAR(500) DEFAULT NULL,
  description         VARCHAR(1000) DEFAULT NULL,
  contact_email       VARCHAR(255) DEFAULT NULL,
  contact_phone       VARCHAR(30) DEFAULT NULL,

  -- Never invent verification claims in the UI. This field is the
  -- single source of truth for whether an operator's verified badge
  -- is shown; it must be set by an admin action, never assumed.
  verification_status ENUM('unverified', 'pending', 'verified', 'rejected')
                        NOT NULL DEFAULT 'unverified',

  -- Soft status so an operator can be suspended without deleting
  -- its historical data (bookings, trips, payments must survive).
  status              ENUM('active', 'suspended', 'archived')
                        NOT NULL DEFAULT 'active',

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_organizations_slug (slug),
  KEY idx_organizations_verification_status (verification_status),
  KEY idx_organizations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- users
-- --------------------------------------------------
-- One account table for every role. A user's primary role is
-- role_id (set at registration and used for route/menu selection);
-- fine-grained authorization in later phases should still check the
-- specific permission needed, not just this column, especially for
-- users who belong to an organization.
--
-- organization_id is nullable: passengers and platform admins do not
-- belong to an organization; operator staff and drivers do. Phase 1
-- only establishes the relationship — operator/driver registration
-- flows arrive in a later phase.
-- --------------------------------------------------
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   INT UNSIGNED DEFAULT NULL,
  role_id           TINYINT UNSIGNED NOT NULL,

  full_name         VARCHAR(150) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  phone             VARCHAR(30) DEFAULT NULL,
  password_hash     VARCHAR(255) NOT NULL,

  status            ENUM('active', 'suspended', 'deleted')
                      NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMP NULL DEFAULT NULL,
  last_login_at     TIMESTAMP NULL DEFAULT NULL,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_organization_id (organization_id),
  KEY idx_users_role_id (role_id),
  KEY idx_users_status (status),

  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_users_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==================================================
-- PHASE 2 — KENYAN TRANSPORT NETWORK
-- ==================================================
-- Scope: counties, towns, stages, routes, destinations, and the
-- operator↔stage relationship. No vehicles, trips, seats, or bookings
-- yet — those arrive once discovery is solid.
--
-- "Operator" is not a separate table. Section 1 of the spec states
-- every transport operator/company IS an organization/tenant, and
-- the organizations table (Phase 1) already carries the operator-
-- facing fields a profile needs: name, logo_url, description,
-- contact_email, contact_phone, verification_status. A parallel
-- "operators" table would duplicate that data and create two sources
-- of truth for the same real-world entity, so routes and
-- operator_stages below both reference organizations.id directly.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- counties
-- --------------------------------------------------
-- All 47 Kenyan counties are supported by this table's shape; Phase 2
-- seeds a representative subset (see seed data below) rather than all
-- 47, since exhaustive town/stage/operator data for every county is
-- out of scope until the platform has real operator-submitted data.
-- --------------------------------------------------
DROP TABLE IF EXISTS counties;
CREATE TABLE counties (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(10) DEFAULT NULL, -- official county code, where known

  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_counties_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- towns
-- --------------------------------------------------
DROP TABLE IF EXISTS towns;
CREATE TABLE towns (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  county_id   SMALLINT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,

  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_towns_county_name (county_id, name),
  KEY idx_towns_county_id (county_id),

  CONSTRAINT fk_towns_county
    FOREIGN KEY (county_id) REFERENCES counties (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- stages
-- --------------------------------------------------
-- latitude/longitude are nullable: a stage can exist in the directory
-- before its coordinates are confirmed. Never invent coordinates for
-- a real stage — leave them NULL and let the UI show an honest empty
-- state rather than a guessed pin. Demo/seed stages below do carry
-- coordinates since they are clearly fictional/sample data.
-- --------------------------------------------------
DROP TABLE IF EXISTS stages;
CREATE TABLE stages (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  town_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(150) NOT NULL,
  landmark      VARCHAR(255) DEFAULT NULL,
  description   VARCHAR(1000) DEFAULT NULL,
  latitude      DECIMAL(10, 7) DEFAULT NULL,
  longitude     DECIMAL(10, 7) DEFAULT NULL,

  status        ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_stages_town_name (town_id, name),
  KEY idx_stages_town_id (town_id),
  KEY idx_stages_status (status),
  KEY idx_stages_coordinates (latitude, longitude),

  CONSTRAINT fk_stages_town
    FOREIGN KEY (town_id) REFERENCES towns (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- destinations
-- --------------------------------------------------
-- A named place a route can terminate at. Usually a town, but kept as
-- its own table (rather than routing straight to towns) because a
-- destination is often described more specifically than a town's
-- official name (e.g. "Kisumu - Mamboleo" vs. just "Kisumu"), and
-- because not every destination StageLink lists will have a stages
-- presence of its own yet.
-- --------------------------------------------------
DROP TABLE IF EXISTS destinations;
CREATE TABLE destinations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  town_id     INT UNSIGNED DEFAULT NULL,
  county_id   SMALLINT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  description VARCHAR(500) DEFAULT NULL,

  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_destinations_county_name (county_id, name),
  KEY idx_destinations_town_id (town_id),
  KEY idx_destinations_county_id (county_id),

  CONSTRAINT fk_destinations_town
    FOREIGN KEY (town_id) REFERENCES towns (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  CONSTRAINT fk_destinations_county
    FOREIGN KEY (county_id) REFERENCES counties (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- operator_stages
-- --------------------------------------------------
-- Operator → Stage is many-to-many: an operator usually serves
-- several stages, and a stage usually hosts several operators.
-- --------------------------------------------------
DROP TABLE IF EXISTS operator_stages;
CREATE TABLE operator_stages (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  stage_id        INT UNSIGNED NOT NULL,

  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_operator_stages (organization_id, stage_id),
  KEY idx_operator_stages_organization_id (organization_id),
  KEY idx_operator_stages_stage_id (stage_id),

  CONSTRAINT fk_operator_stages_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_operator_stages_stage
    FOREIGN KEY (stage_id) REFERENCES stages (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- routes
-- --------------------------------------------------
-- Operator → Route (organization_id), Route → Origin (origin_stage_id),
-- Route → Destination (destination_id). No schedule or vehicle here —
-- a route is the operator's standing offer ("we run Ronald Ngala to
-- Kisumu"); actual trip instances with times and vehicles are a later
-- phase.
-- --------------------------------------------------
DROP TABLE IF EXISTS routes;
CREATE TABLE routes (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   INT UNSIGNED NOT NULL,
  origin_stage_id   INT UNSIGNED NOT NULL,
  destination_id    INT UNSIGNED NOT NULL,

  name              VARCHAR(200) DEFAULT NULL, -- optional display name, e.g. "Nairobi Express"
  distance_km       DECIMAL(6, 1) DEFAULT NULL,
  typical_duration_minutes SMALLINT UNSIGNED DEFAULT NULL,
  base_fare_kes     DECIMAL(8, 2) DEFAULT NULL,

  status            ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_routes_organization_id (organization_id),
  KEY idx_routes_origin_stage_id (origin_stage_id),
  KEY idx_routes_destination_id (destination_id),
  KEY idx_routes_status (status),

  CONSTRAINT fk_routes_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_routes_origin_stage
    FOREIGN KEY (origin_stage_id) REFERENCES stages (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_routes_destination
    FOREIGN KEY (destination_id) REFERENCES destinations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 2 — DEMO DATA
-- ==================================================
-- Entirely fictional. Operator names, stage names, and contact
-- details are invented for demonstration purposes; none of this is
-- copied from a real business or person. Coordinates are approximate
-- and only intended to make the nearby-stage and map-placeholder
-- features demonstrable.
-- ==================================================

INSERT INTO counties (name, code) VALUES
  ('Nairobi', '047'),
  ('Mombasa', '001'),
  ('Kisumu', '042'),
  ('Nakuru', '032'),
  ('Uasin Gishu', '027'),
  ('Nyeri', '019');

INSERT INTO towns (county_id, name) VALUES
  ((SELECT id FROM counties WHERE name = 'Nairobi'), 'Nairobi CBD'),
  ((SELECT id FROM counties WHERE name = 'Nairobi'), 'Westlands'),
  ((SELECT id FROM counties WHERE name = 'Mombasa'), 'Mombasa Island'),
  ((SELECT id FROM counties WHERE name = 'Mombasa'), 'Likoni'),
  ((SELECT id FROM counties WHERE name = 'Kisumu'), 'Kisumu Central'),
  ((SELECT id FROM counties WHERE name = 'Nakuru'), 'Nakuru Town'),
  ((SELECT id FROM counties WHERE name = 'Uasin Gishu'), 'Eldoret Town'),
  ((SELECT id FROM counties WHERE name = 'Nyeri'), 'Nyeri Town');

INSERT INTO stages (town_id, name, landmark, description, latitude, longitude) VALUES
  ((SELECT id FROM towns WHERE name = 'Nairobi CBD'), 'Ronald Ngala Stage', 'Near Ronald Ngala Street', 'A busy stage serving upcountry routes out of the city centre.', -1.2841000, 36.8250000),
  ((SELECT id FROM towns WHERE name = 'Nairobi CBD'), 'Railways Stage', 'Opposite the Railway Museum turn-off', 'Handles a mix of long-distance and regional departures.', -1.2925000, 36.8280000),
  ((SELECT id FROM towns WHERE name = 'Westlands'), 'Westlands Stage', 'Near Sarit Centre', 'Serves routes towards the northern suburbs and beyond.', -1.2650000, 36.8020000),
  ((SELECT id FROM towns WHERE name = 'Mombasa Island'), 'Kobil Stage', 'Along Jomo Kenyatta Avenue', 'Coastal departure point for upcountry and coastal routes.', -4.0521000, 39.6636000),
  ((SELECT id FROM towns WHERE name = 'Likoni'), 'Likoni Ferry Stage', 'Near the ferry crossing', 'South coast stage close to the ferry terminal.', -4.0863000, 39.6621000),
  ((SELECT id FROM towns WHERE name = 'Kisumu Central'), 'Kisumu Bus Park', 'Off Jomo Kenyatta Highway', 'Main departure point for western Kenya routes.', -0.0917000, 34.7680000),
  ((SELECT id FROM towns WHERE name = 'Nakuru Town'), 'Nakuru Stage', 'Near the Nakuru Clock Tower', 'Central stage for Rift Valley routes.', -0.3031000, 36.0800000),
  ((SELECT id FROM towns WHERE name = 'Eldoret Town'), 'Eldoret Stage', 'Near the Eldoret Sports Club', 'Serves the North Rift and western routes.', 0.5143000, 35.2698000),
  ((SELECT id FROM towns WHERE name = 'Nyeri Town'), 'Nyeri Stage', 'Near Nyeri Town Market', 'Central Kenya stage for Mount Kenya region routes.', -0.4201000, 36.9476000);

INSERT INTO destinations (town_id, county_id, name, description) VALUES
  ((SELECT id FROM towns WHERE name = 'Nakuru Town'), (SELECT id FROM counties WHERE name = 'Nakuru'), 'Nakuru', 'Rift Valley town on the way to western Kenya.'),
  ((SELECT id FROM towns WHERE name = 'Kisumu Central'), (SELECT id FROM counties WHERE name = 'Kisumu'), 'Kisumu', 'Lakeside city on Lake Victoria.'),
  ((SELECT id FROM towns WHERE name = 'Eldoret Town'), (SELECT id FROM counties WHERE name = 'Uasin Gishu'), 'Eldoret', 'North Rift commercial hub.'),
  ((SELECT id FROM towns WHERE name = 'Nyeri Town'), (SELECT id FROM counties WHERE name = 'Nyeri'), 'Nyeri', 'Gateway town to the Mount Kenya region.'),
  ((SELECT id FROM towns WHERE name = 'Mombasa Island'), (SELECT id FROM counties WHERE name = 'Mombasa'), 'Mombasa', 'Coastal city and port.'),
  (NULL, (SELECT id FROM counties WHERE name = 'Nairobi'), 'Nairobi CBD', 'Nairobi city centre.');

INSERT INTO organizations (name, slug, description, contact_email, contact_phone, verification_status, status) VALUES
  ('Metro Shuttle Co.', 'metro-shuttle-co', 'Mid-sized fleet running daily departures between Nairobi and the Rift Valley.', 'info@metroshuttle.example', '+254700111222', 'verified', 'active'),
  ('Highland Express', 'highland-express', 'Long-established operator covering Central Kenya and the Mount Kenya region.', 'contact@highlandexpress.example', '+254700333444', 'verified', 'active'),
  ('Lakeside Travellers', 'lakeside-travellers', 'Connects Nairobi and Kisumu with a daily fleet of shuttles.', 'hello@lakesidetravellers.example', '+254700555666', 'pending', 'active'),
  ('Coastline Connect', 'coastline-connect', 'Nairobi–Mombasa route specialist with an expanding coastal network.', 'support@coastlineconnect.example', '+254700777888', 'unverified', 'active'),
  ('North Rift Voyagers', 'north-rift-voyagers', 'Serves Eldoret and the wider North Rift from Nairobi.', 'info@northriftvoyagers.example', '+254700999000', 'verified', 'active');

INSERT INTO operator_stages (organization_id, stage_id) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage')),
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM stages WHERE name = 'Nakuru Stage')),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), (SELECT id FROM stages WHERE name = 'Railways Stage')),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), (SELECT id FROM stages WHERE name = 'Nyeri Stage')),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage')),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), (SELECT id FROM stages WHERE name = 'Kisumu Bus Park')),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), (SELECT id FROM stages WHERE name = 'Railways Stage')),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), (SELECT id FROM stages WHERE name = 'Kobil Stage')),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), (SELECT id FROM stages WHERE name = 'Westlands Stage')),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), (SELECT id FROM stages WHERE name = 'Eldoret Stage'));

INSERT INTO routes (organization_id, origin_stage_id, destination_id, name, distance_km, typical_duration_minutes, base_fare_kes) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage'), (SELECT id FROM destinations WHERE name = 'Nakuru'), 'Nairobi – Nakuru', 158.0, 150, 600.00),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), (SELECT id FROM stages WHERE name = 'Railways Stage'), (SELECT id FROM destinations WHERE name = 'Nyeri'), 'Nairobi – Nyeri', 150.0, 150, 500.00),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage'), (SELECT id FROM destinations WHERE name = 'Kisumu'), 'Nairobi – Kisumu', 342.0, 330, 1200.00),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), (SELECT id FROM stages WHERE name = 'Railways Stage'), (SELECT id FROM destinations WHERE name = 'Mombasa'), 'Nairobi – Mombasa', 485.0, 480, 1500.00),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), (SELECT id FROM stages WHERE name = 'Westlands Stage'), (SELECT id FROM destinations WHERE name = 'Eldoret'), 'Nairobi – Eldoret', 312.0, 300, 1100.00),
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM stages WHERE name = 'Nakuru Stage'), (SELECT id FROM destinations WHERE name = 'Eldoret'), 'Nakuru – Eldoret', 158.0, 150, 500.00);

-- ==================================================
-- PHASE 3 — TRIPS AND DEPARTURE STATUS
-- ==================================================
-- Scope: vehicles, vehicle seat layouts, drivers, trips, and the
-- trip-level seat instances needed to compute real occupancy.
--
-- "seats" here are per-trip, not a separate booking system: they are
-- generated from a vehicle's seat layout when a trip is created, and
-- exist so trip occupancy is a real COUNT(...) over actual rows
-- rather than an assumed or hard-coded number. Holding/booking a
-- specific seat for a specific passenger (seat_holds, bookings,
-- payments) is a later phase — this phase only needs seats to exist
-- and carry a status.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- vehicle_seat_layouts
-- --------------------------------------------------
-- A reusable seat-map template an operator defines once and assigns
-- to one or more vehicles in their fleet.
-- --------------------------------------------------
DROP TABLE IF EXISTS vehicle_seat_layouts;
CREATE TABLE vehicle_seat_layouts (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   INT UNSIGNED NOT NULL,
  name              VARCHAR(120) NOT NULL,
  total_seats       TINYINT UNSIGNED NOT NULL,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_seat_layouts_org_name (organization_id, name),
  KEY idx_seat_layouts_organization_id (organization_id),

  CONSTRAINT fk_seat_layouts_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- seat_layout_seats
-- --------------------------------------------------
-- The individual seat positions that make up a layout template.
-- --------------------------------------------------
DROP TABLE IF EXISTS seat_layout_seats;
CREATE TABLE seat_layout_seats (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  seat_layout_id    INT UNSIGNED NOT NULL,
  seat_number       VARCHAR(10) NOT NULL,
  seat_row        TINYINT UNSIGNED NOT NULL,
  seat_type         ENUM('window', 'middle', 'aisle') NOT NULL DEFAULT 'aisle',

  PRIMARY KEY (id),
  UNIQUE KEY uq_layout_seat_number (seat_layout_id, seat_number),
  KEY idx_layout_seats_layout_id (seat_layout_id),

  CONSTRAINT fk_layout_seats_layout
    FOREIGN KEY (seat_layout_id) REFERENCES vehicle_seat_layouts (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- vehicles
-- --------------------------------------------------
DROP TABLE IF EXISTS vehicles;
CREATE TABLE vehicles (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     INT UNSIGNED NOT NULL,
  seat_layout_id      INT UNSIGNED NOT NULL,

  registration_number VARCHAR(20) NOT NULL,
  vehicle_type        VARCHAR(60) DEFAULT NULL, -- e.g. "14-seater matatu", "33-seater shuttle"
  make_model          VARCHAR(100) DEFAULT NULL,

  status              ENUM('active', 'maintenance', 'inactive') NOT NULL DEFAULT 'active',

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_registration (registration_number),
  KEY idx_vehicles_organization_id (organization_id),
  KEY idx_vehicles_seat_layout_id (seat_layout_id),
  KEY idx_vehicles_status (status),

  CONSTRAINT fk_vehicles_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_vehicles_seat_layout
    FOREIGN KEY (seat_layout_id) REFERENCES vehicle_seat_layouts (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- drivers
-- --------------------------------------------------
-- user_id is nullable and unused until driver login exists (a later
-- phase) — kept here now so that phase doesn't need a schema change
-- to link a driver profile to a login account.
-- --------------------------------------------------
DROP TABLE IF EXISTS drivers;
CREATE TABLE drivers (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id     INT UNSIGNED NOT NULL,
  user_id             INT UNSIGNED DEFAULT NULL,

  full_name           VARCHAR(150) NOT NULL,
  phone               VARCHAR(30) DEFAULT NULL,
  license_number      VARCHAR(40) DEFAULT NULL,

  status              ENUM('active', 'inactive') NOT NULL DEFAULT 'active',

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_drivers_organization_id (organization_id),
  KEY idx_drivers_user_id (user_id),
  KEY idx_drivers_status (status),

  CONSTRAINT fk_drivers_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_drivers_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- trips
-- --------------------------------------------------
-- origin_stage_id and destination_id are snapshotted from the route
-- at trip-creation time (in addition to route_id) rather than always
-- joined through the route, so that if a route's definition changes
-- later, trips that already ran keep their original, historically
-- accurate origin/destination.
--
-- departure_policy mirrors the three policies in the spec (fixed,
-- flexible window, occupancy-dependent). It informs how the UI
-- explains the schedule to passengers; it does not, by itself,
-- change status automatically — status changes are recorded as
-- explicit operator/system actions, never inferred from occupancy.
-- --------------------------------------------------
DROP TABLE IF EXISTS trips;
CREATE TABLE trips (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id       INT UNSIGNED NOT NULL,
  route_id              INT UNSIGNED NOT NULL,
  origin_stage_id       INT UNSIGNED NOT NULL,
  destination_id        INT UNSIGNED NOT NULL,
  vehicle_id            INT UNSIGNED NOT NULL,
  driver_id             INT UNSIGNED DEFAULT NULL,

  departure_policy      ENUM('fixed', 'flexible_window', 'occupancy_dependent')
                          NOT NULL DEFAULT 'fixed',
  scheduled_departure   DATETIME NOT NULL,
  estimated_departure   DATETIME DEFAULT NULL,
  confirmed_departure   DATETIME DEFAULT NULL,

  fare_kes              DECIMAL(8, 2) NOT NULL,

  status                ENUM(
                          'scheduled', 'filling', 'confirmed',
                          'boarding', 'departed', 'arrived', 'cancelled'
                        ) NOT NULL DEFAULT 'scheduled',

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_trips_organization_id (organization_id),
  KEY idx_trips_route_id (route_id),
  KEY idx_trips_origin_stage_id (origin_stage_id),
  KEY idx_trips_destination_id (destination_id),
  KEY idx_trips_vehicle_id (vehicle_id),
  KEY idx_trips_driver_id (driver_id),
  KEY idx_trips_status (status),
  KEY idx_trips_scheduled_departure (scheduled_departure),

  CONSTRAINT fk_trips_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_trips_route
    FOREIGN KEY (route_id) REFERENCES routes (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_trips_origin_stage
    FOREIGN KEY (origin_stage_id) REFERENCES stages (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_trips_destination
    FOREIGN KEY (destination_id) REFERENCES destinations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_trips_vehicle
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_trips_driver
    FOREIGN KEY (driver_id) REFERENCES drivers (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- seats
-- --------------------------------------------------
-- Trip-level seat instances, generated from the assigned vehicle's
-- seat layout when a trip is created. This phase only ever sets
-- status via direct operator/seed action — seat holds and passenger
-- booking (the AVAILABLE → HELD → BOOKED lifecycle) are a later
-- phase, but the column already carries the full set of states from
-- the spec so that phase is additive, not a schema rewrite.
-- --------------------------------------------------
DROP TABLE IF EXISTS seats;
CREATE TABLE seats (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  trip_id       INT UNSIGNED NOT NULL,
  seat_number   VARCHAR(10) NOT NULL,
  seat_type     ENUM('window', 'middle', 'aisle') NOT NULL DEFAULT 'aisle',

  status        ENUM('available', 'held', 'booked', 'reserved', 'disabled')
                  NOT NULL DEFAULT 'available',

  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_seats_trip_seat_number (trip_id, seat_number),
  KEY idx_seats_trip_id (trip_id),
  KEY idx_seats_status (status),

  CONSTRAINT fk_seats_trip
    FOREIGN KEY (trip_id) REFERENCES trips (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 3 — DEMO DATA
-- ==================================================
-- Fictional operator staff accounts, vehicles, drivers, and trips.
-- Demo login credentials (all share one password so they're easy to
-- test with) — clearly fictional, not real people or businesses:
--   ops@metroshuttle.example      / Password123!
--   ops@highlandexpress.example   / Password123!
--   ops@lakesidetravellers.example/ Password123!
--   ops@coastlineconnect.example  / Password123!
--   ops@northriftvoyagers.example / Password123!
-- ==================================================

-- One operator-role login per seeded organization.
INSERT INTO users (organization_id, role_id, full_name, email, phone, password_hash) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM roles WHERE name = 'operator'), 'Metro Shuttle Ops', 'ops@metroshuttle.example', '+254700111000', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), (SELECT id FROM roles WHERE name = 'operator'), 'Highland Express Ops', 'ops@highlandexpress.example', '+254700111001', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), (SELECT id FROM roles WHERE name = 'operator'), 'Lakeside Travellers Ops', 'ops@lakesidetravellers.example', '+254700111002', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), (SELECT id FROM roles WHERE name = 'operator'), 'Coastline Connect Ops', 'ops@coastlineconnect.example', '+254700111003', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), (SELECT id FROM roles WHERE name = 'operator'), 'North Rift Voyagers Ops', 'ops@northriftvoyagers.example', '+254700111004', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe');

-- Seat layouts: a standard 14-seater matatu layout (rows 1-4, row 1 is
-- the front bench with 3 seats incl. driver's row companions, rows
-- 2-4 have 4 seats each — 3+4+4+3 = 14) reused across operators.
INSERT INTO vehicle_seat_layouts (organization_id, name, total_seats) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), '14-Seater Standard', 14),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), '14-Seater Standard', 14),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), '33-Seater Shuttle', 33),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), '14-Seater Standard', 14),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), '14-Seater Standard', 14);

-- Seat positions for each 14-seater layout (same shape, seeded per
-- layout since layouts are organization-owned).
INSERT INTO seat_layout_seats (seat_layout_id, seat_number, seat_row, seat_type)
SELECT vsl.id, seat_data.seat_number, seat_data.seat_row, seat_data.seat_type
FROM vehicle_seat_layouts vsl
CROSS JOIN (
  SELECT '1' AS seat_number, 1 AS seat_row, 'window' AS seat_type
  UNION ALL SELECT '2', 1, 'middle'
  UNION ALL SELECT '3', 1, 'window'
  UNION ALL SELECT '4', 2, 'window'
  UNION ALL SELECT '5', 2, 'middle'
  UNION ALL SELECT '6', 2, 'middle'
  UNION ALL SELECT '7', 2, 'window'
  UNION ALL SELECT '8', 3, 'window'
  UNION ALL SELECT '9', 3, 'middle'
  UNION ALL SELECT '10', 3, 'middle'
  UNION ALL SELECT '11', 3, 'window'
  UNION ALL SELECT '12', 4, 'window'
  UNION ALL SELECT '13', 4, 'middle'
  UNION ALL SELECT '14', 4, 'window'
) AS seat_data
WHERE vsl.name = '14-Seater Standard';

-- Seat positions for the 33-seater shuttle (11 rows of 3).
INSERT INTO seat_layout_seats (seat_layout_id, seat_number, seat_row, seat_type)
SELECT vsl.id,
       CONCAT(n.seat_row, col.letter) AS seat_number,
       n.seat_row,
       col.seat_type
FROM vehicle_seat_layouts vsl
CROSS JOIN (
  SELECT 1 AS seat_row UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
  UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11
) AS n
CROSS JOIN (
  SELECT 'A' AS letter, 'window' AS seat_type
  UNION ALL SELECT 'B', 'middle'
  UNION ALL SELECT 'C', 'window'
) AS col
WHERE vsl.name = '33-Seater Shuttle';

-- Vehicles, one or two per operator, each assigned that operator's layout.
INSERT INTO vehicles (organization_id, seat_layout_id, registration_number, vehicle_type, make_model) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'),
   (SELECT id FROM vehicle_seat_layouts WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'metro-shuttle-co')),
   'KDA 101M', '14-seater matatu', 'Toyota Hiace'),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'),
   (SELECT id FROM vehicle_seat_layouts WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'highland-express')),
   'KDB 202H', '14-seater matatu', 'Nissan NV350'),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'),
   (SELECT id FROM vehicle_seat_layouts WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'lakeside-travellers')),
   'KDC 303L', '33-seater shuttle', 'Isuzu NQR'),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'),
   (SELECT id FROM vehicle_seat_layouts WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'coastline-connect')),
   'KDD 404C', '14-seater matatu', 'Toyota Hiace'),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'),
   (SELECT id FROM vehicle_seat_layouts WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'north-rift-voyagers')),
   'KDE 505N', '14-seater matatu', 'Toyota Hiace');

-- Drivers, one per operator.
INSERT INTO drivers (organization_id, full_name, phone, license_number) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), 'Peter Mwangi', '+254711100001', 'DL-MS-1001'),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), 'James Kariuki', '+254711100002', 'DL-HE-1002'),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), 'Brian Otieno', '+254711100003', 'DL-LT-1003'),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), 'Ali Bakari', '+254711100004', 'DL-CC-1004'),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), 'Kevin Kiprop', '+254711100005', 'DL-NRV-1005');

-- Trips: a spread of statuses/timings so the discovery UI and the
-- operator dashboard both have something real to show. Departures are
-- relative to NOW() so the demo stays realistic (always "upcoming")
-- whenever this file is loaded.
INSERT INTO trips (organization_id, route_id, origin_stage_id, destination_id, vehicle_id, driver_id, departure_policy, scheduled_departure, estimated_departure, fare_kes, status) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'),
   (SELECT id FROM routes WHERE name = 'Nairobi – Nakuru'),
   (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage'),
   (SELECT id FROM destinations WHERE name = 'Nakuru'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDA 101M'),
   (SELECT id FROM drivers WHERE license_number = 'DL-MS-1001'),
   'flexible_window', DATE_ADD(NOW(), INTERVAL 90 MINUTE), NULL, 600.00, 'filling'),

  ((SELECT id FROM organizations WHERE slug = 'highland-express'),
   (SELECT id FROM routes WHERE name = 'Nairobi – Nyeri'),
   (SELECT id FROM stages WHERE name = 'Railways Stage'),
   (SELECT id FROM destinations WHERE name = 'Nyeri'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDB 202H'),
   (SELECT id FROM drivers WHERE license_number = 'DL-HE-1002'),
   'fixed', DATE_ADD(NOW(), INTERVAL 45 MINUTE), DATE_ADD(NOW(), INTERVAL 45 MINUTE), 500.00, 'confirmed'),

  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'),
   (SELECT id FROM routes WHERE name = 'Nairobi – Kisumu'),
   (SELECT id FROM stages WHERE name = 'Ronald Ngala Stage'),
   (SELECT id FROM destinations WHERE name = 'Kisumu'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDC 303L'),
   (SELECT id FROM drivers WHERE license_number = 'DL-LT-1003'),
   'occupancy_dependent', DATE_ADD(NOW(), INTERVAL 3 HOUR), NULL, 1200.00, 'scheduled'),

  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'),
   (SELECT id FROM routes WHERE name = 'Nairobi – Mombasa'),
   (SELECT id FROM stages WHERE name = 'Railways Stage'),
   (SELECT id FROM destinations WHERE name = 'Mombasa'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDD 404C'),
   (SELECT id FROM drivers WHERE license_number = 'DL-CC-1004'),
   'fixed', DATE_ADD(NOW(), INTERVAL 15 MINUTE), DATE_ADD(NOW(), INTERVAL 15 MINUTE), 1500.00, 'boarding'),

  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'),
   (SELECT id FROM routes WHERE name = 'Nairobi – Eldoret'),
   (SELECT id FROM stages WHERE name = 'Westlands Stage'),
   (SELECT id FROM destinations WHERE name = 'Eldoret'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDE 505N'),
   (SELECT id FROM drivers WHERE license_number = 'DL-NRV-1005'),
   'fixed', DATE_ADD(NOW(), INTERVAL 5 HOUR), NULL, 1100.00, 'scheduled'),

  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'),
   (SELECT id FROM routes WHERE name = 'Nakuru – Eldoret'),
   (SELECT id FROM stages WHERE name = 'Nakuru Stage'),
   (SELECT id FROM destinations WHERE name = 'Eldoret'),
   (SELECT id FROM vehicles WHERE registration_number = 'KDA 101M'),
   (SELECT id FROM drivers WHERE license_number = 'DL-MS-1001'),
   'fixed', DATE_ADD(NOW(), INTERVAL 6 HOUR), NULL, 500.00, 'scheduled');

-- Generate seats for every trip from its vehicle's seat layout, all
-- available by default.
INSERT INTO seats (trip_id, seat_number, seat_type, status)
SELECT t.id, sls.seat_number, sls.seat_type, 'available'
FROM trips t
JOIN vehicles v ON v.id = t.vehicle_id
JOIN seat_layout_seats sls ON sls.seat_layout_id = v.seat_layout_id;

-- Mark a realistic spread of seats already taken, so the discovery UI
-- demonstrates real (non-zero) occupancy without a booking engine.
-- These are direct demo-data seat statuses, not simulated bookings —
-- the app computes occupancy from these real rows the same way it
-- will once the booking engine exists.
UPDATE seats s
JOIN trips t ON t.id = s.trip_id
JOIN routes r ON r.id = t.route_id
SET s.status = 'booked'
WHERE r.name = 'Nairobi – Nakuru' AND s.seat_number IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11');

UPDATE seats s
JOIN trips t ON t.id = s.trip_id
JOIN routes r ON r.id = t.route_id
SET s.status = 'booked'
WHERE r.name = 'Nairobi – Nyeri' AND s.seat_number IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13');

UPDATE seats s
JOIN trips t ON t.id = s.trip_id
JOIN routes r ON r.id = t.route_id
SET s.status = 'booked'
WHERE r.name = 'Nairobi – Kisumu' AND s.seat_number IN ('1A', '1B', '1C', '2A', '2B');

UPDATE seats s
JOIN trips t ON t.id = s.trip_id
JOIN routes r ON r.id = t.route_id
SET s.status = 'booked'
WHERE r.name = 'Nairobi – Mombasa' AND s.seat_number IN ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14');

UPDATE seats s
JOIN trips t ON t.id = s.trip_id
JOIN routes r ON r.id = t.route_id
SET s.status = 'booked'
WHERE r.name = 'Nairobi – Eldoret' AND s.seat_number IN ('1', '2', '3');

-- ==================================================
-- PHASE 4 — SEAT MANAGEMENT AND BOOKING ENGINE
-- ==================================================
-- Scope: seat_holds and bookings. `seats` already exists (Phase 3).
--
-- Passenger accounts don't exist yet (still deferred — see README),
-- so holds and bookings are tied to the browser's session ID
-- (express-session) rather than a users row. Both tables carry a
-- nullable user_id so that once passenger login exists, ownership can
-- move from session_id to user_id without a schema rewrite — the
-- same forward-compatible pattern used for drivers.user_id in Phase 3.
--
-- "Only one active hold/booking per seat" is enforced by transaction
-- logic (SELECT ... FOR UPDATE on the seat row, then checking its
-- status) rather than a DB constraint, because MySQL has no portable
-- partial/filtered unique index — a seat legitimately has many
-- historical hold/booking rows over time (expired, released,
-- cancelled), just never more than one *active* one, and that
-- invariant is what the seat's own status column represents.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- seat_holds
-- --------------------------------------------------
DROP TABLE IF EXISTS seat_holds;
CREATE TABLE seat_holds (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  trip_id       INT UNSIGNED NOT NULL,
  seat_id       INT UNSIGNED NOT NULL,
  session_id    VARCHAR(64) NOT NULL,
  user_id       INT UNSIGNED DEFAULT NULL,

  expires_at    DATETIME NOT NULL,
  status        ENUM('active', 'expired', 'released', 'converted')
                  NOT NULL DEFAULT 'active',

  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_seat_holds_trip_id (trip_id),
  KEY idx_seat_holds_seat_id (seat_id),
  KEY idx_seat_holds_session_id (session_id),
  KEY idx_seat_holds_status (status),
  KEY idx_seat_holds_expires_at (expires_at),

  CONSTRAINT fk_seat_holds_trip
    FOREIGN KEY (trip_id) REFERENCES trips (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_seat_holds_seat
    FOREIGN KEY (seat_id) REFERENCES seats (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_seat_holds_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- bookings
-- --------------------------------------------------
-- organization_id, origin_stage_id, destination_id, and fare_kes are
-- snapshotted from the trip/route at booking time — a booking must
-- stay historically accurate (and correctly attributed for operator
-- revenue reporting) even if the trip or route it came from is later
-- edited. booking_reference groups the rows created together in one
-- checkout (a passenger can book several seats at once).
--
-- status starts at 'pending' — this phase stops at a created booking
-- awaiting payment; M-Pesa (the next state transition) is explicitly
-- out of scope here.
-- --------------------------------------------------
DROP TABLE IF EXISTS bookings;
CREATE TABLE bookings (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_reference    VARCHAR(20) NOT NULL,

  organization_id     INT UNSIGNED NOT NULL,
  trip_id             INT UNSIGNED NOT NULL,
  seat_id             INT UNSIGNED NOT NULL,
  origin_stage_id     INT UNSIGNED NOT NULL,
  destination_id      INT UNSIGNED NOT NULL,

  session_id          VARCHAR(64) NOT NULL,
  user_id             INT UNSIGNED DEFAULT NULL,
  passenger_name      VARCHAR(150) NOT NULL,
  passenger_phone     VARCHAR(30) NOT NULL,

  fare_kes            DECIMAL(8, 2) NOT NULL,
  status              ENUM(
                        'pending', 'held', 'payment_pending', 'confirmed',
                        'cancelled', 'expired', 'completed'
                      ) NOT NULL DEFAULT 'pending',

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_bookings_reference (booking_reference),
  KEY idx_bookings_organization_id (organization_id),
  KEY idx_bookings_trip_id (trip_id),
  KEY idx_bookings_seat_id (seat_id),
  KEY idx_bookings_session_id (session_id),
  KEY idx_bookings_status (status),

  CONSTRAINT fk_bookings_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_bookings_trip
    FOREIGN KEY (trip_id) REFERENCES trips (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_bookings_seat
    FOREIGN KEY (seat_id) REFERENCES seats (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_bookings_origin_stage
    FOREIGN KEY (origin_stage_id) REFERENCES stages (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_bookings_destination
    FOREIGN KEY (destination_id) REFERENCES destinations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_bookings_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 5 — M-PESA PAYMENT INTEGRATION
-- ==================================================
-- Scope: the payments table, plus a payment_due_at column on bookings
-- so "payment after booking expiry" is something the server can
-- actually check, not just a phrase. Ticket/QR generation is not
-- built this phase — see README for why and what's already in place
-- for it.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- A booking must be paid within a window of being created, or the
-- seat should free up for someone else. This column existed nowhere
-- before Phase 5 because nothing needed to expire a booking until
-- payment entered the picture.
ALTER TABLE bookings ADD COLUMN payment_due_at DATETIME NULL AFTER fare_kes;
UPDATE bookings SET payment_due_at = DATE_ADD(created_at, INTERVAL 15 MINUTE) WHERE payment_due_at IS NULL;
ALTER TABLE bookings MODIFY COLUMN payment_due_at DATETIME NOT NULL;
ALTER TABLE bookings ADD KEY idx_bookings_payment_due_at (payment_due_at);

-- --------------------------------------------------
-- payments
-- --------------------------------------------------
-- One payment attempt = one row. A booking_reference can have several
-- rows over time (a failed attempt followed by a successful retry);
-- checkout_request_id is unique because Daraja guarantees it's unique
-- per STK push and it is this table's idempotency key for processing
-- the callback — a duplicate callback for the same
-- checkout_request_id is recognized and ignored rather than double
-- -applied (see models/payments.js).
--
-- amount_kes is only ever computed server-side from the bookings'
-- own fare_kes at initiation time — nothing here accepts an amount
-- from the client.
-- --------------------------------------------------
DROP TABLE IF EXISTS payments;
CREATE TABLE payments (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_reference     VARCHAR(20) NOT NULL,
  organization_id       INT UNSIGNED NOT NULL,
  session_id            VARCHAR(64) NOT NULL,

  phone_number          VARCHAR(15) NOT NULL,
  amount_kes            DECIMAL(10, 2) NOT NULL,
  provider              VARCHAR(20) NOT NULL DEFAULT 'mpesa',

  status                ENUM('pending', 'processing', 'success', 'failed', 'cancelled')
                          NOT NULL DEFAULT 'pending',

  merchant_request_id   VARCHAR(60) DEFAULT NULL,
  checkout_request_id   VARCHAR(60) DEFAULT NULL,
  mpesa_receipt_number  VARCHAR(30) DEFAULT NULL,
  result_code           INT DEFAULT NULL,
  result_desc           VARCHAR(255) DEFAULT NULL,

  initiated_at          DATETIME DEFAULT NULL,
  completed_at          DATETIME DEFAULT NULL,

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_checkout_request_id (checkout_request_id),
  KEY idx_payments_booking_reference (booking_reference),
  KEY idx_payments_organization_id (organization_id),
  KEY idx_payments_session_id (session_id),
  KEY idx_payments_status (status),

  CONSTRAINT fk_payments_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 6 — DIGITAL TICKETING
-- ==================================================
-- Scope: tickets, qr_verification_records, boarding_records.
--
-- A ticket is 1:1 with a booking (one seat = one ticket = one QR
-- code), generated only from inside the verified-payment-success
-- transaction (models/tickets.js's generateTicketsForReference is
-- called from models/payments.js processCallback, in the same
-- transaction that confirms the bookings) — never speculatively, and
-- never from anything the browser asserts.
--
-- qr_code_token is a random opaque value distinct from the
-- human-readable ticket_number: the token is what's embedded in the
-- QR code and is what a scan looks up, so it needs real entropy
-- rather than being guessable from a booking reference.
--
-- "Verify tickets at boarding with a scan" is an operator capability
-- per the master spec (section 19) — this phase does not add a
-- separate driver login; verification is done by the same
-- operator-role accounts from Phase 3, scoped to their own
-- organization's tickets. Driver-specific login stays deferred (see
-- README).
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- tickets
-- --------------------------------------------------
DROP TABLE IF EXISTS tickets;
CREATE TABLE tickets (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id        INT UNSIGNED NOT NULL,
  ticket_number     VARCHAR(30) NOT NULL,
  qr_code_token     VARCHAR(64) NOT NULL,

  status            ENUM('valid', 'boarded', 'cancelled', 'expired') NOT NULL DEFAULT 'valid',

  issued_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_booking_id (booking_id),
  UNIQUE KEY uq_tickets_ticket_number (ticket_number),
  UNIQUE KEY uq_tickets_qr_code_token (qr_code_token),
  KEY idx_tickets_status (status),

  CONSTRAINT fk_tickets_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- qr_verification_records
-- --------------------------------------------------
-- Every scan attempt is logged, including ones that don't resolve to
-- a real ticket (ticket_id is nullable for exactly that case) —
-- scanned_token preserves what was actually scanned either way, for
-- an audit trail of both legitimate use and attempted misuse.
-- --------------------------------------------------
DROP TABLE IF EXISTS qr_verification_records;
CREATE TABLE qr_verification_records (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id           INT UNSIGNED DEFAULT NULL,
  scanned_token        VARCHAR(64) NOT NULL,
  organization_id     INT UNSIGNED NOT NULL,
  scanned_by_user_id  INT UNSIGNED NOT NULL,

  scan_result         ENUM('valid', 'already_boarded', 'invalid', 'expired', 'cancelled', 'wrong_operator')
                        NOT NULL,

  scanned_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_qr_records_ticket_id (ticket_id),
  KEY idx_qr_records_organization_id (organization_id),
  KEY idx_qr_records_scanned_by (scanned_by_user_id),

  CONSTRAINT fk_qr_records_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  CONSTRAINT fk_qr_records_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_qr_records_user
    FOREIGN KEY (scanned_by_user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- boarding_records
-- --------------------------------------------------
-- Separate from qr_verification_records because a ticket can be
-- scanned (re-verified) more than once, but boarded at most once —
-- the unique key on ticket_id is what makes reuse of a boarded ticket
-- structurally impossible, not just a status check.
-- --------------------------------------------------
DROP TABLE IF EXISTS boarding_records;
CREATE TABLE boarding_records (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id           INT UNSIGNED NOT NULL,
  trip_id             INT UNSIGNED NOT NULL,
  boarded_by_user_id  INT UNSIGNED NOT NULL,
  boarded_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_boarding_records_ticket_id (ticket_id),
  KEY idx_boarding_records_trip_id (trip_id),
  KEY idx_boarding_records_boarded_by (boarded_by_user_id),

  CONSTRAINT fk_boarding_records_ticket
    FOREIGN KEY (ticket_id) REFERENCES tickets (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_boarding_records_trip
    FOREIGN KEY (trip_id) REFERENCES trips (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_boarding_records_user
    FOREIGN KEY (boarded_by_user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 8 — DRIVER AND BOARDING STAFF
-- ==================================================
-- Scope: no new tables — drivers.user_id (Phase 3) and the ROLES.DRIVER
-- role (Phase 1) already existed for exactly this. This phase links
-- each seeded driver to a real login account and builds the
-- driver-facing portal on top of that existing schema.
-- ==================================================

-- One driver-role login per seeded driver, then link it back via
-- drivers.user_id. Same demo password as the operator accounts:
--   driver@metroshuttle.example      / Password123!
--   driver@highlandexpress.example   / Password123!
--   driver@lakesidetravellers.example/ Password123!
--   driver@coastlineconnect.example  / Password123!
--   driver@northriftvoyagers.example / Password123!
INSERT INTO users (organization_id, role_id, full_name, email, phone, password_hash) VALUES
  ((SELECT id FROM organizations WHERE slug = 'metro-shuttle-co'), (SELECT id FROM roles WHERE name = 'driver'), 'Peter Mwangi', 'driver@metroshuttle.example', '+254711100001', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'highland-express'), (SELECT id FROM roles WHERE name = 'driver'), 'James Kariuki', 'driver@highlandexpress.example', '+254711100002', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'lakeside-travellers'), (SELECT id FROM roles WHERE name = 'driver'), 'Brian Otieno', 'driver@lakesidetravellers.example', '+254711100003', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'coastline-connect'), (SELECT id FROM roles WHERE name = 'driver'), 'Ali Bakari', 'driver@coastlineconnect.example', '+254711100004', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe'),
  ((SELECT id FROM organizations WHERE slug = 'north-rift-voyagers'), (SELECT id FROM roles WHERE name = 'driver'), 'Kevin Kiprop', 'driver@northriftvoyagers.example', '+254711100005', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe');

UPDATE drivers d
JOIN users u ON u.organization_id = d.organization_id AND u.role_id = (SELECT id FROM roles WHERE name = 'driver')
SET d.user_id = u.id
WHERE d.license_number IN ('DL-MS-1001', 'DL-HE-1002', 'DL-LT-1003', 'DL-CC-1004', 'DL-NRV-1005');

-- ==================================================
-- PHASE 9 — GROUP AND EVENT TRANSPORT
-- ==================================================
-- group_requests are deliberately NOT organization-scoped at creation —
-- a passenger's request is visible to every operator so any of them
-- can quote on it, unlike everything else in this schema which is
-- owned by exactly one tenant. group_quotations is where tenancy
-- re-enters: one row per operator's offer against a request.
--
-- Origin/destination are free text here (origin_text/destination_text),
-- not FKs into stages/destinations — group/event transport is often
-- to or from a venue that isn't a matatu stage (a school, a wedding
-- venue), unlike the rest of the app's stage-to-stage model. Optional
-- county FKs exist only so operators can filter requests by region.
--
-- group_bookings is created only once a passenger accepts a
-- quotation, and deliberately reuses the exact same booking_reference
-- scheme, payment_due_at expiry pattern, and payments table as
-- individual seat bookings — see models/payments.js. Group charters
-- go through the identical PENDING→PROCESSING→SUCCESS payment state
-- machine, not a parallel or shortened one.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------
-- group_requests
-- --------------------------------------------------
DROP TABLE IF EXISTS group_requests;
CREATE TABLE group_requests (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_reference     VARCHAR(20) NOT NULL,
  session_id            VARCHAR(64) NOT NULL,

  passenger_name        VARCHAR(150) NOT NULL,
  passenger_phone       VARCHAR(30) NOT NULL,
  passenger_email       VARCHAR(255) DEFAULT NULL,

  passenger_count       SMALLINT UNSIGNED NOT NULL,
  origin_text           VARCHAR(255) NOT NULL,
  origin_county_id      SMALLINT UNSIGNED DEFAULT NULL,
  destination_text      VARCHAR(255) NOT NULL,
  destination_county_id SMALLINT UNSIGNED DEFAULT NULL,

  travel_date           DATE NOT NULL,
  departure_time        TIME DEFAULT NULL,
  return_date           DATE DEFAULT NULL,
  return_time           TIME DEFAULT NULL,

  vehicle_requirements  VARCHAR(500) DEFAULT NULL,
  budget_kes            DECIMAL(10, 2) DEFAULT NULL,
  notes                 VARCHAR(1000) DEFAULT NULL,

  status                ENUM('open', 'accepted', 'completed', 'cancelled') NOT NULL DEFAULT 'open',

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_group_requests_reference (request_reference),
  KEY idx_group_requests_session_id (session_id),
  KEY idx_group_requests_status (status),
  KEY idx_group_requests_origin_county (origin_county_id),
  KEY idx_group_requests_destination_county (destination_county_id),

  CONSTRAINT fk_group_requests_origin_county
    FOREIGN KEY (origin_county_id) REFERENCES counties (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  CONSTRAINT fk_group_requests_destination_county
    FOREIGN KEY (destination_county_id) REFERENCES counties (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- group_quotations
-- --------------------------------------------------
DROP TABLE IF EXISTS group_quotations;
CREATE TABLE group_quotations (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_request_id  INT UNSIGNED NOT NULL,
  organization_id   INT UNSIGNED NOT NULL,

  price_kes         DECIMAL(10, 2) NOT NULL,
  vehicle_details   VARCHAR(255) DEFAULT NULL,
  notes             VARCHAR(1000) DEFAULT NULL,

  status            ENUM('pending', 'accepted', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_group_quotations_request_org (group_request_id, organization_id),
  KEY idx_group_quotations_request_id (group_request_id),
  KEY idx_group_quotations_organization_id (organization_id),
  KEY idx_group_quotations_status (status),

  CONSTRAINT fk_group_quotations_request
    FOREIGN KEY (group_request_id) REFERENCES group_requests (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_group_quotations_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------
-- group_bookings
-- --------------------------------------------------
-- Created the moment a passenger accepts a quotation, status
-- 'pending' — same "created, awaiting payment" starting point as
-- individual bookings, with its own payment_due_at expiry window.
-- --------------------------------------------------
DROP TABLE IF EXISTS group_bookings;
CREATE TABLE group_bookings (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_reference     VARCHAR(20) NOT NULL,

  group_request_id      INT UNSIGNED NOT NULL,
  group_quotation_id    INT UNSIGNED NOT NULL,
  organization_id       INT UNSIGNED NOT NULL,
  session_id            VARCHAR(64) NOT NULL,

  passenger_name        VARCHAR(150) NOT NULL,
  passenger_phone       VARCHAR(30) NOT NULL,
  passenger_count       SMALLINT UNSIGNED NOT NULL,
  agreed_price_kes      DECIMAL(10, 2) NOT NULL,

  payment_due_at        DATETIME NOT NULL,
  status                ENUM('pending', 'confirmed', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_group_bookings_reference (booking_reference),
  UNIQUE KEY uq_group_bookings_quotation (group_quotation_id),
  KEY idx_group_bookings_organization_id (organization_id),
  KEY idx_group_bookings_session_id (session_id),
  KEY idx_group_bookings_status (status),
  KEY idx_group_bookings_payment_due_at (payment_due_at),

  CONSTRAINT fk_group_bookings_request
    FOREIGN KEY (group_request_id) REFERENCES group_requests (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_group_bookings_quotation
    FOREIGN KEY (group_quotation_id) REFERENCES group_quotations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_group_bookings_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 10 — NOTIFICATION SYSTEM
-- ==================================================
-- One table serves every audience. Operators and drivers have user
-- accounts; passengers do not (still deferred), so a recipient is
-- identified by recipient_key: 'user:<id>' or 'session:<id>'. Passenger
-- notifications therefore live only as long as their browser session —
-- a known limitation until passenger accounts exist.
--
-- (recipient_key, dedupe_key) is UNIQUE: every event carries a
-- deterministic dedupe key (e.g. 'trip:12:cancelled'), so a repeated
-- callback, a re-saved form, or a sweep that runs again can never
-- produce a second copy. This is the structural guard behind "avoid
-- excessive notifications" — not a best-effort check.
--
-- Notifications are a convenience layer, never a source of truth: they
-- are written after the underlying event has committed, and a failure
-- to write one never rolls back or blocks the event itself.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS notifications;
CREATE TABLE notifications (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_key    VARCHAR(80) NOT NULL,
  user_id          INT UNSIGNED DEFAULT NULL,
  organization_id  INT UNSIGNED DEFAULT NULL,

  type             ENUM(
                     'booking_confirmation', 'payment_success', 'payment_failure',
                     'seat_hold_expiry', 'upcoming_departure', 'trip_status_change',
                     'confirmed_departure', 'cancellation', 'group_quotation_update',
                     'ticket_ready', 'boarding_confirmation'
                   ) NOT NULL,
  title            VARCHAR(150) NOT NULL,
  message          VARCHAR(500) NOT NULL,
  action_url       VARCHAR(300) DEFAULT NULL,
  action_label     VARCHAR(60) DEFAULT NULL,
  dedupe_key       VARCHAR(150) NOT NULL,

  read_at          DATETIME DEFAULT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_recipient_dedupe (recipient_key, dedupe_key),
  KEY idx_notifications_recipient_created (recipient_key, created_at),
  KEY idx_notifications_recipient_unread (recipient_key, read_at),
  KEY idx_notifications_created_at (created_at),

  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==================================================
-- PHASE 11 — ADMIN PLATFORM
-- ==================================================
-- Two new tables. Everything else this phase needs (users,
-- organizations, counties/towns/stages, routes, vehicles, drivers,
-- trips, bookings, payments, group_requests, notifications) already
-- exists — the admin platform is mostly a genuine, cross-tenant read
-- surface over data built in earlier phases, plus a few carefully
-- audited write actions (verification status, suspension, review
-- moderation).
--
-- Subscriptions has no schema here: the master spec never details a
-- billing model (tiers, pricing, a payment relationship between
-- operator and platform) the way it does for every other feature, and
-- inventing one from nothing would be exactly the fabricated
-- functionality this project avoids elsewhere. Its nav page says so
-- plainly — see routes/admin.js.
-- ==================================================

SET FOREIGN_KEY_CHECKS = 0;

-- details is a JSON string of whatever changed (old/new values) —
-- kept as TEXT for portability; it is written once and only displayed.
DROP TABLE IF EXISTS audit_logs;
CREATE TABLE audit_logs (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id   INT UNSIGNED NOT NULL,
  action          VARCHAR(100) NOT NULL,
  target_type     VARCHAR(50) NOT NULL,
  target_id       INT UNSIGNED DEFAULT NULL,
  details         TEXT DEFAULT NULL,

  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_audit_logs_actor (actor_user_id),
  KEY idx_audit_logs_target (target_type, target_id),
  KEY idx_audit_logs_created_at (created_at),

  CONSTRAINT fk_audit_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One review per booking (UNIQUE), only ever created for a booking
-- whose status is 'completed' — enforced in models/reviews.js, not just
-- by the form. bookings.status reaches 'completed' only when its trip
-- is marked 'arrived' (see completeBookingsForArrivedTrip, wired into
-- both the operator and driver trip-status routes), so a review always
-- corresponds to a trip that actually happened.
DROP TABLE IF EXISTS reviews;
CREATE TABLE reviews (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id      INT UNSIGNED NOT NULL,
  trip_id         INT UNSIGNED NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  session_id      VARCHAR(64) NOT NULL,

  rating          TINYINT UNSIGNED NOT NULL,
  comment         VARCHAR(1000) DEFAULT NULL,
  status          ENUM('published', 'hidden', 'flagged') NOT NULL DEFAULT 'published',

  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_booking (booking_id),
  KEY idx_reviews_organization_id (organization_id),
  KEY idx_reviews_status (status),

  CONSTRAINT fk_reviews_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_reviews_trip
    FOREIGN KEY (trip_id) REFERENCES trips (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_reviews_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Demo platform administrator:  admin@stagelink.example / Password123!
INSERT INTO users (organization_id, role_id, full_name, email, phone, password_hash) VALUES
  (NULL, (SELECT id FROM roles WHERE name = 'admin'), 'StageLink Admin', 'admin@stagelink.example', '+254700000100', '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe');

-- ==================================================
-- PHASE 14 — SECURITY AND DATA INTEGRITY AUDIT
-- ==================================================
-- sessions:         persistent session store (replaces the in-memory
--                   store: survives restarts, no unbounded memory growth)
-- security_events:  login failures/lockouts, CSRF rejections, rate-limit
--                   hits, access denials, callback anomalies — the
--                   security-relevant events that aren't admin actions
--                   (those stay in audit_logs). user_id is nullable
--                   because most of these events are anonymous.
-- payments.needs_review: set when money and booking state disagree
--                   (amount mismatch, paid-but-unconfirmable) so an
--                   admin can reconcile instead of it being lost.
-- ==================================================
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE payments ADD COLUMN needs_review TINYINT(1) NOT NULL DEFAULT 0 AFTER result_desc;

DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  sid         VARCHAR(128) NOT NULL,
  data        MEDIUMTEXT NOT NULL,
  expires_at  DATETIME NOT NULL,
  PRIMARY KEY (sid),
  KEY idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS security_events;
CREATE TABLE security_events (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type  VARCHAR(60) NOT NULL,
  user_id     INT UNSIGNED DEFAULT NULL,
  ip          VARCHAR(64) DEFAULT NULL,
  details     VARCHAR(500) DEFAULT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_security_events_type (event_type, created_at),
  KEY idx_security_events_created_at (created_at),
  CONSTRAINT fk_security_events_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
