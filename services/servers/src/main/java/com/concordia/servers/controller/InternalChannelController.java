package com.concordia.servers.controller;

import com.concordia.servers.model.Channel;
import com.concordia.servers.repository.ChannelRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

// Internal-only endpoint used by Chat Svc to look up a channel's parent
// server_id before publishing Kafka events. Not auth-protected: relies on
// docker network isolation. In production this should be reachable only on an
// internal port or behind a shared secret.
@RestController
@RequestMapping("/internal/channels")
public class InternalChannelController {

    private final ChannelRepository channelRepository;

    public InternalChannelController(ChannelRepository channelRepository) {
        this.channelRepository = channelRepository;
    }

    @GetMapping("/{channelId}")
    public ResponseEntity<Map<String, Object>> getChannel(@PathVariable UUID channelId) {
        return channelRepository.findById(channelId)
                .<ResponseEntity<Map<String, Object>>>map(channel -> ResponseEntity.ok(Map.of(
                        "channel_id", channel.getId(),
                        "server_id", channel.getServerId()
                )))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
