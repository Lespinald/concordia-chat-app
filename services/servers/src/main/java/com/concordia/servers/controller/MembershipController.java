package com.concordia.servers.controller;

import com.concordia.servers.service.MembershipService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/servers/{serverId}")
public class MembershipController {

    private final MembershipService membershipService;

    public MembershipController(MembershipService membershipService) {
        this.membershipService = membershipService;
    }

    @PostMapping("/join")
    public ResponseEntity<Void> joinServer(
            @PathVariable UUID serverId,
            @RequestHeader("X-User-Id") String userId) {

        membershipService.joinServer(serverId, userId);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/leave")
    public ResponseEntity<Void> leaveServer(
            @PathVariable UUID serverId,
            @RequestHeader("X-User-Id") String userId) {

        membershipService.leaveServer(serverId, userId);
        return ResponseEntity.noContent().build(); // DoD: HTTP 204
    }

    @GetMapping("/members")
    public ResponseEntity<List<Map<String, String>>> getMembers(
            @PathVariable UUID serverId) {

        // DoD: returns list with user_id and username
        return ResponseEntity.ok(membershipService.getServerMembers(serverId));
    }
}
