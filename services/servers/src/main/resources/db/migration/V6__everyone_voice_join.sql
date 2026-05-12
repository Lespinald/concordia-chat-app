-- Grant VOICE_JOIN to every existing @everyone role so members joining a
-- server (who only get @everyone) can connect to voice channels.
-- Idempotent: ON CONFLICT DO NOTHING handles re-runs and roles that already
-- have the permission.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'VOICE_JOIN'
FROM roles r
WHERE r.name = '@everyone'
ON CONFLICT (role_id, permission) DO NOTHING;
