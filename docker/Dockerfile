FROM rabbitmq:3.13.6-management-alpine

COPY docker/conf/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/conf/default_schema.json /etc/rabbitmq/default_schema.json

EXPOSE 10000 10001
