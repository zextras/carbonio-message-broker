// SPDX-FileCopyrightText: 2026 Zextras <https://www.zextras.com>
//
// SPDX-License-Identifier: AGPL-3.0-only

package load;

import com.rabbitmq.client.AMQP.BasicProperties;
import com.rabbitmq.client.BuiltinExchangeType;
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import com.rabbitmq.client.Delivery;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Replays the AMQP calls WSC makes to deliver room and meeting events, for several WSC instances
 * ("pods") against one broker, and reports throughput, latency, loss and broker footprint.
 */
public final class WscEventsLoad {

  static final String EXCHANGE = "wsc.events";
  static final String LEGACY_ROUTING_KEY = "user-events";
  static final int LEGACY_POOL_SIZE = 10;

  enum Mode {
    LEGACY,
    INSTANCE,
    BATCH,
    INTEREST
  }

  record Config(
      Mode mode,
      int pods,
      int users,
      int sessionsPerUser,
      int members,
      int callers,
      List<Integer> steps,
      String kind,
      int storm,
      int maxPending,
      int maxLength,
      int idleSeconds,
      int offerMillis,
      String label) {

    static Config parse(String[] args) {
      Map<String, String> a = new HashMap<>();
      for (int i = 0; i + 1 < args.length; i += 2) a.put(args[i].replaceFirst("^--", ""), args[i + 1]);
      return new Config(
          Mode.valueOf(a.getOrDefault("mode", "instance").toUpperCase()),
          Integer.parseInt(a.getOrDefault("pods", "2")),
          Integer.parseInt(a.getOrDefault("users", "100")),
          Integer.parseInt(a.getOrDefault("sessions", "2")),
          Integer.parseInt(a.getOrDefault("members", "10")),
          Integer.parseInt(a.getOrDefault("callers", "16")),
          Arrays.stream(a.getOrDefault("events", "10,100,1000,10000,100000").split(","))
              .map(Integer::parseInt)
              .toList(),
          a.getOrDefault("kind", "room"),
          Integer.parseInt(a.getOrDefault("storm", "0")),
          Integer.parseInt(a.getOrDefault("max-pending", "10000")),
          Integer.parseInt(a.getOrDefault("max-length", "10000")),
          Integer.parseInt(a.getOrDefault("idle-seconds", "15")),
          Integer.parseInt(a.getOrDefault("offer-ms", "0")),
          a.getOrDefault("label", ""));
    }
  }

  static final class Session {
    final String id = UUID.randomUUID().toString();
    final String user;
    final int pod;
    private BitSet seen = new BitSet();

    Session(String user, int pod) {
      this.user = user;
      this.pod = pod;
    }

    synchronized boolean firstTime(int event) {
      if (seen.get(event)) return false;
      seen.set(event);
      return true;
    }

    synchronized void reset() {
      seen = new BitSet();
    }
  }

  static final class Recorder {
    final LongAdder unique = new LongAdder();
    final LongAdder duplicates = new LongAdder();
    final LongAdder podMessages = new LongAdder();
    final LongAdder published = new LongAdder();
    final LongAdder publishFailures = new LongAdder();
    final long[] latencies = new long[4_000_000];
    final AtomicInteger samples = new AtomicInteger();

    void deliver(Session session, Map<String, Object> headers) {
      int event = ((Number) headers.get("e")).intValue();
      long sent = ((Number) headers.get("t")).longValue();
      if (session.firstTime(event)) unique.increment();
      else duplicates.increment();
      int i = samples.getAndIncrement();
      if (i < latencies.length) latencies[i] = System.nanoTime() - sent;
    }

    void reset() {
      unique.reset();
      duplicates.reset();
      podMessages.reset();
      published.reset();
      publishFailures.reset();
      samples.set(0);
    }

    long[] percentilesMicros() {
      int n = Math.min(samples.get(), latencies.length);
      if (n == 0) return new long[] {0, 0, 0, 0};
      long[] copy = Arrays.copyOf(latencies, n);
      Arrays.sort(copy);
      return new long[] {
        copy[n / 2] / 1000,
        copy[(int) (n * 0.95)] / 1000,
        copy[Math.min(n - 1, (int) (n * 0.99))] / 1000,
        copy[n - 1] / 1000
      };
    }
  }

  static final Recorder RECORDER = new Recorder();

  interface Pod {
    void open(Session session) throws IOException;

