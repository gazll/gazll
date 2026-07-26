# Microservices at Scale — Technical Mastery Track

Mười nhóm vấn đề hay "cắn" nhất khi hệ thống lên hàng triệu request, tailored cho fintech / airline booking. Mỗi câu có phần trả lời chính và khối **Đào sâu senior**.

---

## 01 · Cascading Failure & Retry Storm

### Vì sao một service downstream chậm làm sập cả upstream dù CPU chưa cao?

Gốc rễ là **thread/connection bị giam trong lúc chờ downstream**. Service A có Tomcat pool 200 thread, mỗi request gọi B. B bình thường 20ms → thread giải phóng nhanh, phục vụ hàng nghìn req/s. Khi B chậm lên 5s, mỗi thread bị giam 5s → throughput A sụp từ ~10.000 xuống ~40 req/s. A không chết vì CPU mà vì **thread starvation** — hết đơn vị xử lý đồng thời.

Retry storm chồng lên: A timeout với B rồi retry; B đang lag chứ chưa chết → retry làm B nhận gấp đôi tải → B chết hẳn → A retry điên cuồng → B không phục hồi được dù restart, vì vừa lên là bị đập chết.

> **Đào sâu senior.** Trạng thái này gọi là **metastable failure**: hệ kẹt ở trạng thái xấu và không tự thoát *dù nguyên nhân ban đầu đã hết*. Hai loop khuếch đại: (1) *retry amplification* — mỗi tầng retry nhân tải, chồng 3 tầng là x8; (2) *load-induced slowdown* — càng tải cao càng chậm (GC, lock, context switch) → nhiều timeout hơn → retry nhiều hơn. Muốn thoát phải **chủ động shed tải**, không chỉ đợi tự khôi phục.

### Timeout đặt thế nào cho đúng?

Đặt ở **nhiều tầng**, nhất quán theo budget: timeout tầng ngoài phải **lớn hơn tổng** timeout tầng trong (gộp cả retry + fallback), nếu không tầng ngoài cắt trước khi tầng trong kịp xử lý.

```
Client → Gateway (3s) → Service A (2s) → Service B (1s) → DB (800ms)
# Ngược lại nếu DB timeout > service timeout:
#   service đã bỏ cuộc nhưng query vẫn chạy trên DB, giữ connection vô ích
```

Lỗi kinh điển: đặt **connection timeout** mà quên **socket/read timeout** → B treo giữa chừng không trả byte → read timeout vô hạn → thread treo mãi. Với `RestTemplate`/`WebClient` phải set **cả hai**.

> **Đào sâu senior.** Cao hơn là **deadline propagation**: edge sinh một deadline tuyệt đối (now+3s), truyền qua header xuống mọi tầng; mỗi tầng tự tính "còn bao nhiêu thời gian" và truyền tiếp. Nếu 2s đầu đã tiêu hết, tầng dưới biết chỉ còn 1s và không lãng phí gọi downstream chắc chắn quá hạn (gRPC làm sẵn). Chọn giá trị timeout theo **p99.9 thực đo** cộng biên, không đoán.

### Circuit breaker: 3 state và tham số Resilience4j

CLOSED (cho qua) → OPEN (cắt ngay, trả fallback) → HALF_OPEN (thả vài request thăm dò) → CLOSED nếu probe OK.

```java
CircuitBreakerConfig.custom()
    .slidingWindowSize(100)
    .failureRateThreshold(50)            // >50% fail → OPEN
    .slowCallRateThreshold(80)           // >80% call chậm cũng coi là fail
    .slowCallDurationThreshold(Duration.ofMillis(800))
    .waitDurationInOpenState(Duration.ofSeconds(5))
    .permittedNumberOfCallsInHalfOpenState(10)
    .minimumNumberOfCalls(20)            // chưa đủ 20 call thì chưa tính tỉ lệ
    .build();
```

Điểm dễ bỏ sót: **`slowCallRateThreshold`** — service "chậm nhưng chưa fail" còn nguy hiểm hơn service chết hẳn vì vẫn ăn thread. **`minimumNumberOfCalls`** tránh mở breaker oan ở service traffic thấp (2/3 fail = 66%).

> **Đào sâu senior.** Breaker đặt **per-instance** — mỗi pod tự có state riêng; muốn chung cluster phải shared state (Redis), hiếm khi đáng. Cái bẫy hồi phục: khi HALF_OPEN → CLOSED, cả cluster có thể *đồng loạt* thả tải lại → giết downstream vừa sống (thundering herd sau recovery). Giảm bằng `permittedNumberOfCallsInHalfOpenState` nhỏ + ramp-up.

### Bulkhead: semaphore vs thread-pool, với virtual thread?

Tách tài nguyên theo từng downstream để một service hỏng không nuốt hết tài nguyên chung — như vách ngăn khoang tàu. Resilience4j có **semaphore bulkhead** (giới hạn concurrent call, chạy trên thread gọi) và **thread-pool bulkhead** (pool riêng, timeout cứng). Blocking I/O cũ → thread-pool tiện; **virtual thread → semaphore hợp lý hơn** (VT rẻ, không cần pool tách, chỉ cần giới hạn concurrency).

> **Đào sâu senior.** Breaker chỉ mở *sau khi* tích đủ fail; trong cửa sổ trước đó bulkhead cách ly *ngay lập tức* → hai lớp bổ trợ. Sizing theo **định lý Little**: concurrency = arrival_rate × latency (downstream 50ms, chấp nhận 400 req/s → concurrency ~20).

