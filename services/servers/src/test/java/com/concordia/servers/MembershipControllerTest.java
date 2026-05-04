package com.concordia.servers;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class MembershipControllerTest extends BaseIntegrationTest {

    private static final String OWNER = "mem-owner";
    private static final String USER = "mem-user";

    private String serverId;

    @BeforeEach
    void setUp() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Test Server"));
        String response = mockMvc.perform(post("/servers")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        serverId = objectMapper.readTree(response).get("server_id").asText();
    }

    @Test
    void joinServer_success_returns200() throws Exception {
        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", USER))
                .andExpect(status().isOk());
    }

    @Test
    void joinServer_alreadyMember_returns409() throws Exception {
        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", USER));
        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", USER))
                .andExpect(status().isConflict());
    }

    @Test
    void joinServer_serverNotFound_returns404() throws Exception {
        mockMvc.perform(post("/servers/" + UUID.randomUUID() + "/join")
                        .header("X-User-Id", USER))
                .andExpect(status().isNotFound());
    }

    @Test
    void leaveServer_nonOwner_returns204() throws Exception {
        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", USER))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/servers/" + serverId + "/leave")
                        .header("X-User-Id", USER))
                .andExpect(status().isNoContent());
    }

    @Test
    void leaveServer_ownerCannotLeave_returns400() throws Exception {
        mockMvc.perform(delete("/servers/" + serverId + "/leave")
                        .header("X-User-Id", OWNER))
                .andExpect(status().isBadRequest());
    }

    @Test
    void leaveServer_notMember_returns404() throws Exception {
        mockMvc.perform(delete("/servers/" + serverId + "/leave")
                        .header("X-User-Id", USER))
                .andExpect(status().isNotFound());
    }

    @Test
    void getMembers_returnsListWithBothUsers() throws Exception {
        mockMvc.perform(post("/servers/" + serverId + "/join")
                        .header("X-User-Id", USER))
                .andExpect(status().isOk());

        mockMvc.perform(get("/servers/" + serverId + "/members"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[?(@.user_id == '" + OWNER + "')]").exists())
                .andExpect(jsonPath("$[?(@.user_id == '" + USER + "')]").exists());
    }
}
