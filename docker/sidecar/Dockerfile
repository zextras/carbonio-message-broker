FROM registry.dev.zextras.com/dev/carbonio-sidecar:devel

# Service registration
COPY package/carbonio-message-broker.hcl /consul/config/

# Setup files
COPY package/service-protocol.json /etc/carbonio/message-broker/service-discover/
COPY package/intentions.json       /etc/carbonio/message-broker/service-discover/
COPY package/policies.json         /etc/carbonio/message-broker/service-discover/

# Setup script (COPY --chmod avoids a target-arch RUN — QEMU-free)
COPY --chmod=755 package/carbonio-message-broker /usr/local/bin/carbonio-message-broker

ENV SERVICE_NAME=carbonio-message-broker
ENV SETUP_SCRIPT="carbonio-message-broker setup"
ENV TOKEN_FILE=/etc/carbonio/message-broker/service-discover/token
