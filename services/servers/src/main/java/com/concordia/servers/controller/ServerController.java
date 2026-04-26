package com.concordia.servers.controller;

import com.concordia.servers.model.Server;
import com.concordia.servers.service.ServerService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/servers") // Todas las URLs de este archivo empezarán con /servers
public class ServerController {

    private final ServerService serverService;

    public ServerController(ServerService serverService) {
        this.serverService = serverService;
    }

    // 1. CREAR SERVIDOR (POST)
    @PostMapping
    public ResponseEntity<Server> createServer(
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {

        String name = payload.get("name");
        Server createdServer = serverService.createServer(name, userId);

        // Retorna HTTP 201 (Created)
        return ResponseEntity.status(HttpStatus.CREATED).body(createdServer);
    }

    // 2. OBTENER TODOS MIS SERVIDORES (GET)
    @GetMapping
    public ResponseEntity<List<Server>> getServers(
            @RequestHeader("X-User-Id") String userId) {

        List<Server> servers = serverService.getServersByUserId(userId);
        return ResponseEntity.ok(servers);
    }

    // 3. OBTENER UN SERVIDOR POR SU ID (GET)
    @GetMapping("/{id}")
    public ResponseEntity<Server> getServerById(@PathVariable UUID id) {
        Optional<Server> server = serverService.getServerById(id);

        return server.map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
    }

    // 4. ACTUALIZAR UN SERVIDOR (PATCH)
    @PatchMapping("/{id}")
    public ResponseEntity<?> updateServer(
            @PathVariable UUID id,
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {
        try {
            String newName = payload.get("name");
            Server updatedServer = serverService.updateServer(id, newName, userId);
            return ResponseEntity.ok(updatedServer);
        } catch (RuntimeException e) {
            // Manejo de errores de negocio
            if (e.getMessage().equals("NOT_FOUND")) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            if (e.getMessage().equals("FORBIDDEN")) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // 5. BORRAR UN SERVIDOR - SOFT DELETE (DELETE)
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteServer(
            @PathVariable UUID id,
            @RequestHeader("X-User-Id") String userId) {
        try {
            serverService.deleteServer(id, userId);
            return ResponseEntity.noContent().build(); // Retorna HTTP 204 (No Content) por regla general en APIs
        } catch (RuntimeException e) {
            if (e.getMessage().equals("NOT_FOUND")) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            if (e.getMessage().equals("FORBIDDEN")) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}