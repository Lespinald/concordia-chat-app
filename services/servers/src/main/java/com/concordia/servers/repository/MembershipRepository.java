package com.concordia.servers.repository;

import com.concordia.servers.model.Membership;
import com.concordia.servers.model.MembershipId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface MembershipRepository extends JpaRepository<Membership, MembershipId> {

    List<Membership> findByUserId(String userId);

    boolean existsByServerIdAndUserId(UUID serverId, String userId);
}
