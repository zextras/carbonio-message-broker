#!/usr/bin/env bash

# SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
#
# SPDX-License-Identifier: AGPL-3.0-only

# Runs the load test as pods inside the carbonio-k3d cluster, against its message broker.
# Usage: ./run-k3d.sh RESULTS_FILE MODE [MODE...] [-- LOAD_TEST_OPTIONS]
# Example: ./run-k3d.sh results.jsonl legacy instance -- --pods 2 --events 10,100,1000

set -euo pipefail

context=${KUBE_CONTEXT:-k3d-carbonio}
namespace=${NAMESPACE:-carbonio}
k3d=${K3D:-k3d}
image=localhost/wsc-events-load:dev
here=$(cd "$(dirname "$0")" && pwd)

results=$1
shift
modes=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
  modes+=("$1")
  shift
done
[ $# -gt 0 ] && shift

kube() { kubectl --context "$context" -n "$namespace" "$@"; }
urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))'; }

docker build -q -t "$image" "$here" >/dev/null
"$k3d" image import "$image" -c carbonio >/dev/null

broker=$(kube get pod -l app=carbonio-message-broker -o jsonpath='{.items[0].metadata.name}')
ip=$(kube get pod "$broker" -o jsonpath='{.status.podIP}')
read_kv() {
  kube exec "$broker" -c app -- consul kv get \
    -token-file=/etc/carbonio/message-broker/service-discover/token "carbonio-message-broker/admin/$1" |
    tr -d '\n' | urlencode
}
user=$(read_kv username)
password=$(read_kv password)
kube create secret generic wsc-events-load --dry-run=client -o yaml \
  --from-literal=AMQP_URI="amqp://$user:$password@$ip:10000" \
  --from-literal=MGMT_URI="http://$user:$password@$ip:10001" | kube apply -f - >/dev/null
trap 'kube delete secret wsc-events-load --ignore-not-found >/dev/null' EXIT

for mode in "${modes[@]}"; do
  pod="wsc-events-load-$mode"
  kube delete pod "$pod" --ignore-not-found --wait >/dev/null
  {
    cat <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $pod
spec:
  restartPolicy: Never
  containers:
    - name: load
      image: $image
      imagePullPolicy: Never
      envFrom:
        - secretRef:
            name: wsc-events-load
      args:
        - "--mode"
        - "$mode"
EOF
    for arg in "$@"; do printf '        - "%s"\n' "$arg"; done
  } | kube apply -f - >/dev/null

  until phase=$(kube get pod "$pod" -o jsonpath='{.status.phase}') &&
    { [ "$phase" = Succeeded ] || [ "$phase" = Failed ]; }; do
    sleep 5
  done
  kube logs "$pod" | grep '^RESULT ' | sed 's/^RESULT //' | tee -a "$results"
  [ "$phase" = Succeeded ] || { kube logs "$pod" | tail -20 >&2; exit 1; }
  kube delete pod "$pod" --wait=false >/dev/null
done
