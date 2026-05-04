package com.concordia.servers.service;

import com.concordia.servers.model.Permission;
import com.concordia.servers.repository.MembershipRepository;
import org.springframework.stereotype.Service;

import java.util.Set;
import java.util.UUID;

@Service
public class PermissionService {

    private final MembershipRepository membershipRepository;
    private final PermCacheService permCacheService;

    public PermissionService(MembershipRepository membershipRepository, PermCacheService permCacheService) {
        this.membershipRepository = membershipRepository;
        this.permCacheService = permCacheService;
    }

    public record CheckResult(boolean allowed, String reason) {}

    public CheckResult checkPerm(String userId, UUID serverId, UUID channelId, Permission permission) {
        if (!membershipRepository.existsByServerIdAndUserId(serverId, userId)) {
            return new CheckResult(false, "not a member");
        }
        Set<Permission> permissions = permCacheService.getPermissionsForUser(serverId, userId);
        if (permissions.contains(permission)) {
            return new CheckResult(true, "");
        }
        return new CheckResult(false, "insufficient permissions");
    }
}
