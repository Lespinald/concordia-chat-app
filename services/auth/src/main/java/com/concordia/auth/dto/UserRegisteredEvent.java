package com.concordia.auth.dto;

import java.time.ZonedDateTime;
import java.util.UUID;

public class UserRegisteredEvent {
    private UUID userId;
    private String username;
    private String email;
    private ZonedDateTime createdAt;

    public UserRegisteredEvent(UUID userId, String username, String email, ZonedDateTime createdAt) {
        this.userId = userId;
        this.username = username;
        this.email = email;
        this.createdAt = createdAt;
    }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public ZonedDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(ZonedDateTime createdAt) { this.createdAt = createdAt; }
}