### Retry an toàn: jitter, retry budget

```java
IntervalFunction.ofExponentialRandomBackoff(
    Duration.ofMillis(100), 2.0, 0.5)   // jitter factor 0.5 — CỰC quan trọng
```

- **Jitter bắt buộc** — không có thì client retry đồng pha, tạo sóng tải đập vào downstream.
- Chỉ retry **lỗi tạm thời + idempotent**. Retry POST tạo giao dịch không có idempotency key = double-charge. 4xx (trừ 429) đừng retry.
- **Retry budget**: giới hạn tổng tỉ lệ retry (vd ≤10% tổng request) → downstream sập thì budget cạn, retry tự tắt.

> **Đào sâu senior.** Budget (toàn cục) hơn hẳn giới hạn per-request: maxAttempts=3 vẫn cho *toàn bộ* traffic retry x3 đúng lúc downstream yếu nhất. Kết hợp đúng thứ tự: breaker bọc **ngoài** retry — `CircuitBreaker(Retry(call))`.

### Load shedding — tuyến phòng thủ cuối

Khi quá tải, **chủ động vứt bớt request** (503 ngay) thay vì nhận hết rồi chết tất cả. Shed theo queue depth, p99 đang tăng, hoặc **priority** (giữ thanh toán/checkout, vứt giỏ hàng/gợi ý).

> **Đào sâu senior.** Thông minh hơn: **adaptive concurrency limit** (Netflix / TCP Vegas) — tự đo latency và tự điều chỉnh số request đồng thời, không cần tune ngưỡng tay. Cảnh giác *retry của request bị shed*; shed phải kèm tín hiệu "đừng retry" (503 + Retry-After).

---

## 02 · Pool Exhaustion — Connection & Thread

### Sizing connection pool: vì sao pool to không phải lúc nào cũng tốt?

Pool quá to → DB context-switch nhiều, lock contention tăng, throughput có khi *giảm*. Công thức xuất phát: `connections = (core*2) + spindle`. Với SSD, pool 10–20 thường tốt hơn pool 100. Pool để **tái sử dụng connection**, không phải để chạy nhiều query song song hơn — song song thật bị giới hạn bởi số core DB.

> **Đào sâu senior.** Nghịch lý: giảm pool đôi khi *tăng* throughput (queueing theory — ít connection, mỗi query nhanh hơn). Ở fintech/RDS còn tính connection cost phía DB (mỗi Postgres connection là một process ~vài MB) → hàng nghìn connection ăn RAM của shared_buffers/work_mem.

### Tổng connection cross-instance vượt max_connections

**Bạn không kiểm soát tổng connection**: 50 instance × pool 20 = 1000 > `max_connections=500` → RDS từ chối, dù mỗi pod thấy pool mình "bình thường". Lời giải bắt buộc khi scale: **RDS Proxy / PgBouncer** ở giữa, multiplex hàng nghìn client xuống vài chục server connection (transaction pooling).

> **Đào sâu senior.** PgBouncer: *session* (ít multiplex), *transaction* (phổ biến nhất), *statement* (hiếm). Transaction pooling **phá vỡ** thứ bám session: server-side prepared statement, `SET` session, advisory lock, `LISTEN/NOTIFY`, temp table → lỗi "prepared statement does not exist" hay gặp. Phải tắt server-side prepared statement.

### HikariCP: tham số sống còn

```yaml
maximum-pool-size: 20
minimum-idle: 20            # giữ = max để tránh tạo connection lúc spike
connection-timeout: 3000    # chờ MƯỢN connection từ pool, KHÔNG phải connect DB
max-lifetime: 1740000       # 29 phút — PHẢI nhỏ hơn DB/LB idle timeout
leak-detection-threshold: 60000
```

- `connection-timeout` dài → request dồn ứ thành cascading. Nên ngắn để fail nhanh.
- `max-lifetime` phải nhỏ hơn idle timeout của RDS/LB, nếu không HikariCP đưa connection đã bị phía DB âm thầm đóng → "connection reset" ngẫu nhiên.
- `leak-detection-threshold` bắt code mượn connection quên trả — nguyên nhân số một làm pool cạn từ từ rồi sập sau vài giờ.

> **Đào sâu senior.** `minimum-idle = max` vì để min < max thì HikariCP đóng bớt idle lúc thấp tải rồi phải tạo lại lúc spike (round-trip TCP+TLS+auth 20–100ms) đúng lúc cần nhất. `max-lifetime` còn giúp connection dần trở về endpoint đúng sau RDS failover.

### Thread pool: gotcha queueCapacity

Thứ tự thực tế của `ThreadPoolExecutor`: **core → queue → max → reject** (không phải core → max → queue như trực giác).

```
running < core?        → tạo thread mới
else queue chưa đầy?   → BỎ VÀO QUEUE (không tạo thread!)
else thread < max?     → tạo thread mới
else                   → REJECT
```

Bẫy: `queueCapacity` lớn (mặc định `LinkedBlockingQueue` là `Integer.MAX_VALUE`) → queue không bao giờ đầy → pool **không bao giờ vượt corePoolSize** → `maxPoolSize` vô nghĩa. Dùng queue hữu hạn + `CallerRunsPolicy` (backpressure tự nhiên: task chạy trên thread gọi → tự giảm tốc nhận task).

