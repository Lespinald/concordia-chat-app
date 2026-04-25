package com.concordia.auth.dto;

import java.util.UUID;

public class UserRegisteredEvent {
    private UUID userId;
    private String username;
    private String email;

    public UserRegisteredEvent(UUID userId, String username, String email) {
        this.userId = userId;
        this.username = username;
        this.email = email;
    }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