    void close(Session session);

    void publish(int event, long sentNanos, List<String> users, byte[] body) throws IOException;

    default long dropped() {
      return 0;
    }

    default void awaitIdle() throws Exception {}

    void shutdown();
  }

  static BasicProperties properties(int event, long sentNanos, String users) {
    Map<String, Object> headers = new HashMap<>();
    headers.put("e", event);
    headers.put("t", sentNanos);
    if (users != null) headers.put("u", users);
    return new BasicProperties.Builder().headers(headers).build();
  }

  /** WSC 1.15.3: one exchange per user, one queue and one channel per WebSocket session. */
  static final class LegacyPod implements Pod {
    private final List<Connection> pool = new ArrayList<>();
    private final AtomicInteger next = new AtomicInteger();
    private final Connection publisherConnection;
    private final Channel publisher;
    private final Map<String, Channel> channels = new ConcurrentHashMap<>();
    private final Map<String, String> tags = new ConcurrentHashMap<>();

    LegacyPod(ConnectionFactory factory, int index) throws Exception {
      for (int i = 0; i < LEGACY_POOL_SIZE; i++)
        pool.add(factory.newConnection("load-legacy-" + index + "-pool-" + i));
      publisherConnection = factory.newConnection("load-legacy-" + index + "-publisher");
      publisher = publisherConnection.createChannel();
    }

    @Override
    public void open(Session session) throws IOException {
      Channel channel =
          pool.get((next.getAndIncrement() & Integer.MAX_VALUE) % pool.size()).createChannel();
      channel.exchangeDeclare(session.user, BuiltinExchangeType.DIRECT, false, false, null);
      channel.queueDeclare(session.id, false, false, true, null);
      channel.queueBind(session.id, session.user, LEGACY_ROUTING_KEY);
      String tag =
          channel.basicConsume(
              session.id,
              true,
              (consumerTag, delivery) ->
                  RECORDER.deliver(session, delivery.getProperties().getHeaders()),
              consumerTag -> {});
      channels.put(session.id, channel);
      tags.put(session.id, tag);
    }

    @Override
    public void close(Session session) {
      Channel channel = channels.remove(session.id);
      if (channel == null) return;
      quietly(() -> channel.basicCancel(tags.remove(session.id)));
      quietly(() -> channel.queueUnbind(session.id, session.user, LEGACY_ROUTING_KEY));
      quietly(() -> channel.queueDeleteNoWait(session.id, false, false));
      quietly(channel::close);
    }

    @Override
    public void publish(int event, long sentNanos, List<String> users, byte[] body)
        throws IOException {
      BasicProperties properties = properties(event, sentNanos, null);
      for (String user : users) {
        publisher.exchangeDeclare(user, BuiltinExchangeType.DIRECT, false, false, null);
        publisher.basicPublish(user, LEGACY_ROUTING_KEY, properties, body);
        RECORDER.published.increment();
      }
    }

    @Override
    public void shutdown() {
      pool.forEach(c -> quietly(c::close));
      quietly(publisherConnection::close);
    }
  }

  /**
   * One queue per pod on the {@code wsc.events} topic exchange.
   *
   * <ul>
   *   <li>INSTANCE: the CO-4512 branch, one message per target user, queue bound to {@code #}.
   *   <li>BATCH: one message per event, target users in a header, queue bound to {@code #}.
   *   <li>INTEREST: one message per target user, queue bound to the users with a local session.
   * </ul>
   */
  static final class InstancePod implements Pod {
    private final Mode mode;
    private final Connection consumerConnection;
    private final Connection publisherConnection;
    private final Channel consumer;
    private final Channel publisher;
    private final String queue;
    private final Map<String, Set<Session>> local = new ConcurrentHashMap<>();
    private final ArrayBlockingQueue<Runnable> pending;
    private final int offerMillis;
    private volatile boolean running = true;
    private final ExecutorService topology = Executors.newSingleThreadExecutor();
    private final LongAdder dropped = new LongAdder();

