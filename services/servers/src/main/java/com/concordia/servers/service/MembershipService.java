package com.concordia.servers.service;

import com.concordia.servers.model.Membership;
import com.concordia.servers.model.MembershipId;
import com.concordia.servers.model.Server;
import com.concordia.servers.repository.MembershipRepository;
import com.concordia.servers.repository.ServerRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class MembershipService {

    private final MembershipRepository membershipRepository;
    private final ServerRepository serverRepository;

    public MembershipService(MembershipRepository membershipRepository, ServerRepository serverRepository) {
        this.membershipRepository = membershipRepository;
        this.serverRepository = serverRepository;
    }

    @Transactional
    public void joinServer(UUID serverId, String userId) {
        if (!serverRepository.existsById(serverId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found");
        }

        // DoD: Joining an already-joined server -> HTTP 409
        if (membershipRepository.existsByServerIdAndUserId(serverId, userId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "already a member");
        }

        Membership membership = new Membership();
        membership.setServerId(serverId);
        membership.setUserId(userId);

        membershipRepository.save(membership);
    }

    @Transactional
    public void leaveServer(UUID serverId, String userId) {
        Server server = serverRepository.findById(serverId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found"));

        // DoD: Owner cannot leave
        if (server.getOwnerId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Owner cannot leave the server");
        }

        if (!membershipRepository.existsByServerIdAndUserId(serverId, userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "You are not a member of this server");
        }

        // DoD: Removes user from memberships
        membershipRepository.deleteByServerIdAndUserId(serverId, userId);

    }
    @Transactional(readOnly = true)
    public List<Map<String, String>> getServerMembers(UUID serverId) {
        if (!serverRepository.existsById(serverId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found");
        }

        List<Membership> memberships = membershipRepository.findByServerId(serverId);

        // DoD: returns list with user_id and username
        return memberships.stream().map(m -> Map.of(
                "user_id", m.getUserId(),
                // TODO(T-39): replace with users_cache lookup once Kafka consumer is implemented
                "username", "User_" + m.getUserId()
        )).collect(Collectors.toList());
    }
}
