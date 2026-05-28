-- ============================================================================
-- 1. EXTENSION & TYPE INITIALIZATION
-- ============================================================================

-- Enable PostGIS for high-performance geographic coordinate math
CREATE EXTENSION IF NOT EXISTS postgis;

-- Define the strict Driver State Machine enum
CREATE TYPE driver_state_enum AS ENUM (
    'ONLINE_AVAILABLE',
    'ONLINE_EN_ROUTE',
    'ONLINE_DELIVERING',
    'OFFLINE',
    'BUSY_BATCH'
);

-- Define the strict Order Lifecycle State Machine enum
CREATE TYPE order_status_enum AS ENUM (
    'CREATED',
    'ASSIGNED',
    'EN_ROUTE_TO_PICKUP',
    'DELIVERING',
    'COMPLETED',
    'CANCELLED'
);

-- ============================================================================
-- 2. CORE OPERATIONAL TABLES
-- ============================================================================

-- Regions / Cities Configuration Table
CREATE TABLE IF NOT EXISTS regional_cities (
    city_prefix VARCHAR(10) PRIMARY KEY, -- e.g., 'KOL', 'DEL', 'MUM'
    city_name VARCHAR(100) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata' NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    -- PostGIS MultiPolygon representing the strict geofenced boundary of the city
    geofence GEOGRAPHY(MultiPolygon, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Drivers Profile and Persistent State Table
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    dl_number VARCHAR(50) UNIQUE NOT NULL,
    osm_node_id BIGINT DEFAULT 9999 NOT NULL,
    current_state driver_state_enum DEFAULT 'OFFLINE' NOT NULL,
    is_verified BOOLEAN DEFAULT false NOT NULL,
    acceptance_rate NUMERIC(4,3) DEFAULT 1.000 NOT NULL, -- Metric for optimization matrix
    cancellation_rate NUMERIC(4,3) DEFAULT 0.000 NOT NULL,
    -- PostGIS point tracking last known verified location (fallback storage)
    last_known_location GEOGRAPHY(Point, 4326),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Orders / Trips Table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_prefix VARCHAR(10) REFERENCES regional_cities(city_prefix) NOT NULL,
    customer_id UUID NOT NULL,
    status order_status_enum DEFAULT 'CREATED' NOT NULL,
    
    -- Geospatial coordinates for routing matrices
    pickup_location GEOGRAPHY(Point, 4326) NOT NULL,
    dropoff_location GEOGRAPHY(Point, 4326) NOT NULL,
    pickup_h3_cell VARCHAR(15) NOT NULL, -- Target Resolution 8 cell string
    
    assigned_driver_id UUID REFERENCES drivers(id),
    surge_multiplier NUMERIC(3,2) DEFAULT 1.00 NOT NULL,
    base_fare_paise INT NOT NULL, -- Storing currency as integers (Paise/Cents) to prevent precision loss
    
    assigned_at TIMESTAMP WITH TIME ZONE,
    picked_up_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- 3. ENTERPRISE AUDIT LOG & METRICS (SLA Protection)
-- ============================================================================

-- Dispatch Decisions Ledger (For pipeline playback and SLA dispute resolutions)
CREATE TABLE IF NOT EXISTS dispatch_match_logs (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID REFERENCES orders(id) NOT NULL,
    batch_window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    batch_window_ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
    algorithm_used VARCHAR(50) NOT NULL, -- 'GREEDY', 'HUNGARIAN', 'AUCTION'
    total_candidates_evaluated INT NOT NULL,
    chosen_driver_id UUID REFERENCES drivers(id) NOT NULL,
    computed_eta_seconds INT NOT NULL,
    assignment_score NUMERIC(10,4) NOT NULL, -- Final composite objective score
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================================
-- 4. STATE MACHINE TRANSITION ENFORCEMENT (Fences & Triggers)
-- ============================================================================

-- Enforce strict trajectory validation
ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS chk_order_status_trajectory;

ALTER TABLE orders 
ADD CONSTRAINT chk_order_status_trajectory 
CHECK (
    (status = 'CREATED') OR
    (status = 'ASSIGNED' AND assigned_driver_id IS NOT NULL) OR
    (status = 'EN_ROUTE_TO_PICKUP' AND assigned_driver_id IS NOT NULL) OR
    (status = 'DELIVERING' AND assigned_driver_id IS NOT NULL) OR
    (status = 'COMPLETED' AND assigned_driver_id IS NOT NULL) OR
    (status = 'CANCELLED')
);

CREATE OR REPLACE FUNCTION verify_order_state_transition() 
RETURNS TRIGGER AS $$
BEGIN
    -- Allow initial state creation
    IF OLD.status IS NULL THEN
        RETURN NEW;
    END IF;

    -- Protect terminal states from further mutations
    IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: Cannot mutate a terminal trip state.';
    END IF;

    -- Define strict linear allowed trajectories
    IF OLD.status = 'CREATED' AND NEW.status NOT IN ('ASSIGNED', 'CANCELLED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: New orders must move to ASSIGNED or CANCELLED.';
    END IF;

    IF OLD.status = 'ASSIGNED' AND NEW.status NOT IN ('EN_ROUTE_TO_PICKUP', 'CANCELLED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: Assigned orders must move to EN_ROUTE or CANCELLED.';
    END IF;

    IF OLD.status = 'DELIVERING' AND NEW.status NOT IN ('COMPLETED') THEN
        RAISE EXCEPTION 'IllegalStateTransition: Orders in flight can only transition to COMPLETED.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_order_state_machine ON orders;
CREATE TRIGGER trg_enforce_order_state_machine
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION verify_order_state_transition();

-- ============================================================================
-- 5. HIGH-PERFORMANCE GEOSPATIAL & TRANS-INDEXING
-- ============================================================================

-- Spatial GIST indexes to optimize boundary intersection and point lookups
CREATE INDEX IF NOT EXISTS idx_cities_geofence ON regional_cities USING GIST(geofence);
CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST(last_known_location);
CREATE INDEX IF NOT EXISTS idx_orders_pickup ON orders USING GIST(pickup_location);

-- B-Tree indexes for fast state machine queries and pipeline identification
CREATE INDEX IF NOT EXISTS idx_drivers_search ON drivers(city_prefix, current_state, is_verified);
CREATE INDEX IF NOT EXISTS idx_orders_matching_state ON orders(city_prefix, status) WHERE status = 'CREATED';
CREATE INDEX IF NOT EXISTS idx_match_logs_order ON dispatch_match_logs(order_id);
