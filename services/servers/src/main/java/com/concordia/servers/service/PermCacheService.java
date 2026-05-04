package com.concordia.servers.service;

import com.concordia.servers.model.Permission;
import com.concordia.servers.repository.RoleRepository;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
class PermCacheService {

    private final RoleRepository roleRepository;

    PermCacheService(RoleRepository roleRepository) {
        this.roleRepository = roleRepository;
    }

    @Cacheable(cacheNames = "roleLookup", key = "#serverId.toString() + ':' + #userId")
    public Set<Permission> getPermissionsForUser(UUID serverId, String userId) {
        return roleRepository.findRolesByUserAndServer(serverId, userId).stream()
                .flatMap(r -> r.getPermissions().stream())
                .collect(Collectors.toSet());
    }
}
