FROM docker.io/library/rabbitmq:4.2.5-management-alpine

COPY docker/conf/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/conf/default_schema.json /etc/rabbitmq/default_schema.json

# Install consul CLI for setup-users script (consul KV access)
COPY --from=docker.io/hashicorp/consul:2.0 /bin/consul /usr/local/bin/consul

COPY package/carbonio-message-broker-setup-users /usr/local/bin/carbonio-message-broker-setup-users
COPY docker/entrypoint.sh /usr/local/bin/carbonio-message-broker-entrypoint
RUN chmod +x /usr/local/bin/carbonio-message-broker-setup-users \
             /usr/local/bin/carbonio-message-broker-entrypoint

ENV CONSUL_SETUP=false
EXPOSE 10000 10001

ENTRYPOINT ["carbonio-message-broker-entrypoint"]