    InstancePod(ConnectionFactory factory, int index, Config config) throws Exception {
      mode = config.mode();
      consumerConnection = factory.newConnection("load-" + mode + "-" + index + "-consumer");
      consumer = consumerConnection.createChannel();
      consumer.exchangeDeclare(EXCHANGE, BuiltinExchangeType.TOPIC, true);
      queue =
          consumer
              .queueDeclare("", false, true, true, Map.of("x-max-length", config.maxLength()))
              .getQueue();
      if (mode != Mode.INTEREST) consumer.queueBind(queue, EXCHANGE, "#");
      consumer.basicConsume(queue, true, (tag, delivery) -> onDelivery(delivery), tag -> {});

      publisherConnection = factory.newConnection("load-" + mode + "-" + index + "-publisher");
      publisher = publisherConnection.createChannel();
      publisher.exchangeDeclare(EXCHANGE, BuiltinExchangeType.TOPIC, true);
      pending = new ArrayBlockingQueue<>(config.maxPending());
      offerMillis = config.offerMillis();
      Thread.ofPlatform()
          .name("publisher-" + index)
          .daemon()
          .start(
              () -> {
                while (running) {
                  try {
                    Runnable task = pending.poll(100, TimeUnit.MILLISECONDS);
                    if (task != null) task.run();
                  } catch (InterruptedException e) {
                    return;
                  }
                }
              });
    }

    private void onDelivery(Delivery delivery) {
      RECORDER.podMessages.increment();
      Map<String, Object> headers = delivery.getProperties().getHeaders();
      Object users = headers.get("u");
      if (users == null) deliverLocally(delivery.getEnvelope().getRoutingKey(), headers);
      else for (String user : users.toString().split(",")) deliverLocally(user, headers);
    }

    private void deliverLocally(String user, Map<String, Object> headers) {
      Set<Session> sessions = local.get(user);
      if (sessions == null) return;
      for (Session session : sessions) RECORDER.deliver(session, headers);
    }

    @Override
    public void open(Session session) {
      local.compute(
          session.user,
          (user, sessions) -> {
            Set<Session> result = sessions != null ? sessions : ConcurrentHashMap.newKeySet();
            if (result.isEmpty() && mode == Mode.INTEREST)
              topology.execute(() -> quietly(() -> consumer.queueBind(queue, EXCHANGE, user)));
            result.add(session);
            return result;
          });
    }

    @Override
    public void close(Session session) {
      local.computeIfPresent(
          session.user,
          (user, sessions) -> {
            sessions.remove(session);
            if (!sessions.isEmpty()) return sessions;
            if (mode == Mode.INTEREST)
              topology.execute(() -> quietly(() -> consumer.queueUnbind(queue, EXCHANGE, user)));
            return null;
          });
    }

    @Override
    public void publish(int event, long sentNanos, List<String> users, byte[] body) {
      if (mode == Mode.BATCH) {
        BasicProperties properties = properties(event, sentNanos, String.join(",", users));
        enqueue(() -> send("users", properties, body));
        return;
      }
      BasicProperties properties = properties(event, sentNanos, null);
      for (String user : users) enqueue(() -> send(user, properties, body));
    }

    private void enqueue(Runnable task) {
      try {
        if (!pending.offer(task, offerMillis, TimeUnit.MILLISECONDS)) dropped.increment();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }

    private void send(String routingKey, BasicProperties properties, byte[] body) {
      try {
        publisher.basicPublish(EXCHANGE, routingKey, properties, body);
        RECORDER.published.increment();
      } catch (IOException e) {
        RECORDER.publishFailures.increment();
      }
    }

    @Override
    public long dropped() {
      return dropped.sum();
    }

    @Override
    public void awaitIdle() throws Exception {
      topology.submit(() -> {}).get();
    }

    @Override
    public void shutdown() {
      running = false;
      topology.shutdown();
      quietly(consumerConnection::close);
      quietly(publisherConnection::close);
    }
  }

  /** Optional broker footprint, read from the management API (MGMT_URI=http://user:pass@host:port). */
  static final class Broker {
    private final HttpClient http = HttpClient.newHttpClient();
    private final URI base;
    private final String authorization;
    private final AtomicLong peakQueued = new AtomicLong();
    private final AtomicLong peakMemory = new AtomicLong();
    private volatile boolean sampling;
    private Map<String, Long> baseline = Map.of();

    Broker(String uri) {
      URI parsed = URI.create(uri);
      base = URI.create(parsed.getScheme() + "://" + parsed.getHost() + ":" + parsed.getPort());
      authorization =
          "Basic "
              + Base64.getEncoder()
                  .encodeToString(
                      java.net.URLDecoder.decode(parsed.getRawUserInfo(), StandardCharsets.UTF_8)
                          .getBytes(StandardCharsets.UTF_8));
    }

