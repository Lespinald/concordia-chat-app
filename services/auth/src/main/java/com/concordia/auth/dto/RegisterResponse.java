package com.concordia.auth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.UUID;

public class RegisterResponse {
    @JsonProperty("user_id")
    private UUID userId;
    private String username;

    public RegisterResponse(UUID userId, String username) {
        this.userId = userId;
        this.username = username;
    }

    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
}
