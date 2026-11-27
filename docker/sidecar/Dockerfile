FROM --platform=$BUILDPLATFORM docker.io/library/alpine:3.20 AS hcl
COPY package/carbonio-message-broker-template.hcl /carbonio-message-broker-template.hcl
RUN sed -E 's/\{\{ or \(env "[A-Z0-9_]+"\) "([^"]*)" \}\}/\1/g' \
    /carbonio-message-broker-template.hcl > /carbonio-message-broker.hcl \
    && ! grep -q '{{' /carbonio-message-broker.hcl

FROM registry.dev.zextras.com/dev/carbonio-sidecar:main

RUN useradd -r -U carbonio-message-broker

# Service registration
COPY --from=hcl /carbonio-message-broker.hcl /consul/config/

# Setup files
COPY package/service-protocol.json /etc/carbonio/message-broker/service-discover/
COPY package/intentions.json       /etc/carbonio/message-broker/service-discover/
COPY package/policies.json         /etc/carbonio/message-broker/service-discover/

# Setup script (COPY --chmod avoids a target-arch RUN — QEMU-free)
COPY --chmod=755 package/carbonio-message-broker /usr/local/bin/carbonio-message-broker

ENV SERVICE_NAME=carbonio-message-broker
ENV SETUP_SCRIPT="carbonio-message-broker setup"
ENV TOKEN_FILE=/etc/carbonio/message-broker/service-discover/token
