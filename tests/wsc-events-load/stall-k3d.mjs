// SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

// CO-4512 reproduction on the carbonio-k3d cluster: pauses RabbitMQ (SIGSTOP, TCP connections stay
// open), opens N WebSockets to WSC while it is paused, probes REST and /health/live of every WSC pod
// throughout, resumes the broker and measures recovery. Always resumes the broker on exit.
// Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 node stall-k3d.mjs --label main [--sessions 300]
//        [--stall 45] [--recover 60] [--out stall.jsonl]

import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const BASE = "https://localhost";
const CHATS = `${BASE}/services/chats`;
const SESSIONS = Number(args.sessions ?? 300);
const STALL_S = Number(args.stall ?? 45);
const RECOVER_S = Number(args.recover ?? 60);
const NODE = args.node ?? "k3d-carbonio-server-0";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kube = ["--context", "k3d-carbonio", "-n", "carbonio"];
const now = () => performance.now();

const brokerSignal = (signal) =>
  execFileSync("docker", [
    "exec", NODE, "sh", "-c",
    `kill -${signal} $(ps -ef | grep beam.smp | grep -i rabbit | grep -v grep | awk '{print $1}')`,
  ]);
let paused = false;
const resume = () => {
  if (paused) brokerSignal("CONT");
  paused = false;
};
process.on("exit", resume);
process.on("SIGINT", () => process.exit(130));

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
  const auth = await soap("AuthRequest", {
    _jsns: "urn:zimbraAccount",
    account: { by: "name", _content: email },
    password: { _content: "assext" },
  });
  const token = auth.AuthResponse.authToken[0]._content;
  const info = await soap("GetInfoRequest", { _jsns: "urn:zimbraAccount", sections: "attrs" }, token);
  return { email, token, id: info.GetInfoResponse.id };
}

