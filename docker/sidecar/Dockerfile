FROM --platform=$BUILDPLATFORM docker.io/library/alpine:3.23 AS consul-template
ARG TARGETARCH
ARG CONSUL_TEMPLATE_VERSION=0.42.1
RUN apk add --no-cache curl unzip && \
    curl -fsSL -o /tmp/ct.zip "https://releases.hashicorp.com/consul-template/${CONSUL_TEMPLATE_VERSION}/consul-template_${CONSUL_TEMPLATE_VERSION}_linux_${TARGETARCH}.zip" && \
    curl -fsSL -o /tmp/ct.sums "https://releases.hashicorp.com/consul-template/${CONSUL_TEMPLATE_VERSION}/consul-template_${CONSUL_TEMPLATE_VERSION}_SHA256SUMS" && \
    echo "$(grep "_linux_${TARGETARCH}.zip" /tmp/ct.sums | cut -d' ' -f1)  /tmp/ct.zip" | sha256sum -c - && \
    unzip -j /tmp/ct.zip consul-template -d /out && \
    chmod +x /out/consul-template

FROM registry.dev.zextras.com/dev/carbonio-sidecar:main

RUN useradd -r -U carbonio-message-broker

# Service registration
COPY --from=consul-template /out/consul-template /usr/local/bin/consul-template
COPY package/carbonio-message-broker-template.hcl /consul/templates/carbonio-message-broker-template.hcl

# Setup files
COPY package/service-protocol.json /etc/carbonio/message-broker/service-discover/
COPY package/intentions.json       /etc/carbonio/message-broker/service-discover/
COPY package/policies.json         /etc/carbonio/message-broker/service-discover/

# Setup script (COPY --chmod avoids a target-arch RUN — QEMU-free)
COPY --chmod=755 package/carbonio-message-broker /usr/local/bin/carbonio-message-broker

ENV SERVICE_NAME=carbonio-message-broker
ENV SETUP_SCRIPT="carbonio-message-broker setup"
ENV TOKEN_FILE=/etc/carbonio/message-broker/service-discover/token

COPY --chmod=755 docker/sidecar/carbonio-message-broker-hcl-entrypoint /usr/local/bin/carbonio-message-broker-hcl-entrypoint
ENTRYPOINT ["carbonio-message-broker-hcl-entrypoint"]
