FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
# Copy all POMs so Maven can resolve the reactor graph
COPY pom.xml .
COPY contracts/lib/java/authmw/pom.xml contracts/lib/java/authmw/pom.xml
COPY services/auth/pom.xml services/auth/pom.xml
COPY services/servers/pom.xml services/servers/pom.xml
# Copy only auth source
COPY services/auth/src services/auth/src
RUN mvn -pl services/auth package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
COPY --from=build /build/services/auth/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
