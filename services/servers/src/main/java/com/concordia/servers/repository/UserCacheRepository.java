package com.concordia.servers.repository;

import com.concordia.servers.model.UserCache;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface UserCacheRepository extends JpaRepository<UserCache, String> {

    @Modifying
    @Query(value = "INSERT INTO users_cache (user_id, username) VALUES (:userId, :username) " +
                   "ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username", 
           nativeQuery = true)
    void upsertUser(@Param("userId") String userId, @Param("username") String username);
}