> **Đào sâu senior.** Muốn "scale thread trước, queue sau" dùng `SynchronousQueue` hoặc custom queue override `offer()` (cách Tomcat làm với `TaskQueue`). CallerRunsPolicy trên web server có mặt trái: mượn request thread của Tomcat → giảm thread nhận request mới → backpressure lan ra client (cố ý, nhưng latency-critical path cân nhắc trả 503 nhanh).

### Virtual thread gỡ nút I/O-bound + cạm bẫy

Platform thread map 1:1 OS thread (~1MB stack) → vài nghìn là trần. VT gặp blocking I/O thì **unmount** khỏi carrier → vài chục nghìn VT trên vài chục carrier (~6x cho I/O-bound).

- **Pinning**: VT trong `synchronized` + blocking I/O → không unmount được. JDK 24+ gỡ phần lớn (còn JNI). Thay bằng `ReentrantLock`.
- **Mất giới hạn tự nhiên**: pool 200 thread từng vô tình giới hạn 200 query đồng thời; VT không giới hạn → có thể đập 50.000 query giết DB. VT *chuyển bottleneck từ thread sang connection pool/downstream*.
- **Không giúp gì** cho CPU-bound.

> **Đào sâu senior.** VT làm "thread-per-request" khả thi lại ở scale lớn → reactive/WebFlux bớt hấp dẫn cho I/O-bound. Nhưng phải *chủ động đặt lại* các giới hạn pool từng ngầm cung cấp: semaphore trước mỗi downstream, connection pool size hợp lý. Giám sát pinning bằng `-Djdk.tracePinnedThreads`.

---

## 03 · Distributed Data Consistency

### Dual-write problem — vì sao đoạn này sai tinh vi?

```java
@Transactional
public void placeOrder(Order order) {
    orderRepository.save(order);        // commit vào DB
    messageBroker.publish(orderEvent);  // publish ra broker
}
```

DB + broker **không cùng transaction**. `@Transactional` chỉ bao DB. Crash sau commit trước publish → event mất; publish xong rồi DB rollback → downstream xử lý order không tồn tại. Đừng giải bằng **2PC/XA** (chậm, fragile, blocking lock cross-system).

> **Đào sâu senior.** 2PC bị né vì prepare-phase giữ lock trên mọi participant tới commit; coordinator chết giữa chừng → participant kẹt "in-doubt", giữ lock vô thời hạn → giết throughput + SPOF. Đảo thứ tự (publish trước) vẫn sai: vấn đề *không phải thứ tự* mà *thiếu atomicity giữa hai medium*. Chỉ có cách đưa cả hai vào cùng medium giao dịch (DB) rồi relay ra — chính là Outbox.

### Transactional Outbox: polling vs CDC

Ghi event vào **cùng DB, cùng transaction** với business data, rồi relay riêng ra broker.

```java
@Transactional
void placeOrder(Order order) {
    orderRepository.save(order);
    outboxRepository.save(new OutboxEvent("OrderCreated", order.getId(), toJson(order), PENDING));
    // cùng commit / cùng rollback — atomic vì cùng DB
}
```

- **Polling**: `SELECT ... WHERE status='PENDING' FOR UPDATE SKIP LOCKED` — nhiều instance relay song song, không tranh nhau. Đơn giản, đủ tốt.
- **CDC**: Debezium đọc transaction log (binlog/WAL) đẩy vào Kafka — latency thấp, không thêm tải query, giữ được thứ tự. Đổi lại thêm hạ tầng vận hành.

> **Đào sâu senior.** `FOR UPDATE SKIP LOCKED` cho N relay quét cùng bảng mà bỏ qua row đang bị khóa → scale ngang không double-publish. Outbox **đảm bảo at-least-once, không exactly-once** (crash trước khi đánh dấu SENT → gửi lại) → consumer **bắt buộc idempotent** (ch.09).

### Saga: orchestration vs choreography + cạm bẫy compensation

Chuỗi local transaction, mỗi bước fail chạy **compensating transaction**. *Choreography* (event-driven): loose coupling nhưng dễ thành "pinball" khó debug — quá 4–5 bước nên chuyển *orchestration* (state machine: Temporal/Camunda).

Cạm bẫy compensation ở fintech:
- **Compensation ≠ rollback**: đã trừ tiền + gửi SMS thì không xóa được SMS → thiết kế semantic hoàn tiền (credit lại), không "un-debit".
- **Pivot transaction**: qua điểm pivot (đã giải ngân ra ngoài) thì không bù được → sau pivot chỉ retry-forward.
- **Compensation cũng fail** → phải retry + idempotent.

> **Đào sâu senior.** Semantic lock: giữa lúc bước đã chạy và compensation chưa xong, dùng **trạng thái trung gian** rõ (`PENDING_CONFIRM`) thay vì để balance thật sự đổi, chỉ chốt khi cả saga thành công → giảm cửa sổ không nhất quán mà user nhìn thấy.

### Eventual consistency đau ở đâu

Read-after-write không đảm bảo: user nạp tiền, refresh ngay, balance chưa update (replica/projection chưa kịp). Giảm bằng: **read-your-writes** (route read về primary N giây), **optimistic UI** (hiện "đang xử lý"), phân biệt dữ liệu **phải strong** (số dư, hạn mức) vs **chấp nhận eventual** (lịch sử, thống kê).

