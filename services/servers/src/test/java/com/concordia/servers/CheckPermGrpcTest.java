package com.concordia.servers;

import com.concordia.proto.Action;
import com.concordia.proto.CheckPermRequest;
import com.concordia.proto.CheckPermResponse;
import com.concordia.proto.PermServiceGrpc;
import com.concordia.servers.grpc.PermServiceImpl;
import io.grpc.ManagedChannel;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CheckPermGrpcTest extends BaseIntegrationTest {

    // owner gets @owner role (READ, WRITE, VOICE_JOIN, MANAGE)
    private static final String OWNER = "grpc-owner";
    // member gets @everyone role (READ, WRITE, VOICE_JOIN) — no MANAGE
    private static final String MEMBER = "grpc-member";
    private static final String NON_MEMBER = "grpc-nonmember";

    @Autowired
    private PermServiceImpl permServiceImpl;

    private ManagedChannel channel;
    private PermServiceGrpc.PermServiceBlockingStub stub;
    private String serverId;

    @BeforeAll
    void startInProcessGrpcServer() throws Exception {
        String serverName = InProcessServerBuilder.generateName();
        InProcessServerBuilder.forName(serverName)
                .directExecutor()
                .addService(permServiceImpl)
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(serverName)
                .directExecutor()
                .build();
        stub = PermServiceGrpc.newBlockingStub(channel);
    }

    @AfterAll
    void shutdownChannel() throws InterruptedException {
        channel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }

    // Runs after BaseIntegrationTest.cleanDatabase() for each test
    @BeforeEach
    void setUpServerAndMembers() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "gRPC Perm Server"));
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

    @Test
    void checkPerm_memberWithPermission_returnsAllowed() {
        CheckPermResponse response = stub.checkPerm(CheckPermRequest.newBuilder()
                .setUserId(OWNER)
                .setServerId(serverId)
                .setChannelId(UUID.randomUUID().toString())
                .setAction(Action.READ)
                .build());
        assertTrue(response.getAllowed());
        assertEquals("", response.getReason());
    }

    @Test
    void checkPerm_memberWithoutPermission_returnsDenied() {
        // MEMBER has @everyone (READ, WRITE, VOICE_JOIN) but not MANAGE
        CheckPermResponse response = stub.checkPerm(CheckPermRequest.newBuilder()
                .setUserId(MEMBER)
                .setServerId(serverId)
                .setChannelId(UUID.randomUUID().toString())
                .setAction(Action.MANAGE)
                .build());
        assertFalse(response.getAllowed());
        assertEquals("insufficient permissions", response.getReason());
    }

    @Test
    void checkPerm_nonMember_returnsDenied() {
        CheckPermResponse response = stub.checkPerm(CheckPermRequest.newBuilder()
                .setUserId(NON_MEMBER)
                .setServerId(serverId)
                .setChannelId(UUID.randomUUID().toString())
                .setAction(Action.READ)
                .build());
        assertFalse(response.getAllowed());
        assertEquals("not a member", response.getReason());
    }
}
