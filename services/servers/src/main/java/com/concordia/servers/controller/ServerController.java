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
@RequestMapping("/servers")
public class ServerController {

    private final ServerService serverService;

    public ServerController(ServerService serverService) {
        this.serverService = serverService;
    }

    @PostMapping
    public ResponseEntity<Server> createServer(
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {

        String name = payload.get("name");
        Server createdServer = serverService.createServer(name, userId);
        return ResponseEntity.status(HttpStatus.CREATED).body(createdServer);
    }

    @GetMapping
    public ResponseEntity<List<Server>> getServers(
            @RequestHeader("X-User-Id") String userId) {

        List<Server> servers = serverService.getServersByUserId(userId);
        return ResponseEntity.ok(servers);
    }

    @GetMapping("/public")
    public ResponseEntity<List<Server>> getPublicServers(
            @RequestParam(required = false) String q) {

        return ResponseEntity.ok(serverService.searchPublicServers(q));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Server> getServerById(@PathVariable UUID id) {
        Optional<Server> server = serverService.getServerById(id);

        return server.map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).build());
    }

    // Blocker 1: Changed from @PatchMapping to @PutMapping
    @PutMapping("/{id}")
    public ResponseEntity<Server> updateServer(
            @PathVariable UUID id,
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {

        String newName = payload.get("name");
        Server updatedServer = serverService.updateServer(id, newName, userId);
        return ResponseEntity.ok(updatedServer);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteServer( // Cambiado a Void porque no devuelve body
                                              @PathVariable UUID id,
                                              @RequestHeader("X-User-Id") String userId) {

        serverService.deleteServer(id, userId);
        return ResponseEntity.noContent().build();
    }
}
