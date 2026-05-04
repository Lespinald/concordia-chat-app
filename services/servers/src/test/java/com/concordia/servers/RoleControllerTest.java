package com.concordia.servers;

import com.concordia.servers.model.Permission;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class RoleControllerTest extends BaseIntegrationTest {

    private static final String OWNER = "role-owner";
    private static final String MEMBER = "role-member";

    private String serverId;

    @BeforeEach
    void setUp() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Role Test Server"));
        String response = mockMvc.perform(post("/servers")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        serverId = objectMapper.readTree(response).get("server_id").asText();

        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", MEMBER))
                .andExpect(status().isOk());
    }

    private String createRole(String name, Set<Permission> permissions) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name, "permissions", permissions));
        String response = mockMvc.perform(post("/servers/" + serverId + "/roles")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asText();
    }

    @Test
    void createRole_success_returns201() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "name", "moderator",
                "permissions", Set.of("READ", "WRITE")));
        mockMvc.perform(post("/servers/" + serverId + "/roles")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.name").value("moderator"));
    }

    @Test
    void createRole_serverNotFound_returns404() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "name", "mod",
                "permissions", Set.of("READ")));
        mockMvc.perform(post("/servers/" + UUID.randomUUID() + "/roles")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotFound());
    }

    @Test
    void assignRole_byOwner_returns200() throws Exception {
        String roleId = createRole("mod", Set.of(Permission.READ));
        String body = objectMapper.writeValueAsString(Map.of("roleId", UUID.fromString(roleId)));
        mockMvc.perform(put("/servers/" + serverId + "/members/" + MEMBER + "/roles")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    @Test
    void assignRole_toNonMember_returns404() throws Exception {
        String roleId = createRole("mod", Set.of(Permission.READ));
        String body = objectMapper.writeValueAsString(Map.of("roleId", UUID.fromString(roleId)));
        mockMvc.perform(put("/servers/" + serverId + "/members/outsider-xyz/roles")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isNotFound());
    }

    @Test
    void assignRole_missingRoleId_returns400() throws Exception {
        mockMvc.perform(put("/servers/" + serverId + "/members/" + MEMBER + "/roles")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }
}
