package com.concordia.servers.grpc;

import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.protobuf.services.ProtoReflectionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

@Component
public class GrpcServerRunner implements ApplicationRunner, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(GrpcServerRunner.class);

    @Value("${grpc.port:50051}")
    private int grpcPort;

    private final PermServiceImpl permServiceImpl;
    private Server server;

    public GrpcServerRunner(PermServiceImpl permServiceImpl) {
        this.permServiceImpl = permServiceImpl;
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        server = ServerBuilder.forPort(grpcPort)
                .addService(permServiceImpl)
                .addService(ProtoReflectionService.newInstance())
                .build()
                .start();
        log.info("gRPC server started on port {}", grpcPort);
    }

    @Override
    public void destroy() throws InterruptedException {
        if (server != null) {
            log.info("Shutting down gRPC server");
            server.shutdown().awaitTermination(30, TimeUnit.SECONDS);
        }
    }
}