> **Đào sâu senior.** Consistency là một phổ: read-your-writes, **monotonic reads** (không thấy dữ liệu lùi về cũ), causal. Nhiều bug UX fintech là vi phạm monotonic reads (thấy balance mới rồi refresh thấy cũ do route sang replica khác). Fix bằng **version token**: sau ghi trả client một LSN/version; read sau gửi token, server route tới replica đã catch-up.

### "Exactly-once" là huyền thoại

Exactly-once *delivery* bất khả (two generals). Thực tế đạt được là **effectively-once = at-least-once + idempotent processing**. Kafka "EOS" chỉ trong phạm vi Kafka-to-Kafka; side-effect ra ngoài (gọi API, ghi DB khác) vẫn phải idempotent ở phía nhận.

> **Đào sâu senior.** Kafka EOS = idempotent producer (producer-id + sequence khử trùng lặp) + transactional writes (`isolation.level=read_committed`). Nhưng ngay khi consumer ghi Postgres/gọi REST, side-effect đó ngoài transaction Kafka → lặp khi retry. Đừng đuổi exactly-once — hỏi "xử lý hai lần mà kết quả không đổi thế nào".

---

## 04 · Messaging / Event-Driven at Scale

### Backpressure & queue buildup: RabbitMQ vs Kafka

Producer nhanh hơn consumer → queue phình → latency e2e tăng, RAM broker tăng.
- **RabbitMQ**: `prefetch` (QoS) — mặc định unlimited thì một consumer ôm hết, các consumer khác đói. Đặt 10–50 (task nhẹ) / 1 (task nặng). Lazy/quorum queue ghi đĩa chống OOM. Đo bằng **queue depth**.
- **Kafka**: là log, không OOM (message trên đĩa) nhưng **consumer lag** tăng = dữ liệu trễ.

> **Đào sâu senior.** Prefetch tối ưu ≈ throughput × round-trip (Little đảo): thấp quá thì chờ ack, cao quá thì mất cân bằng + nhiều unacked khi consumer chết. Kafka: alert trên *đạo hàm của lag* (đang tăng/giảm), không phải giá trị tuyệt đối. Số partition là **trần scale** consumer (không thể nhiều consumer active hơn partition/group).

### Message ordering khi scale ngang

Partition theo **key**: Kafka cùng `key` (accountId) → cùng partition → tuần tự *trong phạm vi key*. RabbitMQ: consistent hash exchange / single-active-consumer. Ordering ép giảm song song → key quá nóng thành bottleneck. Fintech nhiều khi **không cần total order**, chỉ cần order trong cùng account.

> **Đào sâu senior.** `max.in.flight.requests > 1` + retry có thể *đảo thứ tự* ngay trong một partition → bật idempotent producer hoặc in-flight=1. **Rebalance** gán lại partition → consumer mới có thể reprocess → lại cần idempotency. Thiết kế chịu reprocess/rebalance là mặc định, không phải edge case.

### Poison message & DLQ

Message lỗi bị retry vô hạn → block cả partition. Giới hạn redelivery → đẩy **DLQ** (phải có alerting + quy trình replay). Phân biệt lỗi tạm thời (retry) vs vĩnh viễn (validation → DLQ ngay).

> **Đào sâu senior.** **Tiered retry** (Uber): fail → `retry-5s` → `retry-30s` → `retry-5m` → DLQ, mỗi topic có consumer riêng với delay → không block main topic + có backoff thật. Cảnh giác "đầu độc theo lô": một poison trong batch làm cả batch retry → tách message lỗi khỏi batch.

### RabbitMQ Publisher Confirms: 3 mode + ConcurrentSkipListMap

Broker báo "đã nhận và chịu trách nhiệm" (`basic.ack`). Mode 1 đồng bộ từng message (an toàn nhất, chậm nhất); mode 2 batch (nack không biết cái nào → resend cả batch); mode 3 async (nhanh nhất):

```java
channel.confirmSelect();
ConcurrentNavigableMap<Long, Message> outstanding = new ConcurrentSkipListMap<>();
channel.addConfirmListener(
    (seqNo, multiple) -> { if (multiple) outstanding.headMap(seqNo, true).clear();
                           else outstanding.remove(seqNo); },      // ACK
    (seqNo, multiple) -> { /* NACK — resend hoặc log+alert */ });
long seq = channel.getNextPublishSeqNo();
outstanding.put(seq, message);
channel.basicPublish(...);
```

`ConcurrentSkipListMap` vì `multiple=true` là ack tích lũy (mọi seqNo ≤ giá trị) → `headMap(seqNo, true)` xóa toàn bộ tiền tố trong O(log n), concurrent-safe (listener chạy thread riêng).

> **Đào sâu senior.** Confirm **không thay Outbox**: bảo vệ chặng app→broker, nhưng crash *sau DB commit trước publish* thì confirm vô dụng (message chưa từng được gửi). Hai bẫy: confirm ≠ persistence (phải `deliveryMode=2` + queue durable); async confirm **không tự resend** — phải tự xử lý nack + message treo trong `outstanding` khi channel chết.

---

## 05 · Caching Pitfalls

### Cache stampede (thundering herd)

