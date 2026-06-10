-- Training modules + per-driver progress (FEAT-002 training backend).
CREATE TABLE IF NOT EXISTS training_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(120) NOT NULL,
    duration_label VARCHAR(24) NOT NULL,
    module_type VARCHAR(24) NOT NULL DEFAULT 'REQUIRED', -- REQUIRED | OPTIONAL_BADGE
    pass_threshold INT NOT NULL DEFAULT 80,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS driver_training_progress (
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES training_modules(id) ON DELETE CASCADE,
    score INT,
    status VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED', -- NOT_STARTED | IN_PROGRESS | COMPLETED
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (driver_id, module_id)
);
