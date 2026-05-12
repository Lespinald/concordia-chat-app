FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

COPY pom.xml .
COPY contracts/lib/java/authmw/pom.xml contracts/lib/java/authmw/pom.xml
COPY services/auth/pom.xml services/auth/pom.xml
COPY services/servers/pom.xml services/servers/pom.xml

COPY contracts/proto contracts/proto
COPY services/servers/src services/servers/src
RUN mvn -pl services/servers package -DskipTests

FROM eclipse-temurin:21-jre-alpine
COPY --from=build /build/services/servers/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