Hot key hết hạn → hàng nghìn request cùng miss → cùng lao xuống DB → spike chết.
- **Single-flight / mutex**: chỉ 1 request rebuild (`setnx` lock + TTL), còn lại chờ đọc lại.
- **XFetch (probabilistic early expiration)**: mỗi request có xác suất nhỏ tự rebuild *trước* hạn → không có khoảnh khắc tất cả cùng miss.
- **Logical expiration**: không để key hết hạn thật; quá hạn logic thì một request rebuild nền, các request khác nhận giá trị cũ → không ai chờ, đổi lại chấp nhận stale.

> **Đào sâu senior.** Logical expiration hợp dữ liệu chịu stale (tỷ giá hiển thị); single-flight hợp dữ liệu phải mới nhưng chấp nhận chờ. Số dư fintech **không nên** cache-aside đơn giản. Lock phải có TTL (tránh deadlock cache khi process giữ lock chết); coi chừng lock thành hot key → thêm L1 local.

### Hot key

Một key quá nóng dồn vào một node Redis → nghẽn dù cluster rảnh (sharding đặt nó ở một slot).
- **L1 (Caffeine) + L2 (Redis)**: L1 TTL ngắn chặn phần lớn read khỏi Redis.
- **Key replication nhân tạo**: ghi `key#1..key#N`, read random → rải tải nhiều slot (phức tạp khi invalidate).

> **Đào sâu senior.** L1+L2+DB là chuẩn production: L1 chặn ~90–99% read khỏi Redis. Chi phí: **invalidation lan tỏa** — dữ liệu đổi phải xóa L1 trên *mọi* instance (Redis pub/sub, hoặc chấp nhận TTL ngắn). Phát hiện hot key: Redis `--hotkeys`, sampling ở client; hot key xuất hiện đột ngột (flash sale) → cần phát hiện tự động + promote L1 động.

### Cache penetration

Query key **không tồn tại** (attacker quét ID) → luôn miss → luôn đập DB. **Cache cả null** (TTL ngắn) hoặc **Bloom filter** (không false negative → chặn query rác từ gốc).

> **Đào sâu senior.** Cache null đơn giản nhưng tốn RAM cho vô số key rác + có thể bị làm đầy. Bloom tiết kiệm bộ nhớ, false positive nhỏ (một tí query rác vẫn xuống DB, chấp nhận được). Tập key ổn định → bloom mạnh; thay đổi liên tục → counting/cuckoo filter. Kết hợp rate limit theo pattern.

### Cache avalanche & invalidation

**Avalanche**: nhiều key cùng TTL cùng hết hạn → spike. Fix: **jitter TTL** (`base + random(0, base*0.2)`). **Invalidation**: sau ghi DB thì **xóa key** (không update) → tránh race "ghi cache giá trị cũ đè mới".

> **Đào sâu senior.** Race hiếm với delete: read miss → load cũ → giữa đó write+delete → read ghi lại cũ. Giảm bằng **delayed double-delete** (xóa, ghi DB, đợi vài trăm ms, xóa lần nữa) hoặc TTL ngắn. **Nguyên tắc vàng fintech**: không cache số dư/hạn mức theo cache-aside; nếu buộc thì versioning hoặc push update qua CDC.

---

## 06 · Hot Partition & DB Bottleneck

### Hot partition: shard rồi vẫn lệch

Shard theo **thời gian** → ghi mới dồn vào shard hiện tại; shard theo entity có **whale** (merchant 40% giao dịch) → shard đó nóng; **monotonic key** → partition đầu/cuối luôn nóng. Chọn shard key **phân tán đều + khớp truy vấn** (hash userId thường hơn timestamp).

> **Đào sâu senior.** Căng thẳng: shard key vừa phân tán đều vừa gom dữ liệu hay query cùng nhau — hai mục tiêu xung đột. Hash phá range query, range dễ hot → composite `hash(tenant)+time`. Whale entity: tách shard riêng / sub-partition bên trong. Phân bố thường Zipf → phải lường whale, không giả định tải đều.

### Read replica lag

Ghi primary, đọc replica ngay → thấy cũ (fintech: vừa chuyển tiền thấy balance cũ). Route read nhạy cảm về primary; **read-your-writes** theo LSN; theo dõi replication lag như metric hạng nhất.

> **Đào sâu senior.** Lag không đều giữa các replica → hai read liên tiếp của cùng user sang hai replica lag khác nhau → vi phạm monotonic reads. Fix: sticky session / version token. Nguyên nhân lag tăng: long transaction giữ WAL, replica bị query nặng, single-thread apply → đo *apply lag* vs *network lag* trước khi vứt thêm replica.

### N+1 & query không index

N+1 (load list rồi loop query) biến 1 request thành hàng trăm query → pool cạn, DB bão hòa. `EXPLAIN` mọi query nóng; full table scan trên bảng lớn dưới tải cao làm nghẽn *toàn* DB (chiếm I/O/buffer chung).

> **Đào sâu senior.** N+1 giải bằng batch `IN (...)`, JOIN, `@EntityGraph` — nhưng cảnh giác **Cartesian product** khi JOIN FETCH nhiều collection (số row nổ theo tích, tệ hơn N+1). Query thiếu index dưới tải cao giữ buffer pool lâu, đẩy dữ liệu nóng khác ra khỏi cache → làm *các query khác* chậm theo. `EXPLAIN` trong CI + slow query log là tín hiệu hạng nhất.

---

## 07 · Observability & Debugging

### Distributed tracing

