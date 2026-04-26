package com.concordia.servers.model;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "memberships")
@IdClass(MembershipId.class)
public class Membership {

    @Id
    @Column(name = "server_id")
    private UUID serverId;

    @Id
    @Column(name = "user_id")
    private String userId;

    public Membership() {}

    public Membership(UUID serverId, String userId) {
        this.serverId = serverId;
        this.userId = userId;
    }

    public UUID getServerId() { return serverId; }
    public void setServerId(UUID serverId) { this.serverId = serverId; }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
}