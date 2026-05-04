package com.concordia.servers.grpc;

import com.concordia.proto.CheckPermRequest;
import com.concordia.proto.CheckPermResponse;
import com.concordia.proto.PermServiceGrpc;
import com.concordia.servers.model.Permission;
import com.concordia.servers.service.PermissionService;
import io.grpc.stub.StreamObserver;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class PermServiceImpl extends PermServiceGrpc.PermServiceImplBase {

    private final PermissionService permissionService;

    public PermServiceImpl(PermissionService permissionService) {
        this.permissionService = permissionService;
    }

    @Override
    public void checkPerm(CheckPermRequest request, StreamObserver<CheckPermResponse> responseObserver) {
        try {
            UUID serverId = UUID.fromString(request.getServerId());
            UUID channelId = UUID.fromString(request.getChannelId());
            String userId = request.getUserId();
            Permission permission = Permission.valueOf(request.getAction().name());

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
