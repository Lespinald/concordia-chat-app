package com.concordia.servers.controller;

import com.concordia.servers.model.Channel;
import com.concordia.servers.service.ChannelService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/servers/{serverId}/channels") // Observa cómo la URL base incluye el ID del servidor
public class ChannelController {

    private final ChannelService channelService;

    public ChannelController(ChannelService channelService) {
        this.channelService = channelService;
    }

    // DoD: POST /servers/{id}/channels -> HTTP 201
    @PostMapping
    public ResponseEntity<Channel> createChannel(
            @PathVariable UUID serverId,
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {

        String name = payload.get("name");
        String type = payload.get("type");

        Channel createdChannel = channelService.createChannel(serverId, name, type, userId);
        return ResponseEntity.status(HttpStatus.CREATED).body(createdChannel);
    }

    // DoD: GET /servers/{id}/channels returns all channels (only if user is a member)
    @GetMapping
    public ResponseEntity<List<Channel>> getChannels(
            @PathVariable UUID serverId,
            @RequestHeader("X-User-Id") String userId) {

        List<Channel> channels = channelService.getChannels(serverId, userId);
        return ResponseEntity.ok(channels);
    }

    // DoD: PUT /servers/{id}/channels/{cid} updates name/type
    @PutMapping("/{channelId}")
    public ResponseEntity<Channel> updateChannel(
            @PathVariable UUID serverId,
            @PathVariable UUID channelId,
            @RequestHeader("X-User-Id") String userId,
            @RequestBody Map<String, String> payload) {

        String name = payload.get("name");
        String type = payload.get("type");

        Channel updatedChannel = channelService.updateChannel(serverId, channelId, name, type, userId);
        return ResponseEntity.ok(updatedChannel);
    }

    // DoD: DELETE /servers/{id}/channels/{cid} soft-deletes; HTTP 204
    @DeleteMapping("/{channelId}")
    public ResponseEntity<Void> deleteChannel(
            @PathVariable UUID serverId,
            @PathVariable UUID channelId,
            @RequestHeader("X-User-Id") String userId) {

        channelService.deleteChannel(serverId, channelId, userId);
        return ResponseEntity.noContent().build();
    }
}
