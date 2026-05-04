package com.concordia.servers;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ServerControllerTest extends BaseIntegrationTest {

    private static final String USER_A = "server-user-a";
    private static final String USER_B = "server-user-b";

    private String createServer(String userId, String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name));
        String response = mockMvc.perform(post("/servers")
                        .header("X-User-Id", userId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("server_id").asText();
    }

    @Test
    void createServer_success_returns201() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "My Server"));
        mockMvc.perform(post("/servers")
                        .header("X-User-Id", USER_A)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.server_id").exists())
                .andExpect(jsonPath("$.name").value("My Server"))
                .andExpect(jsonPath("$.owner_id").value(USER_A));
    }

    @Test
    void createServer_emptyName_returns400() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", ""));
        mockMvc.perform(post("/servers")
                        .header("X-User-Id", USER_A)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getServers_returnsOnlyCallerServers() throws Exception {
        createServer(USER_A, "Server A");
        createServer(USER_B, "Server B");

        mockMvc.perform(get("/servers").header("X-User-Id", USER_A))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Server A"));
    }

    @Test
    void getServerById_exists_returns200() throws Exception {
        String serverId = createServer(USER_A, "Alpha");
        mockMvc.perform(get("/servers/" + serverId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.server_id").value(serverId))
                .andExpect(jsonPath("$.name").value("Alpha"));
    }

    @Test
    void getServerById_notFound_returns404() throws Exception {
        mockMvc.perform(get("/servers/" + UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    @Test
    void updateServer_byOwner_returns200() throws Exception {
        String serverId = createServer(USER_A, "Old Name");
        String body = objectMapper.writeValueAsString(Map.of("name", "New Name"));
        mockMvc.perform(put("/servers/" + serverId)
                        .header("X-User-Id", USER_A)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("New Name"));
    }

    @Test
    void updateServer_byNonOwner_returns403() throws Exception {
        String serverId = createServer(USER_A, "My Server");
        String body = objectMapper.writeValueAsString(Map.of("name", "Hacked"));
        mockMvc.perform(put("/servers/" + serverId)
                        .header("X-User-Id", USER_B)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void updateServer_emptyName_returns400() throws Exception {
        String serverId = createServer(USER_A, "My Server");
        String body = objectMapper.writeValueAsString(Map.of("name", ""));
        mockMvc.perform(put("/servers/" + serverId)
                        .header("X-User-Id", USER_A)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteServer_byOwner_returns204_andSoftDeletes() throws Exception {
        String serverId = createServer(USER_A, "Doomed Server");
        mockMvc.perform(delete("/servers/" + serverId)
                        .header("X-User-Id", USER_A))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/servers/" + serverId))
                .andExpect(status().isNotFound());
    }

    @Test
    void deleteServer_byNonOwner_returns403() throws Exception {
        String serverId = createServer(USER_A, "My Server");
        mockMvc.perform(delete("/servers/" + serverId)
                        .header("X-User-Id", USER_B))
                .andExpect(status().isForbidden());
    }
}
