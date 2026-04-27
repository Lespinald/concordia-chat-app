package com.concordia.servers.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.*;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Entity
@Table(name = "channels")
@SQLDelete(sql = "UPDATE channels SET deleted = true WHERE id=?")
@SQLRestriction("deleted=false")
public class Channel {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "server_id", nullable = false)
    @JsonProperty("server_id")
    private UUID serverId;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ChannelType type;

    @Column(name = "created_at", nullable = false, updatable = false)
    @JsonProperty("created_at")
    private OffsetDateTime createdAt;

    @Column(nullable = false)
    @JsonIgnore
    private boolean deleted = false;

    @PrePersist
    protected void onCreate() {
        this.createdAt = OffsetDateTime.now(ZoneOffset.UTC);
    }

    // --- GETTERS Y SETTERS ---
    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public UUID getServerId() { return serverId; }
    public void setServerId(UUID serverId) { this.serverId = serverId; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public ChannelType getType() { return type; }
    public void setType(ChannelType type) { this.type = type; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public boolean isDeleted() { return deleted; }
    public void setDeleted(boolean deleted) { this.deleted = deleted; }
}
