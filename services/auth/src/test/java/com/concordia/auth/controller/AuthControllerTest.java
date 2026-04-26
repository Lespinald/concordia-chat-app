package com.concordia.auth.controller;

import com.concordia.auth.dto.*;
import com.concordia.auth.model.RefreshToken;
import com.concordia.auth.model.User;
import com.concordia.auth.repository.RefreshTokenRepository;
import com.concordia.auth.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.ZonedDateTime;
import java.util.Base64;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
public class AuthControllerTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15-alpine")
            .withDatabaseName("auth_test_db")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.flyway.url", postgres::getJdbcUrl);
        registry.add("spring.flyway.user", postgres::getUsername);
        registry.add("spring.flyway.password", postgres::getPassword);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @MockBean
    private KafkaTemplate<String, Object> kafkaTemplate;

    @BeforeEach
    void setUp() {
        refreshTokenRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void testRegisterSuccess() throws Exception {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("alice");
        request.setEmail("alice@test.com");
        request.setPassword("secret123");

        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user_id").exists())
                .andExpect(jsonPath("$.username").value("alice"));

        verify(kafkaTemplate).send(eq("user-registered"), any(String.class), any(UserRegisteredEvent.class));
        assertTrue(userRepository.existsByEmail("alice@test.com"));
    }

    @Test
    void testRegisterDuplicateEmail() throws Exception {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("bob");
        request.setEmail("duplicate@test.com");
        request.setPassword("pass");

        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        request.setUsername("charlie"); // different username, same email
        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("email already registered"));
    }

    @Test
    void testRegisterDuplicateUsername() throws Exception {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("duplicate_user");
        request.setEmail("test1@test.com");
        request.setPassword("pass");

        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        request.setEmail("test2@test.com"); // different email, same username
        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("username already taken"));
    }

    private void registerUser(String username, String email, String password) throws Exception {
        RegisterRequest request = new RegisterRequest();
        request.setUsername(username);
        request.setEmail(email);
        request.setPassword(password);
        mockMvc.perform(post("/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());
    }

    @Test
    void testLoginSuccess() throws Exception {
        registerUser("login_user", "login@test.com", "mypassword");

        LoginRequest req = new LoginRequest();
        req.setEmail("login@test.com");
        req.setPassword("mypassword");

        mockMvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists())
                .andExpect(jsonPath("$.refresh_token").exists())
                .andExpect(jsonPath("$.expires_in").value(900));
    }

    @Test
    void testLoginWrongPassword() throws Exception {
        registerUser("wrong_pass_user", "wrong@test.com", "mypassword");

        LoginRequest req = new LoginRequest();
        req.setEmail("wrong@test.com");
        req.setPassword("badpassword");

        mockMvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("invalid credentials"));
    }

    @Test
    void testRefreshSuccess() throws Exception {
        registerUser("refresh_user", "refresh@test.com", "mypassword");

        LoginRequest req = new LoginRequest();
        req.setEmail("refresh@test.com");
        req.setPassword("mypassword");

        MvcResult loginRes = mockMvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andReturn();

        LoginResponse loginData = objectMapper.readValue(loginRes.getResponse().getContentAsString(), LoginResponse.class);

        RefreshTokenRequest refreshReq = new RefreshTokenRequest();
        refreshReq.setRefreshToken(loginData.getRefreshToken());

        mockMvc.perform(post("/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(refreshReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists())
                .andExpect(jsonPath("$.refresh_token").exists());
    }

    @Test
    void testRefreshExpired() throws Exception {
        registerUser("expired_user", "expired@test.com", "pass");
        User user = userRepository.findByEmail("expired@test.com").orElseThrow();

        UUID rawToken = UUID.randomUUID();
        String hash = hashToken(rawToken.toString());

        RefreshToken rt = new RefreshToken();
        rt.setId(UUID.randomUUID());
        rt.setUserId(user.getId());
        rt.setTokenHash(hash);
        rt.setCreatedAt(ZonedDateTime.now().minusDays(10));
        rt.setExpiresAt(ZonedDateTime.now().minusDays(1)); // Expired!
        refreshTokenRepository.save(rt);

        RefreshTokenRequest refreshReq = new RefreshTokenRequest();
        refreshReq.setRefreshToken(rawToken.toString());

        mockMvc.perform(post("/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(refreshReq)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("refresh token expired"));
    }

    @Test
    void testRefreshUnknown() throws Exception {
        RefreshTokenRequest refreshReq = new RefreshTokenRequest();
        refreshReq.setRefreshToken(UUID.randomUUID().toString());

        mockMvc.perform(post("/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(refreshReq)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("invalid token"));
    }

    @Test
    void testLogout() throws Exception {
        registerUser("logout_user", "logout@test.com", "pass");

        LoginRequest req = new LoginRequest();
        req.setEmail("logout@test.com");
        req.setPassword("pass");

        MvcResult loginRes = mockMvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andReturn();

        LoginResponse loginData = objectMapper.readValue(loginRes.getResponse().getContentAsString(), LoginResponse.class);
        
        // Assert token is in DB
        assertEquals(1, refreshTokenRepository.count());

        mockMvc.perform(delete("/auth/logout")
                .header("Authorization", "Bearer " + loginData.getAccessToken()))
                .andExpect(status().isNoContent());

        // Assert token is deleted
        assertEquals(0, refreshTokenRepository.count());
    }

    @Test
    void testGetMe() throws Exception {
        registerUser("profile_user", "profile@test.com", "pass");

        LoginRequest req = new LoginRequest();
        req.setEmail("profile@test.com");
        req.setPassword("pass");

        MvcResult loginRes = mockMvc.perform(post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andReturn();

        LoginResponse loginData = objectMapper.readValue(loginRes.getResponse().getContentAsString(), LoginResponse.class);

        mockMvc.perform(get("/auth/me")
                .header("Authorization", "Bearer " + loginData.getAccessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id").exists())
                .andExpect(jsonPath("$.username").value("profile_user"))
                .andExpect(jsonPath("$.email").value("profile@test.com"))
                .andExpect(jsonPath("$.created_at").exists());
    }

    private String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
