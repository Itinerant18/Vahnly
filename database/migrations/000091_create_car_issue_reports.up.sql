-- Phase 10: post-trip car issue reports filed by the driver against the rider's car.
CREATE TABLE IF NOT EXISTS car_issue_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    rider_garage_car_id UUID REFERENCES rider_garage(id),
    issue_type          VARCHAR(30) NOT NULL, -- FUEL_LOW | WARNING_LIGHT | TYRE | AC | OTHER
    description         TEXT,
    admin_notified      BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_car_issue_reports_order  ON car_issue_reports(order_id);
CREATE INDEX IF NOT EXISTS idx_car_issue_reports_driver ON car_issue_reports(driver_id);
