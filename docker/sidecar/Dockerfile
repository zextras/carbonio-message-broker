FROM registry.dev.zextras.com/dev/carbonio-sidecar:latest

# Service registration
COPY package/carbonio-message-broker.hcl /consul/config/

# Setup files
COPY package/service-protocol.json /etc/carbonio/message-broker/service-discover/
COPY package/intentions.json       /etc/carbonio/message-broker/service-discover/
COPY package/policies.json         /etc/carbonio/message-broker/service-discover/

# Setup script
COPY docker/sidecar/carbonio-message-broker-setup /usr/local/bin/carbonio-message-broker-setup
RUN chmod +x /usr/local/bin/carbonio-message-broker-setup

ENV SERVICE_NAME=carbonio-message-broker
ENV SETUP_SCRIPT="carbonio-message-broker-setup"
ENV TOKEN_FILE=/etc/carbonio/message-broker/service-discover/token
