package com.concordia.servers.model;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

public class MembershipId implements Serializable {
    private UUID serverId;
    private String userId;

    public MembershipId() {}

    public MembershipId(UUID serverId, String userId) {
        this.serverId = serverId;
        this.userId = userId;
    }
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        MembershipId that = (MembershipId) o;
        return Objects.equals(serverId, that.serverId) && Objects.equals(userId, that.userId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(serverId, userId);
    }
}