ALTER TABLE IF EXISTS permissions RENAME TO role_permissions;

ALTER TABLE roles ADD CONSTRAINT uq_roles_server_name UNIQUE (server_id, name);

CREATE TABLE IF NOT EXISTS membership_roles (
    server_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id),
    FOREIGN KEY (server_id, user_id) REFERENCES memberships(server_id, user_id) ON DELETE CASCADE
);