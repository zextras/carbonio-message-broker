// SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

// Drives the real WSC pods of the carbonio-k3d cluster: opens WebSocket sessions, makes REST calls
// that emit room or meeting events, and reports delivery, loss and latency per step.
// Talks only to the local cluster at https://localhost (self-signed certificate), so run it with
// NODE_TLS_REJECT_UNAUTHORIZED=0.
// Usage: node e2e-k3d.mjs --label main --kind room|meeting --events 10,100,1000 [--users 6]
//        [--sessions 2] [--concurrency 16] [--storm 500] [--out results.jsonl]

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const args = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BASE = "https://localhost";
const CHATS = `${BASE}/services/chats`;
const USERS = Number(args.users ?? 6);
const PER_USER = Number(args.sessions ?? 2);
const CONCURRENCY = Number(args.concurrency ?? 16);
const KIND = args.kind ?? "room";
const STEPS = (args.events ?? "10,100,1000").split(",").map(Number);
const IDLE_MS = Number(args.idle ?? 20000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kubectl = (...a) =>
  execFileSync("kubectl", ["--context", "k3d-carbonio", "-n", "carbonio", ...a], { encoding: "utf8" });

async function soap(name, body, token) {
  const header = token ? { context: { _jsns: "urn:zimbra", authToken: { _content: token } } } : {};
  const res = await fetch(`${BASE}/service/soap/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Header: header, Body: { [name]: body } }),
  });
  return (await res.json()).Body;
}

async function login(email) {
  let auth = await soap("AuthRequest", {
    _jsns: "urn:zimbraAccount",
    account: { by: "name", _content: email },
    password: { _content: "assext" },
  });
  if (!auth.AuthResponse) {
    kubectl("exec", "carbonio-mailbox-0", "-c", "app", "--", "zmprov", "ca", email, "assext");
    return login(email);
  }
  const token = auth.AuthResponse.authToken[0]._content;
  const info = await soap("GetInfoRequest", { _jsns: "urn:zimbraAccount", sections: "attrs" }, token);
  return { email, token, id: info.GetInfoResponse.id, sessions: [] };
}

function openSession(user, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${CHATS}/events`, {
      protocols: ["1.6.2", "1.6.1", "1.6.0"],
      headers: { Cookie: `ZM_AUTH_TOKEN=${user.token}` },
    });
    const session = { user, ws, queueId: null };
    const timer = setTimeout(() => reject(new Error(`${user.email}: no WebsocketConnected`)), 15000);
    ws.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "WebsocketConnected") {
        session.queueId = event.queueId;
        clearTimeout(timer);
        resolve(session);
      } else onEvent(session, event);
    };
    ws.onerror = (e) => reject(new Error(`${user.email}: ${e.message ?? e}`));
    user.sessions.push(session);
  });
}

async function api(user, method, path, body, queueId) {
  const headers = { Cookie: `ZM_AUTH_TOKEN=${user.token}`, "Content-Type": "application/json" };
  if (queueId) headers["queue-id"] = queueId;
  const res = await fetch(`${CHATS}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${text}`), { status: res.status });
  return text ? JSON.parse(text) : null;
}

async function retryOn424(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (e) {
      if (e.status !== 424 || attempt > 60) throw e;
      await sleep(2000);
    }
  }
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

const emails = ["user@carbonio.localhost", "admin@carbonio.localhost"];
for (let i = 1; emails.length < USERS; i++) emails.push(`load${i}@carbonio.localhost`);
const users = [];
for (const email of emails) users.push(await login(email));
const [owner] = users;

// Per step: what each session saw, keyed by event identity, and when each event was triggered.
let step = null;
function onEvent(session, event) {
  if (!step) return;
  const key = step.keyOf(session, event);
  if (key === undefined) return;
  const now = performance.now();
  step.received++;
  if (session.seen.has(key)) step.duplicates++;
  else {
    session.seen.add(key);
    step.unique++;
    const sent = step.sentAt.get(key);
    if (sent !== undefined) step.latencies.push(now - sent);
  }
  step.lastProgress = now;
}

for (const user of users) for (let j = 0; j < PER_USER; j++) await openSession(user, onEvent);
const sessions = users.flatMap((u) => u.sessions);

const room = await api(owner, "POST", "/rooms", {
  name: `wsc-load-${Date.now()}`,
  description: "",
  type: "group",
  members: users.slice(1).map((u) => ({ userId: u.id, owner: false })),
});

let meetingId;
if (KIND === "meeting") {
  meetingId = room.meetingId ?? (await api(owner, "POST", "/meetings", { name: room.name, roomId: room.id, meetingType: "permanent" })).id;
  await retryOn424(() => api(owner, "POST", `/meetings/${meetingId}/start`, null, owner.sessions[0].queueId));
  for (const user of users)
    await retryOn424(() =>
      api(user, "POST", `/meetings/${meetingId}/join`, { audioStreamEnabled: false, videoStreamEnabled: false }, user.sessions[0].queueId));
}
await sleep(2000);