Trace ID sinh ở edge, truyền xuyên suốt qua header (W3C `traceparent`), gắn vào mọi log + cuộc gọi. **OpenTelemetry** auto-instrument Spring Boot qua Java agent. Trace phải **xuyên cả broker** (propagate context vào header message, nếu không đứt ở async).

> **Đào sâu senior.** Ba trụ không thay nhau: traces / metrics / logs. Liên kết bằng **exemplar** (trace ID gắn vào metric → từ spike p99 nhảy sang trace ví dụ) + trace ID trong mọi log. Context propagation dễ vỡ nhất qua **thread pool/async** (ThreadLocal không tự chuyển) và virtual thread/reactive — phần hay bị bỏ sót.

### Metrics: RED, USE, và p99

**RED** (service): Rate, Errors, Duration. **USE** (tài nguyên): Utilization, Saturation, Errors. Theo dõi **p99/p999, không phải trung bình** — mean giấu đuôi dài; p99=1s nghĩa 1% user (hàng nghìn người ở triệu request) chịu trải nghiệm tệ.

> **Đào sâu senior.** Fan-out: request gọi 100 service, mỗi service p99=1% → xác suất ít nhất một chậm là 1−0.99¹⁰⁰ ≈ **63%**. Tail từng service khuếch đại thành tail tệ hơn nhiều ở request tổng hợp. Dùng **histogram** (không trung bình các p99 — "average of percentiles" sai toán học); tail thường do GC pause, lock, queue, cold cache — thứ mean không bao giờ lộ.

### Sampling & health check

**Tail-based sampling**: giữ 100% trace lỗi/chậm, sample thấp trace bình thường. **Liveness** (còn sống → restart) tách khỏi **readiness** (sẵn sàng nhận traffic).

> **Đào sâu senior.** Bẫy cascading: readiness fail khi DB chậm → tất cả pod cùng rớt khỏi LB → mất toàn bộ capacity, biến DB chậm thành outage toàn phần. Đôi khi **degrade** tốt hơn rớt hẳn. Tail-based sampling cần buffer toàn bộ span của một trace trước khi quyết định (collector có state) → nặng hơn head-based nhưng giữ đúng cái cần.

---

## 08 · Operational Concerns

### API versioning & backward compatibility

Deploy độc lập → luôn có lúc A-v2 nói chuyện B-v1. Chỉ thêm field optional (consumer cũ bỏ qua); thay đổi phá vỡ → versioning rõ, chạy song song. Schema DB: **expand-contract** (thêm cột → ghi cả cũ/mới → backfill → chuyển đọc → xóa cũ), không đổi phá vỡ trong một bước.

> **Đào sâu senior.** Event khó hơn REST vì tồn tại lâu (replay) → **Schema Registry** (Avro/Protobuf) với compatibility BACKWARD/FORWARD tùy ai deploy trước. Expand-contract **bắt buộc** khi rolling (hai version chạy đồng thời trên cùng DB) — đổi tên cột một phát là pod cũ vỡ ngay. Tách qua nhiều release.

### Deployment an toàn

**Canary** (1–5% traffic, quan sát metric); **feature flag** (tách deploy khỏi release, tắt ngay khi lỗi); **DB migration** tương thích cả hai version (expand-contract).

> **Đào sâu senior.** Canary so với **baseline đồng thời** (cùng tải, cùng giờ), không so lịch sử — automated canary analysis (Kayenta) làm thống kê tránh thiên kiến. Feature flag có nợ kỹ thuật (n flag = 2ⁿ tổ hợp) → flag phải có vòng đời; phân biệt release flag (tạm) vs kill switch (lâu dài). Fintech nên có kill switch cho từng luồng tiền.

### Autoscaling lag & API gateway

Spike nhanh hơn tốc độ tạo pod (pull image, JVM warmup/JIT) → vài chục giây đầu vẫn nghẽn. Scale theo **leading indicator** (queue depth) không phải lagging (CPU); pre-warm cho sự kiện biết trước. Gateway phải scale ngang, không state. Rate limit (token bucket Redis) bảo vệ downstream.

> **Đào sâu senior.** JVM warmup: pod mới ở interpreter, C1/C2 chưa kick → 30–60s đầu *chậm + tốn CPU* đúng lúc HPA gửi traffic vào → làm *tệ đi* p99 sau scale-out. Giải: warmup readiness gate, **CRaC** (checkpoint/restore JVM nóng), hoặc **GraalVM native** (khởi động tức thì). Distributed rate limiter: token bucket Redis nhất quán nhưng mỗi request tốn round-trip → nhiều hệ dùng local bucket + reconcile định kỳ (đổi chính xác tuyệt đối lấy throughput).

---

## 09 · Idempotency — Mắt Xích Trung Tâm

### Cơ chế idempotency key

Client gửi kèm **idempotency key** (UUID, đại diện một ý định thao tác duy nhất):

```java
@PostMapping("/transfers")
Response transfer(@RequestHeader("Idempotency-Key") String key, @RequestBody TransferRequest req) {
    boolean firstTime = idempotencyStore.tryInsert(key, IN_PROGRESS);   // atomic
    if (!firstTime) {
        var rec = idempotencyStore.get(key);
        if (rec.status == COMPLETED)   return rec.savedResponse;         // trả lại kết quả cũ
        if (rec.status == IN_PROGRESS) return Response.status(409);      // đang xử lý
    }
    Response resp = doTransfer(req);
    idempotencyStore.update(key, COMPLETED, resp);                       // lưu CẢ response
    return resp;
}
```

