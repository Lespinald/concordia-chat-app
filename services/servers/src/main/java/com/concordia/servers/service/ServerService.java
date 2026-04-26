package com.concordia.servers.service;

import com.concordia.servers.model.Membership;
import com.concordia.servers.model.Server;
import com.concordia.servers.repository.MembershipRepository;
import com.concordia.servers.repository.ServerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class ServerService {

    private final ServerRepository serverRepository;
    private final MembershipRepository membershipRepository;

    public ServerService(ServerRepository serverRepository, MembershipRepository membershipRepository) {
        this.serverRepository = serverRepository;
        this.membershipRepository = membershipRepository;
    }

    // @Transactional asegura que si algo falla, no se guarde el servidor sin su membresía
    @Transactional
    public Server createServer(String name, String ownerId) {
        // 1. Crear y guardar el servidor
        Server server = new Server();
        server.setName(name);
        server.setOwnerId(ownerId);
        Server savedServer = serverRepository.save(server);

        // 2. Creating a server automatically adds creator as owner/member
        Membership membership = new Membership(savedServer.getId(), ownerId);
        membershipRepository.save(membership);

        return savedServer;
    }

    public List<Server> getServersByUserId(String userId) {
        // 1. Buscar a qué servidores pertenece este usuario
        List<Membership> memberships = membershipRepository.findByUserId(userId);

        // 2. Extraer solo los IDs de esos servidores
        List<UUID> serverIds = memberships.stream()
                .map(Membership::getServerId)
                .toList();

        // 3. Buscar los servidores por IDs
        return serverRepository.findAllById(serverIds);
    }

    public Optional<Server> getServerById(UUID id) {
        return serverRepository.findById(id);
    }

    @Transactional
    public Server updateServer(UUID id, String newName, String requesterId) {
        Server server = serverRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("NOT_FOUND"));

        // Solo el dueño puede editar
        if (!server.getOwnerId().equals(requesterId)) {
            throw new RuntimeException("FORBIDDEN");
        }

        server.setName(newName);
        return serverRepository.save(server); // Hace un UPDATE en la base de datos
    }

    @Transactional
    public void deleteServer(UUID id, String requesterId) {
        Server server = serverRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("NOT_FOUND"));

        //Solo el dueño puede borrar
        if (!server.getOwnerId().equals(requesterId)) {
            throw new RuntimeException("FORBIDDEN");
        }

        serverRepository.delete(server);
    }
}