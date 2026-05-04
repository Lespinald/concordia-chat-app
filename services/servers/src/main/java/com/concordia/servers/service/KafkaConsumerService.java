package com.concordia.servers.service;

import com.concordia.servers.repository.UserCacheRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KafkaConsumerService {

    private static final Logger logger = LoggerFactory.getLogger(KafkaConsumerService.class);
    private final UserCacheRepository userCacheRepository;
    private final ObjectMapper objectMapper;

    public KafkaConsumerService(UserCacheRepository userCacheRepository, ObjectMapper objectMapper) {
        this.userCacheRepository = userCacheRepository;
        this.objectMapper = objectMapper; 
    }

    @KafkaListener(topics = "user-registered", groupId = "servers-svc-user-registry")
    @Transactional
    public void consumeUserRegisteredEvent(String message) {
        try {
            logger.info("Received event from Kafka: {}", message);
            
            JsonNode jsonNode = objectMapper.readTree(message);
            String userId = jsonNode.get("user_id").asText();
            String username = jsonNode.get("username").asText();

            userCacheRepository.upsertUser(userId, username);
            
            logger.info("Successfully upserted user cache for user_id: {}", userId);

        } catch (JsonProcessingException e) {
            logger.error("Error parsing user-registered event JSON: {}", message, e);
        } catch (Exception e) {
            logger.error("Unexpected error processing Kafka message", e);
        }
    }
}
