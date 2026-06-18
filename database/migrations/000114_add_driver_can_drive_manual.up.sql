-- Driver skill: can this driver operate a manual-transmission car? The rider owns the car,
-- so the driver's transmission capability (a skill, not a vehicle attribute) is what gates a
-- manual booking. Default true — most drivers can drive manual; automatic-only drivers opt
-- out, and the matcher then routes manual cars only to capable drivers.
ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS can_drive_manual BOOLEAN NOT NULL DEFAULT true;
