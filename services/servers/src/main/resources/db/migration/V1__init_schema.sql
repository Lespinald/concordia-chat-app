CREATE TABLE servers (
                         id UUID PRIMARY KEY,
                         name VARCHAR(255) NOT NULL,
                         owner_id VARCHAR(255) NOT NULL,
                         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE channels (
                          id UUID PRIMARY KEY,
                          server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                          name VARCHAR(255) NOT NULL,
                          type VARCHAR(50) NOT NULL
);

CREATE TABLE memberships (
                             server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                             user_id VARCHAR(255) NOT NULL,
                             PRIMARY KEY (server_id, user_id)
);

CREATE TABLE roles (
                       id UUID PRIMARY KEY,
                       server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                       name VARCHAR(255) NOT NULL
);

CREATE TABLE permissions (
                             role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
                             permission VARCHAR(100) NOT NULL,
                             PRIMARY KEY (role_id, permission)
);