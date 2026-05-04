package com.concordia.servers.service;

import com.concordia.servers.model.Permission;
import com.concordia.servers.model.Role;
import com.concordia.servers.model.Server;
import com.concordia.servers.repository.RoleRepository;
import com.concordia.servers.repository.ServerRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Set;
import java.util.UUID;
import com.concordia.servers.repository.MembershipRepository;

@Service
public class RoleService {

    private final RoleRepository roleRepository;
    private final ServerRepository serverRepository;
    private final MembershipRepository membershipRepository; 

    public RoleService(RoleRepository roleRepository, 
                       ServerRepository serverRepository, 
                       MembershipRepository membershipRepository) {
        this.roleRepository = roleRepository;
        this.serverRepository = serverRepository;
        this.membershipRepository = membershipRepository;
    }

@Transactional
    public Role createRole(UUID serverId, String name, Set<Permission> permissions) {
        if (name == null || name.trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role name cannot be empty");
        }
        if (permissions == null || permissions.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role permissions cannot be empty");
        }

        if (!serverRepository.existsById(serverId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found");
        }

        Role role = new Role();
        role.setId(UUID.randomUUID());
        role.setServerId(serverId);
        role.setName(name);
        role.setPermissions(permissions);

        return roleRepository.save(role);
    }

@Transactional
    public void assignRole(UUID serverId, String targetUserId, UUID roleId, String requesterId) {
        Server server = serverRepository.findById(serverId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Server not found"));

        if (!membershipRepository.existsByServerIdAndUserId(serverId, targetUserId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User is not a member of this server");
        }

        Role role = roleRepository.findById(roleId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Role not found"));
        if (!role.getServerId().equals(serverId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role does not belong to this server");
        }
        // DoD: requires MANAGE permission (or be the owner)
        boolean isOwner = server.getOwnerId().equals(requesterId);
        boolean hasManagePermission = isOwner || roleRepository.findRolesByUserAndServer(serverId, requesterId)
                .stream()
                .flatMap(r -> r.getPermissions().stream())
                .anyMatch(p -> p == Permission.MANAGE);

        if (!hasManagePermission) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You need MANAGE permissions to assign roles");
        }

        roleRepository.assignRoleToMember(serverId, targetUserId, roleId);
    }
}
