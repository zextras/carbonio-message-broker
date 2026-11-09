# SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
#
# SPDX-License-Identifier: AGPL-3.0-only

FROM docker.io/library/maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src src
RUN mvn -B -q package

FROM docker.io/library/eclipse-temurin:21-jre
COPY --from=build /src/target/wsc-events-load-1.0.0.jar /app/load.jar
COPY --from=build /src/target/lib /app/lib
ENTRYPOINT ["java", "-Xmx1g", "-cp", "/app/load.jar:/app/lib/*", "load.WscEventsLoad"]