- **Lưu cả response** (retry cần đúng transaction ID lần đầu, không chỉ 200 OK rỗng).
- **Atomic CAS** (`INSERT ... ON CONFLICT DO NOTHING` / unique constraint), không SELECT-rồi-INSERT (race).
- Xử lý **IN_PROGRESS** → 409 để client chờ. **TTL** đủ lâu cover retry hợp lý.

> **Đào sâu senior.** Bẫy: `doTransfer` xong nhưng `update` chưa kịp (crash giữa) → kẹt IN_PROGRESS mãi. Cần timeout trên IN_PROGRESS + `doTransfer` idempotent tầng dưới, lý tưởng bao cả hai trong cùng DB transaction. Dùng thêm **natural key** (transferId) làm unique constraint tầng DB → hai lưới an toàn.

### Idempotent consumer / inbox pattern

At-least-once + Outbox có thể gửi lặp → consumer khử trùng lặp bằng `eventId`:

```java
void handle(Event e) {
    if (!processedEvents.tryInsert(e.getEventId())) return;  // đã xử lý, bỏ qua
    process(e);
}
```

`tryInsert` + `process` lý tưởng **cùng transaction** (*inbox pattern*), nếu không có khe hở đánh dấu-xong-crash-trước-process.

> **Đào sâu senior.** Thứ tự quyết định failure mode: đánh dấu trước → risk *mất* message; process trước → risk *làm lại* (vô hại nếu idempotent). Không đặt cùng txn được thì chọn "process trước" + idempotent. Dedup store cần TTL đồng bộ với retention/replay window (message kẹt DLQ vài ngày rồi replay mà dedup hết hạn → xử lý lặp).

### Vì sao idempotency là trung tâm

- Không idempotency → **không được retry** (ch.01) → mất tự phục hồi.
- Không idempotency → **không dùng at-least-once messaging an toàn** (ch.04) → đuổi exactly-once ảo tưởng.
- **Outbox** (ch.03) chỉ an toàn *vì* consumer idempotent.

> **Ở fintech, idempotency là ranh giới giữa "an toàn" và "double-charge". Ưu tiên số một khi thiết kế bất kỳ luồng tiền nào.**

> **Đào sâu senior.** Các đảm bảo phân tán (delivery, ordering, consistency) đều mong manh + đắt khi theo đuổi ở mức hạ tầng. Idempotency dịch gánh nặng từ "hạ tầng phải gửi đúng một lần" sang "ứng dụng xử lý hai lần mà kết quả không đổi" → dễ đạt hơn, không phụ thuộc đảm bảo có thể vỡ. Đó là lý do nó là nguyên tắc **kiến trúc**, không chỉ kỹ thuật.

---

## 10 · System Design — Ghép Mọi Mảnh Lại

Chín chương trên là các *mảnh vấn đề* rời. Chương này là lớp tư duy phía trên: cách đi từ một dòng requirement mơ hồ đến kiến trúc chịu triệu request, và cách các pattern trước liên thông thành một thiết kế. Đây cũng là thứ phân biệt câu trả lời "thuộc bài" với câu trả lời "đã từng vận hành".

### Khung tiếp cận & back-of-envelope

Bốn bước, đừng nhảy cóc: (1) **làm rõ scope** — functional (chuyển tiền, xem số dư) vs non-functional (SLA, consistency, RPO/RTO); (2) **ước lượng tải** — QPS, storage, bandwidth; (3) **API + data model**; (4) **scale & failure** — chỗ nghẽn, chỗ chết.

Ước lượng ví dụ ví điện tử:

```
100M user, 10M giao dịch tiền/ngày
Trung bình: 10M / 86400 ≈ 115 write TPS       ← nhỏ đáng ngạc nhiên
Peak (giờ cao điểm x5, lễ tết x10):
  115 x 5  ≈ 575 TPS  thường ngày
  115 x 10 ≈ 1150 TPS đỉnh lễ                  ← con số PHẢI thiết kế cho
Read:write ≈ 100:1 (ai cũng refresh số dư)    → ~11.500 read TPS peak
Storage/năm: 10M x 365 x 1KB ≈ 3.6TB/năm (chưa index, chưa replica)
```

> **Đào sâu senior.** Mục tiêu ước lượng là **chọn kiến trúc**, không phải ra số đúng — sai 2x không đổi kết luận "~1000 TPS thì một Postgres + read replica thừa sức, chưa cần shard". Ba con số quan trọng hơn giá trị tuyệt đối: **peak-to-average** (thiết kế cho đỉnh — ch.08 autoscaling lag), **read:write** (quyết định cache/replica — ch.05–06), và **tăng trưởng** (3.6TB/năm → khi nào buộc shard). Fintech write TPS thường thấp mà read TPS cao → bottleneck nằm ở *đọc số dư*, không ở *ghi giao dịch* — đây là lý do phần lớn công sức đổ vào ch.05/06 chứ không phải ch.02.

### Ranh giới service: sync hay async?

Chia theo **bounded context** (Account, Payment, Ledger, Notification), không theo tầng kỹ thuật. Trong một luồng, phân biệt cái **phải đồng bộ** (kiểm tra số dư, authorize — user đang đợi kết quả) với cái **nên bất đồng bộ** (gửi SMS, cập nhật analytics, đối soát — không được chặn giao dịch).

