package com.concordia.servers.controller;

import com.concordia.servers.model.Permission;
import com.concordia.servers.model.Role;
import com.concordia.servers.service.RoleService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/servers/{serverId}")
public class RoleController {

    private final RoleService roleService;

    public RoleController(RoleService roleService) {
        this.roleService = roleService;
    }

    // DoD: POST /servers/{id}/roles creates a new role -> HTTP 201
    @PostMapping("/roles")
    public ResponseEntity<Role> createRole(
            @PathVariable UUID serverId,
            @RequestBody RoleRequest request) {

        Role role = roleService.createRole(serverId, request.name(), request.permissions());
        return ResponseEntity.status(HttpStatus.CREATED).body(role);
    }

    // DoD: PUT /servers/{id}/members/{userId}/roles assigns a role
    @PutMapping("/members/{userId}/roles")
    public ResponseEntity<Void> assignRole(
            @PathVariable UUID serverId,
            @PathVariable String userId,
            @RequestBody Map<String, UUID> requestBody,
            @RequestHeader("X-User-Id") String requesterId) {
        
        UUID roleId = requestBody.get("roleId");
        if (roleId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "roleId is required in request body");
        }
        
        roleService.assignRole(serverId, userId, roleId, requesterId);
        return ResponseEntity.ok().build();
    }
}