function connect(user, timeoutMs) {
  const started = now();
  return new Promise((resolve) => {
    const ws = new WebSocket(`${CHATS}/events`, {
      protocols: ["1.6.2", "1.6.1", "1.6.0"],
      headers: { Cookie: `ZM_AUTH_TOKEN=${user.token}` },
    });
    const done = (ok) => {
      clearTimeout(timer);
      resolve({ ok, ms: now() - started, ws });
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    ws.onmessage = (m) => {
      if (JSON.parse(m.data).type === "WebsocketConnected") done(true);
    };
    ws.onerror = () => done(false);
  });
}

async function rest(user, method, path, body) {
  const started = now();
  try {
    const res = await fetch(`${CHATS}${path}`, {
      method,
      headers: { Cookie: `ZM_AUTH_TOKEN=${user.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    await res.text();
    return { ok: res.ok, ms: now() - started };
  } catch {
    return { ok: false, ms: now() - started };
  }
}

const pods = execFileSync("kubectl", [...kube, "get", "pods", "-l", "app=carbonio-ws-collaboration", "-o", "name"], {
  encoding: "utf8",
}).trim().split("\n");
const restarts = () =>
  pods.map((p) => {
    try {
      return Number(execFileSync("kubectl", [...kube, "get", p, "-o", "jsonpath={.status.containerStatuses[?(@.name==\"app\")].restartCount}"], { encoding: "utf8" }));
    } catch {
      return -1;
    }
  });

const users = [];
for (const email of ["user@carbonio.localhost", "admin@carbonio.localhost", "load1@carbonio.localhost", "load2@carbonio.localhost"])
  users.push(await login(email));
const [owner] = users;
const room = await (await fetch(`${CHATS}/rooms`, {
  method: "POST",
  headers: { Cookie: `ZM_AUTH_TOKEN=${owner.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: `wsc-stall-${Date.now()}`, description: "", type: "group", members: users.slice(1).map((u) => ({ userId: u.id, owner: false })) }),
})).json();

const restartsBefore = restarts();
const t0 = now();
const health = [];
const probes = [];
let polling = true;
const healthLoop = (async () => {
  while (polling) {
    const at = (now() - t0) / 1000;
    await Promise.all(
      pods.map(async (pod) => {
        const started = now();
        let ok = true;
        try {
          await run("kubectl", [...kube, "exec", pod, "-c", "app", "--", "/busybox/wget", "-q", "-T", "3", "-O-", "http://127.78.0.4:10000/health/live"], { timeout: 8000 });
        } catch {
          ok = false;
        }
        health.push({ at, pod, ok, ms: now() - started });
      }),
    );
    await sleep(1000);
  }
})();
const restLoop = (async () => {
  let i = 0;
  while (polling) {
    const at = (now() - t0) / 1000;
    const [get, put] = await Promise.all([
      rest(owner, "GET", "/rooms"),
      rest(owner, "PUT", `/rooms/${room.id}`, { name: `stall-${i++}` }),
    ]);
    probes.push({ at, get, put });
    await sleep(1000);
  }
})();

await sleep(5000);
brokerSignal("STOP");
paused = true;
const stalledAt = (now() - t0) / 1000;
const storm = await Promise.all(Array.from({ length: SESSIONS }, (_, i) => connect(users[i % users.length], (STALL_S - 2) * 1000)));
const remaining = STALL_S * 1000 - (now() - t0 - stalledAt * 1000);
if (remaining > 0) await sleep(remaining);
resume();
const resumedAt = (now() - t0) / 1000;

let reconnectedAfter = null;
while ((now() - t0) / 1000 < resumedAt + RECOVER_S) {
  const attempt = await connect(owner, 5000);
  attempt.ws.close();
  if (attempt.ok) {
    reconnectedAfter = (now() - t0) / 1000 - resumedAt;
    break;
  }
  await sleep(1000);
}
await sleep(Math.max(0, (resumedAt + 15 - (now() - t0) / 1000) * 1000));
polling = false;
await Promise.all([healthLoop, restLoop]);
storm.forEach((s) => s.ws.close());

const during = (at) => at >= stalledAt && at < resumedAt;
const after = (at) => at >= resumedAt;
const share = (rows, pick) => (rows.length ? +(rows.filter(pick).length / rows.length).toFixed(2) : null);
const firstHealthyAfter = () => {
  const failing = health.filter((h) => after(h.at) && !h.ok).map((h) => h.at);
  return failing.length ? +(Math.max(...failing) - resumedAt + 1).toFixed(1) : 0;
};
const result = {
  label: args.label ?? "",
  sessions: SESSIONS,
  stallSeconds: STALL_S,
  wsConnectedDuringStall: storm.filter((s) => s.ok).length,
  wsConnectP99Ms: Math.round(storm.map((s) => s.ms).sort((a, b) => a - b)[Math.floor(SESSIONS * 0.99)] ?? 0),
  healthOkBefore: share(health.filter((h) => h.at < stalledAt), (h) => h.ok),
  healthOkDuring: share(health.filter((h) => during(h.at)), (h) => h.ok),
  healthOkAfter: share(health.filter((h) => after(h.at)), (h) => h.ok),
  healthFailingForAfterResumeS: firstHealthyAfter(),
  restGetOkDuring: share(probes.filter((p) => during(p.at)), (p) => p.get.ok),
  restPutOkDuring: share(probes.filter((p) => during(p.at)), (p) => p.put.ok),
  restGetOkAfter: share(probes.filter((p) => after(p.at)), (p) => p.get.ok),
  newSessionConnectsAfterResumeS: reconnectedAfter === null ? null : +reconnectedAfter.toFixed(1),
  podRestarts: restarts().reduce((sum, r, i) => sum + Math.max(0, r - restartsBefore[i]), 0),
  timeline: { health, probes: probes.map((p) => ({ at: p.at, get: p.get.ok, getMs: Math.round(p.get.ms), put: p.put.ok, putMs: Math.round(p.put.ms) })), stalledAt, resumedAt },
};
const { timeline, ...summary } = result;
console.log(JSON.stringify(summary));
if (args.out) appendFileSync(args.out, `${JSON.stringify(result)}\n`);
await rest(owner, "DELETE", `/rooms/${room.id}`);
process.exit(0);
