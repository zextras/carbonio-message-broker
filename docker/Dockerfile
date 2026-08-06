# Consul CLI stage: pinned to TARGETPLATFORM so the arm64 image gets the arm64
# binary. No RUN in any target-platform stage — the build is QEMU-free.
FROM --platform=$TARGETPLATFORM docker.io/hashicorp/consul:1.21 AS consul

FROM docker.io/library/rabbitmq:4.2.5-management-alpine

COPY docker/conf/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/conf/default_schema.json /etc/rabbitmq/default_schema.json

# Install consul CLI for setup-users script (consul KV access)
COPY --from=consul /bin/consul /usr/local/bin/consul

# Setup script + entrypoint (COPY --chmod avoids a target-arch RUN — QEMU-free)
COPY --chmod=755 package/carbonio-message-broker-setup-users /usr/local/bin/carbonio-message-broker-setup-users
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/carbonio-message-broker-entrypoint

ENV CONSUL_SETUP=false
EXPOSE 10000 10001

ENTRYPOINT ["carbonio-message-broker-entrypoint"]
