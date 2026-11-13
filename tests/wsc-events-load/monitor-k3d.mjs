// SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

// Checks the WSC meeting media monitor on carbonio-k3d:
// 1. steady state: a new WebSocket gets only WebsocketConnected, meeting calls are not refused
// 2. Janus paused (SIGSTOP, broker connection stays open): MessageBrokerDisconnected within ~65 s,
//    meeting calls get 424, a WebSocket opened now gets WebsocketConnected + MessageBrokerDisconnected
// 3. Janus resumed: MessageBrokerRestored on every WebSocket, meeting calls accepted again
// 4. WSC consumer connection closed on the broker: MessageBrokerDisconnected at once, Restored after
// Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 node monitor-k3d.mjs --label main [--out monitor.jsonl]
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

const args = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];

const BASE = "https://localhost";
const CHATS = `${BASE}/services/chats`;
const NODE = "k3d-carbonio-server-0";
const kube = ["--context", "k3d-carbonio", "-n", "carbonio"];
const t0 = performance.now();
const at = () => Number(((performance.now() - t0) / 1000).toFixed(1));
const log = (...a) => console.log(`[${at()}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const janusSignal = (signal) =>
  execFileSync("docker", ["exec", NODE, "sh", "-c",
    `kill -${signal} $(ps -ef | grep /opt/zextras/common/bin/janus | grep -v grep | awk '{print $1}')`]);
let janusPaused = false;
process.on("exit", () => janusPaused && janusSignal("CONT"));
process.on("SIGINT", () => process.exit(130));

async function soap(name, body, token) {
  const header = token ? { context: { _jsns: "urn:zimbra", authToken: { _content: token } } } : {};
  const res = await fetch(`${BASE}/service/soap/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Header: header, Body: { [name]: body } }),
  });
  return (await res.json()).Body;
}

async function login(email) {
  const auth = await soap("AuthRequest", {
    _jsns: "urn:zimbraAccount", account: { by: "name", _content: email }, password: { _content: "assext" },
  });
  return { token: auth.AuthResponse.authToken[0]._content };
}

function open(user, label) {
  return new Promise((resolve) => {
    const events = [];
    const ws = new WebSocket(`${CHATS}/events`, {
      protocols: ["1.6.2", "1.6.1", "1.6.0"], headers: { Cookie: `ZM_AUTH_TOKEN=${user.token}` },
    });
    ws.onmessage = (m) => {
      const type = JSON.parse(m.data).type;
      if (!/WebsocketConnected|MessageBroker/.test(type)) return;
      events.push({ type, at: at() });
      log(label, type);
      if (type === "WebsocketConnected") resolve({ ws, events, label });
    };
  });
}

async function meetingCallStatus(user) {
  const res = await fetch(`${CHATS}/meetings/${randomUUID()}/hand`, {
    method: "PUT", headers: { Cookie: `ZM_AUTH_TOKEN=${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raised: true }),
  });
  await res.text();
  return res.status;
}

async function waitFor(session, type, count, timeoutS) {
  const deadline = at() + timeoutS;
  while (at() < deadline) {
    const seen = session.events.filter((e) => e.type === type);
    if (seen.length >= count) return seen[count - 1].at;
    await sleep(200);
  }
  return null;
}

function closeWscConsumerConnections() {
  const pod = execFileSync("kubectl", [...kube, "get", "pod", "-l", "app=carbonio-message-broker",
    "-o", "jsonpath={.items[0].metadata.name}"], { encoding: "utf8" });
  const lines = execFileSync("kubectl", [...kube, "exec", pod, "-c", "app", "--", "rabbitmqctl", "-q",
    "list_connections", "--no-table-headers", "pid", "client_properties"], { encoding: "utf8" }).split("\n");
  const pids = lines.filter((l) => l.includes("carbonio-ws-collaboration-consumer@")).map((l) => l.split(/\s/)[0]);
  for (const pid of pids)
    execFileSync("kubectl", [...kube, "exec", pod, "-c", "app", "--", "rabbitmqctl", "-q", "close_connection", pid, "monitor test"]);
  return pids.length;
}

const results = { label: args.label ?? "" };
const user = await login("user@carbonio.localhost");

log("== 1. steady state");
const a = await open(user, "A");
await sleep(3000);
results.steadyEvents = a.events.map((e) => e.type);
results.steadyMeetingCall = await meetingCallStatus(user);
log("A events", results.steadyEvents, "meeting call", results.steadyMeetingCall);

log("== 2. Janus paused");
janusSignal("STOP");
janusPaused = true;
const pausedAt = at();
const disconnectedAt = await waitFor(a, "MessageBrokerDisconnected", 1, 100);
results.disconnectedAfterPauseS = disconnectedAt && Number((disconnectedAt - pausedAt).toFixed(1));
results.pausedMeetingCall = await meetingCallStatus(user);
const b = await open(user, "B");
await sleep(3000);
results.openedDuringOutageEvents = b.events.map((e) => e.type);
log("disconnected after", results.disconnectedAfterPauseS, "s; meeting call", results.pausedMeetingCall,
  "; B events", results.openedDuringOutageEvents);

log("== 3. Janus resumed");
janusSignal("CONT");
janusPaused = false;
const resumedAt = at();
const restoredA = await waitFor(a, "MessageBrokerRestored", 1, 60);
const restoredB = await waitFor(b, "MessageBrokerRestored", 1, 5);
results.restoredAfterResumeS = restoredA && Number((restoredA - resumedAt).toFixed(1));
results.restoredReachedB = restoredB !== null;
results.resumedMeetingCall = await meetingCallStatus(user);
log("restored after", results.restoredAfterResumeS, "s; B restored", results.restoredReachedB,
  "; meeting call", results.resumedMeetingCall);

log("== 4. WSC consumer connection closed on the broker");
const closed = closeWscConsumerConnections();
const closedAt = at();
const disconnected2 = await waitFor(a, "MessageBrokerDisconnected", 2, 10);
results.consumerConnectionsClosed = closed;
results.disconnectedAfterCloseS = disconnected2 && Number((disconnected2 - closedAt).toFixed(1));
const restored2 = await waitFor(a, "MessageBrokerRestored", 2, 60);
results.restoredAfterCloseS = restored2 && Number((restored2 - closedAt).toFixed(1));
results.finalMeetingCall = await meetingCallStatus(user);
log("disconnected after", results.disconnectedAfterCloseS, "s; restored after", results.restoredAfterCloseS,
  "s; meeting call", results.finalMeetingCall);

a.ws.close();
b.ws.close();
console.log(JSON.stringify(results));
if (args.out) appendFileSync(args.out, JSON.stringify(results) + "\n");
process.exit(0);
