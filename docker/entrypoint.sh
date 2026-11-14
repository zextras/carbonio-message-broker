#!/bin/bash

TOKEN_FILE=/etc/carbonio/message-broker/service-discover/token
COOKIE_KEY=carbonio-message-broker-clustered/erlang-cookie

# Every node must share the cookie: the first one to start stores it, the others read it.
write_cluster_cookie() {
  consul kv put -token-file="$TOKEN_FILE" -cas -modify-index=0 "$COOKIE_KEY" "$(openssl rand -hex 32)" >/dev/null 2>&1
  local cookie
  cookie=$(consul kv get -token-file="$TOKEN_FILE" "$COOKIE_KEY") && [ -n "$cookie" ] || return 1
  printf '%s' "$cookie" > "$HOME/.erlang.cookie" && chmod 600 "$HOME/.erlang.cookie"
}

if [ "${CONSUL_SETUP}" != "false" ]; then
  echo "[message-broker] Waiting for consul agent..."
  until consul members >/dev/null 2>&1; do sleep 1; done
  until [ -s "$TOKEN_FILE" ]; do sleep 1; done
  echo "[message-broker] Consul agent ready."

  export CONSUL_ACL_TOKEN
  CONSUL_ACL_TOKEN=$(cat "$TOKEN_FILE")
  write_cluster_cookie || { echo "[message-broker] Cannot read the Erlang cookie from Consul KV" >&2; exit 1; }
  cp /etc/rabbitmq/cluster.conf /etc/rabbitmq/conf.d/20-cluster.conf

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