    String get(String path) {
      try {
        HttpRequest request =
            HttpRequest.newBuilder(base.resolve(path)).header("Authorization", authorization).build();
        return http.send(request, HttpResponse.BodyHandlers.ofString()).body();
      } catch (Exception e) {
        return "";
      }
    }

    static long sum(String json, String field) {
      Matcher m = Pattern.compile("\"" + field + "\":(\\d+)").matcher(json);
      long total = 0;
      while (m.find()) total += Long.parseLong(m.group(1));
      return total;
    }

    Map<String, Long> raw() {
      String overview = get("/api/overview?columns=object_totals");
      Map<String, Long> result = new LinkedHashMap<>();
      for (String key : List.of("connections", "channels", "exchanges", "queues", "consumers"))
        result.put(key, sum(overview, key));
      result.put("memoryMB", sum(get("/api/nodes?columns=mem_used"), "mem_used") / 1_048_576);
      return result;
    }

    void markBaseline() {
      baseline = raw();
    }

    Map<String, Object> totals() {
      Map<String, Object> result = new LinkedHashMap<>();
      raw().forEach((key, value) -> result.put(key, value - baseline.getOrDefault(key, 0L)));
      return result;
    }

    void startSampling() {
      peakQueued.set(0);
      peakMemory.set(0);
      sampling = true;
      Thread.ofPlatform()
          .daemon()
          .start(
              () -> {
                while (sampling) {
                  peakQueued.accumulateAndGet(sum(get("/api/queues?columns=messages"), "messages"), Math::max);
                  peakMemory.accumulateAndGet(
                      sum(get("/api/nodes?columns=mem_used"), "mem_used") / 1_048_576, Math::max);
                  sleep(500);
                }
              });
    }

    Map<String, Object> stopSampling() {
      sampling = false;
      return Map.of("peakQueued", peakQueued.get(), "peakMemoryMB", peakMemory.get());
    }
  }

  public static void main(String[] args) throws Exception {
    Config config = Config.parse(args);
    ConnectionFactory factory = new ConnectionFactory();
    factory.setUri(System.getenv("AMQP_URI"));
    String mgmt = System.getenv("MGMT_URI");
    Broker broker = mgmt == null || mgmt.isBlank() ? null : new Broker(mgmt);
    if (broker != null) broker.markBaseline();

    List<Pod> pods = new ArrayList<>();
    for (int i = 0; i < config.pods(); i++)
      pods.add(
          config.mode() == Mode.LEGACY
              ? new LegacyPod(factory, i)
              : new InstancePod(factory, i, config));

    List<String> users = new ArrayList<>();
    for (int i = 0; i < config.users(); i++) users.add(UUID.randomUUID().toString());
    List<Session> sessions = sessionsOf(users, config.sessionsPerUser(), config.pods());
    Map<String, Integer> sessionsPerUser = new HashMap<>();
    sessions.forEach(s -> sessionsPerUser.merge(s.user, 1, Integer::sum));

    Map<String, Object> setup = base(config, "setup");
    long started = System.nanoTime();
    long[] openMicros = forAll(sessions, 64, s -> pods.get(s.pod).open(s));
    for (Pod pod : pods) pod.awaitIdle();
    setup.put("sessions", sessions.size());
    setup.put("ms", millisSince(started));
    setup.put("openP99Micros", openMicros[2]);
    if (broker != null) {
      sleep(6000);
      setup.put("broker", broker.totals());
    }
    emit(setup);

    List<List<String>> rooms = new ArrayList<>();
    for (int r = 0; r + config.members() <= users.size(); r += config.members())
      rooms.add(users.subList(r, r + config.members()));
    for (int events : config.steps())
      emit(runStep(config, events, pods, rooms, sessions, sessionsPerUser, broker));

    if (config.storm() > 0) emit(runStorm(config, pods, broker));

    forAll(sessions, 64, s -> pods.get(s.pod).close(s));
    pods.forEach(Pod::shutdown);
    if (config.mode() == Mode.LEGACY) deleteExchanges(factory, users);
  }

  static List<Session> sessionsOf(List<String> users, int perUser, int pods) {
    List<Session> sessions = new ArrayList<>();
    for (int u = 0; u < users.size(); u++)
      for (int j = 0; j < perUser; j++)
        sessions.add(new Session(users.get(u), (u * perUser + j) % pods));
    return sessions;
  }

