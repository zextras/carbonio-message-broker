FROM rabbitmq:4.2.5-management-alpine

COPY docker/conf/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/conf/default_schema.json /etc/rabbitmq/default_schema.json

COPY package/carbonio-message-broker-setup-users /usr/local/bin/carbonio-message-broker-setup-users
RUN chmod +x /usr/local/bin/carbonio-message-broker-setup-users

EXPOSE 10000 10001
