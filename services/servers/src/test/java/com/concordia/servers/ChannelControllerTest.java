package com.concordia.servers;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ChannelControllerTest extends BaseIntegrationTest {

    private static final String OWNER = "ch-owner";
    private static final String MEMBER = "ch-member";
    private static final String OUTSIDER = "ch-outsider";

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

        mockMvc.perform(post("/servers/" + serverId + "/join")
                .header("X-User-Id", MEMBER))
                .andExpect(status().isOk());
    }

    private String createChannel(String userId, String name, String type) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name, "type", type));
        String response = mockMvc.perform(post("/servers/" + serverId + "/channels")
                        .header("X-User-Id", userId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("channel_id").asText();
    }

    @Test
    void createChannel_byMember_returns201() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "general", "type", "TEXT"));
        mockMvc.perform(post("/servers/" + serverId + "/channels")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.channel_id").exists())
                .andExpect(jsonPath("$.name").value("general"))
                .andExpect(jsonPath("$.type").value("TEXT"));
    }

    @Test
    void createChannel_byNonMember_returns403() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "general", "type", "TEXT"));
        mockMvc.perform(post("/servers/" + serverId + "/channels")
                        .header("X-User-Id", OUTSIDER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void createChannel_invalidType_returns400() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "bad", "type", "INVALID"));
        mockMvc.perform(post("/servers/" + serverId + "/channels")
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getChannels_byMember_returns200() throws Exception {
        createChannel(OWNER, "general", "TEXT");
        mockMvc.perform(get("/servers/" + serverId + "/channels")
                        .header("X-User-Id", MEMBER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void getChannels_byNonMember_returns403() throws Exception {
        mockMvc.perform(get("/servers/" + serverId + "/channels")
                        .header("X-User-Id", OUTSIDER))
                .andExpect(status().isForbidden());
    }

    @Test
    void updateChannel_byOwner_returns200() throws Exception {
        String channelId = createChannel(OWNER, "old-name", "TEXT");
        String body = objectMapper.writeValueAsString(Map.of("name", "new-name"));
        mockMvc.perform(patch("/servers/" + serverId + "/channels/" + channelId)
                        .header("X-User-Id", OWNER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("new-name"));
    }

    @Test
    void updateChannel_byNonOwner_returns403() throws Exception {
        String channelId = createChannel(OWNER, "general", "TEXT");
        String body = objectMapper.writeValueAsString(Map.of("name", "hacked"));
        mockMvc.perform(patch("/servers/" + serverId + "/channels/" + channelId)
                        .header("X-User-Id", MEMBER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());
    }

    @Test
    void deleteChannel_byOwner_returns204() throws Exception {
        String channelId = createChannel(OWNER, "temp", "VOICE");
        mockMvc.perform(delete("/servers/" + serverId + "/channels/" + channelId)
                        .header("X-User-Id", OWNER))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/servers/" + serverId + "/channels")
                        .header("X-User-Id", OWNER))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deleteChannel_byNonOwner_returns403() throws Exception {
        String channelId = createChannel(OWNER, "general", "TEXT");
        mockMvc.perform(delete("/servers/" + serverId + "/channels/" + channelId)
                        .header("X-User-Id", MEMBER))
                .andExpect(status().isForbidden());
    }
}
