FROM maven:3.9.6-eclipse-temurin-21-jammy AS build
WORKDIR /app

# Copy parent pom
COPY pom.xml .

# Copy service
COPY services/auth services/auth

# Package the service
RUN mvn -f services/auth/pom.xml clean package -DskipTests

# Run stage
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=build /app/services/auth/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