  static Map<String, Object> runStep(
      Config config,
      int events,
      List<Pod> pods,
      List<List<String>> rooms,
      List<Session> sessions,
      Map<String, Integer> sessionsPerUser,
      Broker broker)
      throws Exception {
    RECORDER.reset();
    sessions.forEach(Session::reset);
    long droppedBefore = pods.stream().mapToLong(Pod::dropped).sum();
    long expected = 0;
    for (int i = 0; i < events; i++)
      for (String user : rooms.get(i % rooms.size()))
        expected += sessionsPerUser.getOrDefault(user, 0);
    if (broker != null) broker.startSampling();

    AtomicInteger next = new AtomicInteger();
    LongAdder callerFailures = new LongAdder();
    long[] callMicros = new long[events];
    int threads = config.callers() * config.pods();
    CountDownLatch done = new CountDownLatch(threads);
    long started = System.nanoTime();
    for (int t = 0; t < threads; t++)
      Thread.ofPlatform()
          .start(
              () -> {
                int i;
                while ((i = next.getAndIncrement()) < events) {
                  List<String> members = rooms.get(i % rooms.size());
                  byte[] body = body(config.kind(), i, members);
                  long called = System.nanoTime();
                  try {
                    pods.get(i % pods.size()).publish(i, called, members, body);
                  } catch (Exception e) {
                    callerFailures.increment();
                  }
                  callMicros[i] = (System.nanoTime() - called) / 1000;
                }
                done.countDown();
              });
    done.await();
    long publishMs = millisSince(started);

    long last = -1;
    long lastProgress = System.nanoTime();
    while (RECORDER.unique.sum() < expected
        && System.nanoTime() - lastProgress < TimeUnit.SECONDS.toNanos(config.idleSeconds())) {
      long now = RECORDER.unique.sum() + RECORDER.podMessages.sum();
      if (now != last) {
        last = now;
        lastProgress = System.nanoTime();
      }
      sleep(20);
    }
    long totalMs =
        RECORDER.unique.sum() == expected
            ? millisSince(started)
            : millisSince(started) - TimeUnit.SECONDS.toMillis(config.idleSeconds());

    Map<String, Object> result = base(config, "events");
    long delivered = RECORDER.unique.sum();
    long[] p = RECORDER.percentilesMicros();
    result.put("events", events);
    result.put("expectedDeliveries", expected);
    result.put("delivered", delivered);
    result.put("lost", expected - delivered);
    result.put("duplicates", RECORDER.duplicates.sum());
    result.put("published", RECORDER.published.sum());
    result.put("podMessages", RECORDER.podMessages.sum());
    result.put("publisherDropped", pods.stream().mapToLong(Pod::dropped).sum() - droppedBefore);
    result.put("failures", callerFailures.sum() + RECORDER.publishFailures.sum());
    result.put("publishMs", publishMs);
    result.put("totalMs", Math.max(totalMs, publishMs));
    result.put("eventsPerSec", events * 1000L / Math.max(1, Math.max(totalMs, publishMs)));
    result.put("deliveriesPerSec", delivered * 1000L / Math.max(1, Math.max(totalMs, publishMs)));
    result.put("p50Micros", p[0]);
    result.put("p95Micros", p[1]);
    result.put("p99Micros", p[2]);
    result.put("maxMicros", p[3]);
    Arrays.sort(callMicros);
    result.put("callP50Micros", callMicros[events / 2]);
    result.put("callP99Micros", callMicros[Math.min(events - 1, (int) (events * 0.99))]);
    result.put("callMaxMicros", callMicros[events - 1]);
    if (broker != null) {
      result.putAll(broker.stopSampling());
      result.put("broker", broker.totals());
    }
    return result;
  }

