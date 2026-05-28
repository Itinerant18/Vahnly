CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_state_enum') THEN
        CREATE TYPE driver_state_enum AS ENUM ('ONLINE_AVAILABLE', 'ONLINE_EN_ROUTE', 'ONLINE_DELIVERING', 'OFFLINE', 'BUSY_BATCH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
        CREATE TYPE order_status_enum AS ENUM ('CREATED', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'DELIVERING', 'COMPLETED', 'CANCELLED');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS regional_cities (
    city_prefix VARCHAR(10) PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata' NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    geofence GEOGRAPHY(MultiPolygon, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
    name VARCHAR(100) DEFAULT 'Unknown' NOT NULL,
    phone VARCHAR(15),
    dl_number VARCHAR(50),
    current_state driver_state_enum DEFAULT 'OFFLINE' NOT NULL,
    is_verified BOOLEAN DEFAULT false NOT NULL,
    acceptance_rate NUMERIC(4,3) DEFAULT 1.000 NOT NULL,
    cancellation_rate NUMERIC(4,3) DEFAULT 0.000 NOT NULL,
    cancellation_probability NUMERIC(4,3) DEFAULT 0.000 NOT NULL,
    last_known_location GEOGRAPHY(Point, 4326),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
    customer_id UUID DEFAULT gen_random_uuid() NOT NULL,
    status order_status_enum DEFAULT 'CREATED' NOT NULL,
    pickup_location GEOGRAPHY(Point, 4326) NOT NULL,
    dropoff_location GEOGRAPHY(Point, 4326) NOT NULL,
    pickup_h3_cell VARCHAR(15) NOT NULL,
    pickup_osm_node_id BIGINT,
    assigned_driver_id UUID REFERENCES drivers(id),
    surge_multiplier NUMERIC(3,2) DEFAULT 1.00 NOT NULL,
    base_fare_paise INT NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE,
    picked_up_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatch_match_logs (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID REFERENCES orders(id) NOT NULL,
    batch_window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    batch_window_ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
    algorithm_used VARCHAR(50) NOT NULL,
    total_candidates_evaluated INT NOT NULL,
    chosen_driver_id UUID REFERENCES drivers(id) NOT NULL,
    computed_eta_seconds INT NOT NULL,
    assignment_score NUMERIC(10,4) NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cities_geofence ON regional_cities USING GIST(geofence);
CREATE INDEX IF NOT EXISTS idx_drivers_state_location ON drivers(current_state) INCLUDE (id, last_known_location);
CREATE INDEX IF NOT EXISTS idx_orders_matching_fence ON orders(status, city_prefix) WHERE status = 'CREATED'::order_status_enum;
