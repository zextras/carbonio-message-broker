FROM rabbitmq:4.2.5-management-alpine

COPY docker/conf/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/conf/default_schema.json /etc/rabbitmq/default_schema.json

# Install consul CLI for setup-users script (consul KV access)
COPY --from=docker.io/hashicorp/consul:1.21 /bin/consul /usr/local/bin/consul

COPY package/carbonio-message-broker-setup-users /usr/local/bin/carbonio-message-broker-setup-users
RUN chmod +x /usr/local/bin/carbonio-message-broker-setup-users

EXPOSE 10000 10001
