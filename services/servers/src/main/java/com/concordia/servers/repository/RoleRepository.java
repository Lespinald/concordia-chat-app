package com.concordia.servers.repository;

import com.concordia.servers.model.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RoleRepository extends JpaRepository<Role, UUID> {

    Optional<Role> findByServerIdAndName(UUID serverId, String name);

    @Query(value = "SELECT r.* FROM roles r INNER JOIN membership_roles mr ON r.id = mr.role_id WHERE mr.server_id = :serverId AND mr.user_id = :userId", nativeQuery = true)
    List<Role> findRolesByUserAndServer(@Param("serverId") UUID serverId, @Param("userId") String userId);

    @Modifying
    @Query(value = "INSERT INTO membership_roles (server_id, user_id, role_id) VALUES (:serverId, :userId, :roleId) ON CONFLICT DO NOTHING", nativeQuery = true)
    void assignRoleToMember(@Param("serverId") UUID serverId, @Param("userId") String userId, @Param("roleId") UUID roleId);
}