const toggles = new Map(users.map((u) => [u.id, 0]));
for (const events of STEPS) {
  const tag = `${args.label ?? "load"}-${events}-${Date.now()}`;
  sessions.forEach((s) => {
    s.seen = new Set();
    s.handEvents = new Map();
  });
  step = {
    sentAt: new Map(),
    received: 0,
    unique: 0,
    duplicates: 0,
    latencies: [],
    lastProgress: performance.now(),
    keyOf:
      KIND === "room"
        ? (session, event) => (event.type === "RoomUpdated" && event.name?.startsWith(`${tag}-`) ? event.name : undefined)
        : (session, event) => {
            if (event.type !== "MeetingParticipantHandRaised" || event.meetingId !== meetingId) return undefined;
            const n = (session.handEvents.get(event.userId) ?? 0) + 1;
            session.handEvents.set(event.userId, n);
            return `${event.userId}:${n}`;
          },
  };

  const restMs = [];
  let restErrors = 0;
  const started = performance.now();
  if (KIND === "room") {
    let next = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let i = next++; i < events; i = next++) {
          const name = `${tag}-${i}`;
          const t = performance.now();
          step.sentAt.set(name, t);
          try {
            await api(owner, "PUT", `/rooms/${room.id}`, { name });
          } catch {
            restErrors++;
          }
          restMs.push(performance.now() - t);
        }
      }),
    );
  } else {
    let next = 0;
    await Promise.all(
      users.map(async (user) => {
        let n = 0;
        while (next++ < events) {
          const k = toggles.get(user.id) + 1;
          toggles.set(user.id, k);
          n++;
          const t = performance.now();
          step.sentAt.set(`${user.id}:${n}`, t);
          try {
            await api(user, "PUT", `/meetings/${meetingId}/hand`, { raised: k % 2 === 1 });
          } catch {
            restErrors++;
          }
          restMs.push(performance.now() - t);
        }
      }),
    );
  }
  const restPhaseMs = performance.now() - started;

  const expected = events * sessions.length;
  while (step.unique < expected && performance.now() - step.lastProgress < IDLE_MS) await sleep(50);
  const totalMs = (step.unique === expected ? performance.now() : step.lastProgress) - started;

  const latencies = step.latencies.sort((a, b) => a - b);
  const rest = restMs.sort((a, b) => a - b);
  const result = {
    label: args.label ?? "",
    kind: KIND,
    users: USERS,
    sessions: sessions.length,
    events,
    expectedDeliveries: expected,
    delivered: step.unique,
    lost: expected - step.unique,
    duplicates: step.duplicates,
    restErrors,
    restPhaseMs: Math.round(restPhaseMs),
    totalMs: Math.round(totalMs),
    eventsPerSec: Math.round((events * 1000) / Math.max(1, totalMs)),
    restP50Ms: +percentile(rest, 0.5).toFixed(1),
    restP99Ms: +percentile(rest, 0.99).toFixed(1),
    p50Ms: +percentile(latencies, 0.5).toFixed(1),
    p95Ms: +percentile(latencies, 0.95).toFixed(1),
    p99Ms: +percentile(latencies, 0.99).toFixed(1),
    maxMs: +(latencies.at(-1) ?? 0).toFixed(1),
  };
  console.log(JSON.stringify(result));
  if (args.out) appendFileSync(args.out, `${JSON.stringify(result)}\n`);
}
step = null;

const STORM = Number(args.storm ?? 0);
if (STORM > 0) {
  const connect = [];
  const failures = [];
  const started = performance.now();
  const opened = await Promise.all(
    Array.from({ length: STORM }, async (_, i) => {
      const user = users[i % users.length];
      const t = performance.now();
      try {
        const session = await openSession({ ...user, sessions: [] }, () => {});
        connect.push(performance.now() - t);
        return session;
      } catch (e) {
        failures.push(String(e.message ?? e));
        return null;
      }
    }),
  );
  const openMs = performance.now() - started;
  opened.filter(Boolean).forEach((s) => s.ws.close());
  const sorted = connect.sort((a, b) => a - b);
  const result = {
    label: args.label ?? "",
    kind: "storm",
    sessions: STORM,
    connected: sorted.length,
    failed: failures.length,
    openMs: Math.round(openMs),
    connectP50Ms: +percentile(sorted, 0.5).toFixed(1),
    connectP99Ms: +percentile(sorted, 0.99).toFixed(1),
    connectMaxMs: +(sorted.at(-1) ?? 0).toFixed(1),
  };
  console.log(JSON.stringify(result));
  if (args.out) appendFileSync(args.out, `${JSON.stringify(result)}\n`);
  await sleep(3000);
}

if (meetingId) await api(owner, "POST", `/meetings/${meetingId}/stop`, null, owner.sessions[0].queueId).catch(() => {});
await api(owner, "DELETE", `/rooms/${room.id}`).catch(() => {});
sessions.forEach((s) => s.ws.close());
process.exit(0);
