<!--
SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>

SPDX-License-Identifier: AGPL-3.0-only
-->

# WSC events load test

Stress tests for the way Carbonio Workstream Collaboration (WSC) delivers room and meeting events
through this broker, with several WSC instances.

## Broker load (`WscEventsLoad`)

Replays the AMQP calls of each WSC delivery design for N simulated WSC pods, then publishes
10 … 100 000 events to rooms of M members from concurrent callers (the REST threads).

| Mode | What it replays |
|---|---|
| `legacy` | WSC ≤ 1.15: one exchange per user, one queue and channel per WebSocket session, an `exchangeDeclare` before every publish |
| `instance` | CO-4512: one exclusive queue per pod bound `#` to the `wsc.events` topic exchange, one message per target user |
| `batch` | as `instance`, one message per event listing its target users in the `users` header |
| `interest` | as `instance`, each pod binds only the users it has sessions for |

It reports, per step: delivered, lost and duplicate deliveries, publisher drops, time, throughput,
end-to-end latency, how long callers wait inside `publish`, and the broker footprint.
With `--storm N` it also opens and closes N sessions at once.

```bash
./run-k3d.sh results.jsonl legacy instance batch -- --pods 2 --members 10 --events 10,100,1000
```

`run-k3d.sh` builds the image, imports it into the carbonio-k3d cluster and runs one pod per mode
next to the broker, with the broker admin credentials read from Consul. Options:
`--pods --users --sessions --members --callers --events --kind room|meeting --storm
--max-pending --max-length --offer-ms --label`.

## End to end (`e2e-k3d.mjs`)

Drives the real WSC pods of the carbonio-k3d cluster: WebSocket sessions for several users, then
N `PUT /rooms/{id}` (`RoomUpdated`) or N hand raise/lower (`MeetingParticipantHandRaised`), and
optionally a reconnect storm. Creates the `loadN@carbonio.localhost` accounts it needs.

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node e2e-k3d.mjs --label main --kind room \
  --events 10,100,1000,10000 --users 6 --sessions 2 --storm 500 --out e2e.jsonl
```

## Broker stall (`stall-k3d.mjs`)

Reproduces CO-4512: pauses RabbitMQ with `SIGSTOP` from the k3d node (connections stay open),
opens N WebSockets while it is paused, probes REST and `/health/live` of every WSC pod each second,
resumes the broker and measures recovery. Set `carbonio-ws-collaboration/server/max-threads` low
(e.g. 50) in Consul and restart WSC first to make thread exhaustion visible.

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node stall-k3d.mjs --label main --sessions 300 --stall 45 --out stall.jsonl
```
