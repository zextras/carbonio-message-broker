#!/bin/bash

if [ "${CONSUL_SETUP}" != "false" ]; then
  echo "[message-broker] Waiting for consul agent..."
  until consul members >/dev/null 2>&1; do sleep 1; done
  echo "[message-broker] Consul agent ready."

  # Wait for RabbitMQ to be ready, then run setup-users in background
  (
    echo "Waiting for RabbitMQ to be ready..."
    until rabbitmqctl status >/dev/null 2>&1; do sleep 2; done
    echo "RabbitMQ is ready, running setup-users..."
    carbonio-message-broker-setup-users
  ) &
fi

# Exec into the original RabbitMQ entrypoint
exec docker-entrypoint.sh rabbitmq-server
