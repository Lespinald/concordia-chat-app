package com.concordia.servers.repository;

import com.concordia.servers.model.Server;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ServerRepository extends JpaRepository<Server, UUID> {
    List<Server> findByNameContainingIgnoreCase(String name);
}