  /** Many sessions connect, then disconnect, at once: what Jetty threads wait for. */
  static Map<String, Object> runStorm(Config config, List<Pod> pods, Broker broker)
      throws Exception {
    List<String> users = new ArrayList<>();
    for (int i = 0; i < Math.max(1, config.storm() / 2); i++) users.add(UUID.randomUUID().toString());
    List<Session> sessions = sessionsOf(users, 2, pods.size());
    Map<String, Object> result = base(config, "storm");
    long started = System.nanoTime();
    long[] open = forAll(sessions, 200, s -> pods.get(s.pod).open(s));
    for (Pod pod : pods) pod.awaitIdle();
    result.put("sessions", sessions.size());
    result.put("openMs", millisSince(started));
    result.put("openP50Micros", open[0]);
    result.put("openP99Micros", open[2]);
    if (broker != null) {
      sleep(6000);
      result.put("brokerOpen", broker.totals());
    }
    started = System.nanoTime();
    long[] close = forAll(sessions, 200, s -> pods.get(s.pod).close(s));
    for (Pod pod : pods) pod.awaitIdle();
    result.put("closeMs", millisSince(started));
    result.put("closeP99Micros", close[2]);
    if (pods.getFirst() instanceof LegacyPod legacy) deleteExchanges(legacy.publisher, users);
    return result;
  }

  interface SessionAction {
    void run(Session session) throws Exception;
  }

  static long[] forAll(List<Session> sessions, int threads, SessionAction action)
      throws InterruptedException {
    long[] micros = new long[sessions.size()];
    AtomicInteger next = new AtomicInteger();
    CountDownLatch done = new CountDownLatch(threads);
    for (int t = 0; t < threads; t++)
      Thread.ofPlatform()
          .start(
              () -> {
                int i;
                while ((i = next.getAndIncrement()) < sessions.size()) {
                  long started = System.nanoTime();
                  try {
                    action.run(sessions.get(i));
                  } catch (Exception e) {
                    System.err.println("session action failed: " + e);
                  }
                  micros[i] = (System.nanoTime() - started) / 1000;
                }
                done.countDown();
              });
    done.await();
    long[] sorted = micros.clone();
    Arrays.sort(sorted);
    int n = sorted.length;
    return n == 0
        ? new long[] {0, 0, 0}
        : new long[] {sorted[n / 2], sorted[(int) (n * 0.95)], sorted[Math.min(n - 1, (int) (n * 0.99))]};
  }

  static byte[] body(String kind, int event, List<String> members) {
    String json =
        kind.equals("meeting")
            ? String.format(
                "{\"type\":\"MEETING_PARTICIPANT_JOINED\",\"sentDate\":\"%s\",\"meetingId\":\"%s\","
                    + "\"roomId\":\"%s\",\"userId\":\"%s\",\"queueId\":\"%s\"}",
                Instant.now(), UUID.randomUUID(), UUID.randomUUID(), members.getFirst(), UUID.randomUUID())
            : String.format(
                "{\"type\":\"ROOM_UPDATED\",\"sentDate\":\"%s\",\"roomId\":\"%s\","
                    + "\"name\":\"Load test room %d\",\"description\":\"Updated by the load test\"}",
                Instant.now(), UUID.randomUUID(), event);
    return json.getBytes(StandardCharsets.UTF_8);
  }

  static void deleteExchanges(ConnectionFactory factory, List<String> users) throws Exception {
    try (Connection connection = factory.newConnection("load-cleanup")) {
      deleteExchanges(connection.createChannel(), users);
    }
  }

  static void deleteExchanges(Channel channel, List<String> users) {
    for (String user : users) quietly(() -> channel.exchangeDelete(user));
  }

  static Map<String, Object> base(Config config, String scenario) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("label", config.label());
    result.put("scenario", scenario);
    result.put("mode", config.mode().name().toLowerCase());
    result.put("kind", config.kind());
    result.put("pods", config.pods());
    result.put("users", config.users());
    result.put("sessionsPerUser", config.sessionsPerUser());
    result.put("members", config.members());
    result.put("maxPending", config.maxPending());
    result.put("maxLength", config.maxLength());
    result.put("offerMs", config.offerMillis());
    return result;
  }

  static void emit(Map<String, Object> result) {
    System.out.println("RESULT " + json(result));
    System.out.flush();
  }

  static String json(Object value) {
    if (value instanceof Map<?, ?> map) {
      List<String> fields = new ArrayList<>();
      map.forEach((k, v) -> fields.add("\"" + k + "\":" + json(v)));
      return "{" + String.join(",", fields) + "}";
    }
    if (value instanceof Number || value instanceof Boolean) return value.toString();
    return "\"" + String.valueOf(value).replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  static long millisSince(long startedNanos) {
    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
  }

  static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  interface Action {
    void run() throws Exception;
  }

  static void quietly(Action action) {
    try {
      action.run();
    } catch (Exception ignored) {
    }
  }
}
