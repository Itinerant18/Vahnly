-- Gradual-rollout feature flags referenced by the go-live ramp (driver app first,
-- then rider app invite-only, then public). Seeded disabled so production starts
-- dark; flip via the admin feature-flags console as each cohort is enabled.
INSERT INTO feature_flags (flag_key, name, description, is_enabled, rollout_percentage, is_kill_switch) VALUES
    ('social_login', 'Social Login', 'Allow Google/Apple social sign-in alongside OTP',                         false, 0, false),
    ('rider_app',    'Rider App',    'Master gate for the consumer rider app (invite-only then public rollout)', false, 0, false)
ON CONFLICT (flag_key) DO NOTHING;
