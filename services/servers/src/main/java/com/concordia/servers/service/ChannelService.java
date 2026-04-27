package com.concordia.servers.service;

import com.concordia.servers.model.Channel;
import com.concordia.servers.model.ChannelType;
import com.concordia.servers.model.Server;
import com.concordia.servers.repository.ChannelRepository;
import com.concordia.servers.repository.MembershipRepository;
import com.concordia.servers.repository.ServerRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
public class ChannelService {

    private final ChannelRepository channelRepository;
    private final ServerRepository serverRepository;
    private final MembershipRepository membershipRepository;

    public ChannelService(ChannelRepository channelRepository,
                          ServerRepository serverRepository,
                          MembershipRepository membershipRepository) {
        this.channelRepository = channelRepository;
        this.serverRepository = serverRepository;
        this.membershipRepository = membershipRepository;
    }

    // Método auxiliar para validar el permiso MANAGE (temporalmente validamos si es el dueño)
    private Server getServerAndVerifyManagePermission(UUID serverId, String userId) {
        Server server = serverRepository.findById(serverId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found"));

        if (!server.getOwnerId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Requires MANAGE permission");
        }
        return server;
    }

    @Transactional
    public Channel createChannel(UUID serverId, String name, String type, String userId) {
        if (name == null || name.trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Channel name cannot be empty");
        }

        getServerAndVerifyManagePermission(serverId, userId);

        Channel channel = new Channel();
        channel.setServerId(serverId);
        channel.setName(name);

        try {
            // Convierte el string "TEXT" o "VOICE" a nuestro Enum. Falla si mandan algo raro.
            channel.setType(ChannelType.valueOf(type.toUpperCase()));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid channel type. Must be TEXT or VOICE");
        }

        return channelRepository.save(channel);
    }

    public List<Channel> getChannels(UUID serverId, String userId) {
        // DoD: Non-member accessing server's channels -> HTTP 403
        if (!membershipRepository.existsByServerIdAndUserId(serverId, userId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Non-member cannot access server's channels");
        }
        return channelRepository.findByServerId(serverId);
    }

    @Transactional
    public Channel updateChannel(UUID serverId, UUID channelId, String newName, String newType, String userId) {
        // DoD: requires MANAGE permission
        getServerAndVerifyManagePermission(serverId, userId);

        Channel channel = channelRepository.findById(channelId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Channel not found"));

        if (!channel.getServerId().equals(serverId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Channel does not belong to this server");
        }

        if (newName != null && !newName.trim().isEmpty()) {
            channel.setName(newName);
        }

        if (newType != null && !newType.trim().isEmpty()) {
            try {
                channel.setType(ChannelType.valueOf(newType.toUpperCase()));
            } catch (IllegalArgumentException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid channel type");
            }
        }

        return channelRepository.save(channel);
    }

    @Transactional
    public void deleteChannel(UUID serverId, UUID channelId, String userId) {
        // DoD: requires MANAGE permission
        getServerAndVerifyManagePermission(serverId, userId);

        Channel channel = channelRepository.findById(channelId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Channel not found"));

        if (!channel.getServerId().equals(serverId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Channel does not belong to this server");
        }

        // DoD: soft-deletes
        channelRepository.delete(channel);
    }
}
