package com.concordia.servers.controller;
import com.concordia.servers.model.Permission;
import java.util.Set;

public record RoleRequest(String name, Set<Permission> permissions) {}
