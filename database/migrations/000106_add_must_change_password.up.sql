-- Force invited admins to rotate the temporary password on first login.
ALTER TABLE system_admins ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false NOT NULL;