> **Đào sâu senior.** Mỗi lời gọi sync nối thêm một mắt vào chuỗi failure và cộng dồn tail latency (fan-out ch.07: 5 service sync mỗi cái p99=1% → ~5% request chậm). Quy tắc: sync chỉ dành cho thứ nằm trên **critical path của quyết định** user đang chờ; mọi thứ khác đẩy qua event (ch.04) + outbox (ch.03). "Gửi SMS đồng bộ bên trong transaction chuyển tiền" là lỗi kinh điển — SMS gateway lag làm hỏng cả luồng tiền dù tiền đã chuyển xong.

### Data model & phân mảnh

Một hệ ở scale này không dùng một loại store: **OLTP** (Postgres) cho giao dịch cần ACID; **cache** (Redis) cho số dư đọc nóng có versioning (ch.05); **log/stream** (Kafka) cho event; **OLAP/warehouse** cho báo cáo — tách hẳn khỏi DB giao dịch để query nặng không đụng path tiền. Shard key chọn theo ch.06: `accountId` hash phân tán đều mà vẫn khớp truy vấn "mọi giao dịch của một account".

> **Đào sâu senior.** Quyết định strong vs eventual phải **theo từng field, không theo cả service**: `balance`/`credit_limit` strong (đọc primary — ch.03); `transaction_history`/`statistics` eventual (replica/projection). Ledger fintech nên **append-only double-entry** (mỗi chuyển khoản = hai dòng debit/credit bất biến) thay vì `UPDATE` cột balance — khi đó balance là *materialized view* của ledger: audit được, và né phần lớn race update (ch.09). Đây là CQRS tự nhiên: write model (ledger) khác read model (balance projection), nối thẳng vào eventual consistency của projection (ch.03).

### Bài toán mẫu: thiết kế luồng chuyển tiền end-to-end

Ghép cả 9 chương vào một luồng "A chuyển B 1 triệu":

```
1. Client → POST /transfers, kèm Idempotency-Key (ch.09)
2. Payment service: tryInsert(key, IN_PROGRESS) atomic — chặn double-submit
3. Mở saga (orchestration — ch.03):
     a. Debit A   → local txn: ghi ledger debit + outbox event, cùng commit (ch.03)
     b. Credit B  → consumer nhận event, idempotent theo eventId (ch.09), ghi ledger credit
     c. Notify    → async, ngoài critical path
   Fail giữa chừng: compensating credit-back A (KHÔNG "un-debit" — semantic, ch.03)
4. Mọi lời gọi downstream bọc timeout + circuit breaker + bulkhead (ch.01)
5. Đọc số dư sau đó: read-your-writes route về primary N giây / version token (ch.03);
   cache số dư có versioning, invalidate qua CDC (ch.05)
6. Trace ID xuyên suốt REST + propagate qua Kafka header (ch.07)
```

> **Đào sâu senior.** Điểm mấu chốt: **không chương nào đứng một mình**. Idempotency (ch.09) là thứ *cho phép* bước 4 retry an toàn; outbox (ch.03) an toàn *vì* consumer bước 3b idempotent; breaker (ch.01) dám fallback mạnh tay *vì* retry đã an toàn. Rút một mảnh là cả dây chuyền hở: bỏ idempotency → retry gây double-credit; bỏ outbox → crash giữa debit và publish làm B không bao giờ nhận tiền. Câu hỏi phỏng vấn thật không phải "vẽ box", mà "chỉ ra mọi điểm crash *giữa hai bước* và hệ tự lành ra sao" — đó là lý do tài liệu này xoáy vào failure mode chứ không vào happy path.

### Khung đánh đổi — không có kiến trúc đúng

Mọi quyết định lớn là một đánh đổi phải gọi tên ra: **consistency ↔ latency/availability** (CAP thực dụng — partition hiếm, nhưng khi xảy ra thì số dư chọn C, news feed chọn A); **cost ↔ performance** (multi-region active-active đắt gấp bội — chỉ mua nếu SLA đòi); **đơn giản ↔ tối ưu** (YAGNI: đừng shard/CQRS/multi-region khi ~1000 TPS một Postgres còn kham được).

> **Đào sâu senior.** Dấu hiệu một thiết kế trưởng thành: (1) **thiết kế cho failure là mặc định** — bắt đầu bằng "cái gì chết, lúc đó ra sao", không phải happy path; (2) **YAGNI với scale chưa tới** — kiến trúc vừa đủ cho tải hiện tại *nhưng biết đường tiến hóa* (khi nào thêm shard/replica/region), không over-engineer trước; (3) **đo trước khi tối ưu** — không có metric (ch.07) thì mọi tối ưu chỉ là đoán. Câu trả lời senior luôn kèm "đánh đổi của tôi là X vì SLA là Y", không bao giờ tuyên bố "đây là cách đúng".

---

## Thứ tự ưu tiên cho luồng tiền fintech

1. **Idempotency** mọi thao tác tiền
2. **Outbox** cho event giao dịch
3. **Timeout + circuit breaker + bulkhead** chống cascading
4. **RDS Proxy + connection sizing**
5. **Tracing + p99 metric**

Các pattern liên thông: idempotency mở khóa retry an toàn → retry an toàn cho phép breaker fallback mạnh dạn → Outbox + idempotent consumer giải dual-write → tất cả cần observability để thấy khi nó hỏng.
