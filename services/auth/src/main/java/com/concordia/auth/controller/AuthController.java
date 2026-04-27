package com.concordia.auth.controller;

import com.concordia.auth.dto.*;
import com.concordia.auth.exception.DuplicateResourceException;
import com.concordia.auth.exception.InvalidCredentialsException;
import com.concordia.auth.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<RegisterResponse> register(@RequestBody RegisterRequest request) {
        RegisterResponse response = authService.registerUser(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
        LoginResponse response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/refresh")
    public ResponseEntity<LoginResponse> refresh(@RequestBody RefreshTokenRequest request) {
        LoginResponse response = authService.refresh(request);
        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/logout")
    public ResponseEntity<Void> logout(@RequestHeader(value = org.springframework.http.HttpHeaders.AUTHORIZATION, required = false) String authHeader) {
        authService.logout(authHeader);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public ResponseEntity<UserProfileResponse> getMe(@RequestHeader(value = org.springframework.http.HttpHeaders.AUTHORIZATION, required = false) String authHeader) {
        UserProfileResponse response = authService.getMe(authHeader);
        return ResponseEntity.ok(response);
    }

    @ExceptionHandler(DuplicateResourceException.class)
    public ResponseEntity<Map<String, String>> handleDuplicateResource(DuplicateResourceException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<Map<String, String>> handleInvalidCredentials(InvalidCredentialsException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(com.concordia.auth.exception.InvalidTokenException.class)
    public ResponseEntity<Map<String, String>> handleInvalidToken(com.concordia.auth.exception.InvalidTokenException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", ex.getMessage()));
    }
}
