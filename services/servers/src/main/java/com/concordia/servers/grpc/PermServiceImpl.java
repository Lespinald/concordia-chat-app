package com.concordia.servers.grpc;

import com.concordia.proto.CheckPermRequest;
import com.concordia.proto.CheckPermResponse;
import com.concordia.proto.PermServiceGrpc;
import com.concordia.servers.model.Permission;
import com.concordia.servers.repository.ChannelRepository;
import com.concordia.servers.service.PermissionService;
import io.grpc.stub.StreamObserver;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class PermServiceImpl extends PermServiceGrpc.PermServiceImplBase {

    private final PermissionService permissionService;
    private final ChannelRepository channelRepository;

    public PermServiceImpl(PermissionService permissionService, ChannelRepository channelRepository) {
        this.permissionService = permissionService;
        this.channelRepository = channelRepository;
    }

    @Override
    public void checkPerm(CheckPermRequest request, StreamObserver<CheckPermResponse> responseObserver) {
        try {
            UUID channelId = UUID.fromString(request.getChannelId());
            String userId = request.getUserId();
            Permission permission = Permission.valueOf(request.getAction().name());

            UUID serverId;
            if (request.getServerId().isBlank()) {
                // Voice service doesn't know the server — derive it from the channel
                serverId = channelRepository.findById(channelId)
                        .map(ch -> ch.getServerId())
                        .orElseThrow(() -> new IllegalArgumentException("channel not found: " + channelId));
            } else {
                serverId = UUID.fromString(request.getServerId());
            }

            PermissionService.CheckResult result =
                    permissionService.checkPerm(userId, serverId, channelId, permission);

            responseObserver.onNext(CheckPermResponse.newBuilder()
                    .setAllowed(result.allowed())
                    .setReason(result.reason())
                    .build());
            responseObserver.onCompleted();
        } catch (IllegalArgumentException e) {
            responseObserver.onNext(CheckPermResponse.newBuilder()
                    .setAllowed(false)
                    .setReason("invalid request: " + e.getMessage())
                    .build());
            responseObserver.onCompleted();
        }
    }
}
