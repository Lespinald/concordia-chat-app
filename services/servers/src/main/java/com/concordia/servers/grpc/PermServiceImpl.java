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
            String rawServerId = request.getServerId();
            if (rawServerId == null || rawServerId.isBlank()) {
                serverId = channelRepository.findById(channelId)
                        .orElseThrow(() -> new IllegalArgumentException("channel not found: " + channelId))
                        .getServerId();
            } else {
                serverId = UUID.fromString(rawServerId);
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
