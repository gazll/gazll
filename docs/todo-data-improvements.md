# TODO — cải thiện dữ liệu `content.json`

Ghi ngày **2026-07-31**. Trạng thái lúc ghi: **24 chủ đề · 282 mục · 70 cross-ref · 28 sơ đồ SVG**.

Ba việc dưới đây xếp theo **giá trị / công sức**. Làm được việc 1 thôi đã đáng.

---

## Chạy trước và sau mỗi lần sửa

```bash
# kiểm tra cấu trúc + xem báo cáo nội dung
node tools/validate-content.mjs --stats

# cú pháp JS (giống CI)
for f in $(find public -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done

# test hồi quy
NODE_NO_WARNINGS=1 node --experimental-vm-modules --test \
  tests/security.test.mjs tests/interviews.merge.test.mjs

# xem thật
cd public && python -m http.server 8080
```

`tools/validate-content.mjs` bắt: id trùng, `lvl`/`group` sai, `[[ ]]` lệch,
`:::` thiếu đóng, **dòng trắng trong `<pre>`/`<table>`** (làm đứt khối HTML),
`<` chưa escape, **SVG marker id trùng**, và cross-ref trỏ vào mục không tồn tại.

> Quy tắc bất di bất dịch: **không đánh số lại chủ đề/mục**. `item_id` là khoá
> đã lưu trong Google Sheet — đổi số là mồ côi toàn bộ `progress` và `notes`
> của mọi người. Chỉ được thêm vào cuối.

---

## 1. Liên kết chéo cho chủ đề cũ  ⭐ ưu tiên cao nhất

### Vấn đề

| | Cross-ref |
|---|---|
| Chủ đề 1–16 (210 mục, viết trước) | **~4** |
| Chủ đề 17–24 (72 mục, viết sau) | **~66** |

282 mục đang là 282 hòn đảo. Người học đọc 5.10 (deadlock trong DB) không hề
biết 23.3 (dining philosophers) đang giải thích **cùng một bài toán** ở tầng
ứng dụng, và 22.7 nói tiếp về thread-safety.

### Cách làm

Thêm một dòng vào khối `:::deep` của mục **cũ**, trỏ tới mục mới. Đúng một
dòng, không viết lại nội dung. Cú pháp đang dùng: mở ngoặc + id, ví dụ

```
- cùng bài toán ở tầng ứng dụng: triết gia ăn tối và 4 điều kiện Coffman (23.3)
```

Validator sẽ báo lỗi nếu id không tồn tại, nên cứ thêm rồi chạy nó.

### Danh sách cặp cụ thể — làm theo thứ tự này

**Concurrency (nhóm đậm đặc nhất, làm trước):**

| Sửa mục | Thêm ref tới | Lý do |
|---|---|---|
| `1.1` JMM, volatile | `23.7` | volatile chỉ cho khả kiến, CAS mới nguyên tử |
| `1.6` Thread pool vs Virtual Threads | `23.8` | code thật + bẫy pinning |
| `1.7` Structured concurrency, ScopedValue | `23.6`, `23.8` | `StructuredTaskScope` dùng thế nào |
| `1.8` ConcurrentHashMap | `22.7` | bẫy thao tác kép `containsKey` + `put` |
| `1.9` synchronized/ReentrantLock/StampedLock | `23.1`, `23.4` | code từng cái |
| `15.7` Multi-thread trong Spring Boot | `23.5`, `23.8` | CompletableFuture, virtual threads |

**Database:**

| Sửa mục | Thêm ref tới | Lý do |
|---|---|---|
| `5.9` optimistic vs pessimistic | `24.6` | aggregate là đơn vị tự nhiên của optimistic lock |
| `5.10` deadlock InnoDB | `23.3` | 4 điều kiện Coffman, đánh thứ tự tài nguyên |
| `5.11` đọc EXPLAIN | `18.2` | EXPLAIN ANALYZE đọc sâu |
| `5.12` tối ưu query ngoài index | `18.1`–`18.8` | cả chủ đề 18 là phần nối tiếp |
| `6.9` N+1 trong JPA | `18.8`, `12.16` | tầng app + domain vs entity |
| `7.9` Redis | `22.8` | TTL store: lazy + sampling như Redis làm |

**API & kiến trúc:**

| Sửa mục | Thêm ref tới | Lý do |
|---|---|---|
| `4.1` nguyên tắc REST | `17.1`, `17.2` | mô hình hoá resource, hành động non-CRUD |
| `4.4` versioning API | `17.8` | quy trình khai tử version |
| `4.5` pagination | `18.6` | keyset pagination |
| `4.11` contract-first | `17.8`, `24.3` | Published Language |
| `12.1`–`12.4` Layered/Clean | `12.15`–`12.22` | phần dựng thật trong code |
| `12.5`–`12.8` DDD | chủ đề `24` | phần đào sâu |
| `12.11` anemic domain | `24.1`, `24.8` | dấu hiệu và cách tránh |
| `12.13` modular monolith | `12.22` | Spring Modulith |
| `12.14` ACL | `24.3` | context mapping |

**System design & vận hành:**

| Sửa mục | Thêm ref tới | Lý do |
|---|---|---|
| `8.x` message queue | `24.7` | domain vs integration event, outbox |
| `9.x` distributed tx | `24.7` | outbox pattern |
| `10.6`–`10.9` rate limiter | `22.3` | code token bucket + sliding window |
| `11.x` các đề system design | `22.1` | vòng LLD khác vòng HLD thế nào |
| `13.6` access/refresh token | `20.8` | đừng log token |
| `14.10` 3 trụ cột observability | chủ đề `20` | cả chủ đề là phần nối tiếp |
| `14.x` K8s | `21.4` | OOMKilled, exit code 137 |
| `16.2` chống double-booking | `24.6`, `12.19` | giới hạn thật của aggregate |
| `16.11` whiteboard rate limiter | `22.3` | |
| `16.12`, `16.13` phương pháp DSA | `19.1` | khung 6 bước |

### Xong khi

- `node tools/validate-content.mjs --stats` báo **cross-references ≥ 100**
- Không mục nào trong bảng trên còn thiếu ref
- Mở site, bấm thử 5 ref ngẫu nhiên → id nhắc tới đúng là mục đang nói

---

## 2. Bồi 24 mục quá mỏng

### Vấn đề

Median độ dài câu trả lời là **1118 ký tự**. 24 mục dưới 800 — đọc xong không
đủ để trả lời phỏng vấn.

### Danh sách đầy đủ (id · độ dài · câu hỏi)

**Chủ đề 10 nặng nhất — 6/14 mục mỏng:**

```
10.2    662  Capacity estimation nhanh — back-of-envelope?
10.5    723  CDN giải quyết gì và caching ở biên hoạt động ra sao?
10.7    742  Leaky bucket vs token bucket khác gì?
10.10   677  Rate limit đặt ở đâu trong kiến trúc? Các tầng nào?
10.13   644  Scale database dưới tải: thứ tự ưu tiên?      ← ngắn nhất toàn site
10.14   778  Bottleneck analysis: tìm điểm nghẽn thế nào?
```

**Còn lại:**

```
1.18    749  HashSet / LinkedHashSet / TreeSet khác gì?
2.2     791  Java 11 mang lại gì đáng kể (so với 8)?
2.3     685  Java 13–16 chuẩn bị nền cho 17 thế nào?
2.7     736  Vì sao enterprise bám LTS thay vì bản mới nhất mỗi 6 tháng?
3.6     779  Starter dependency là gì và vì sao tiện?
4.3     752  Các kiểu streaming của gRPC?
4.6     797  GraphQL vs REST — khi nào hợp?
4.11    674  Contract-first với OpenAPI/Protobuf mang lại lợi ích gì?
5.12    660  Các kỹ thuật tối ưu query thường gặp ngoài index?
8.7     698  Ordering: hai broker đảm bảo thứ tự thế nào?
8.8     703  DLQ và poison message — xử lý thế nào?
11.3    758  Thiết kế URL shortener — các quyết định chính?
11.5    788  Thiết kế distributed rate limiter dịch vụ dùng chung?
12.1    751  Layered (n-tier) architecture: ưu/nhược?
12.12   785  Coupling & cohesion — la bàn thiết kế?
12.14   762  Anti-Corruption Layer (ACL) để làm gì?
13.6    779  Access token vs refresh token và chiến lược thu hồi?
14.10   779  Ba trụ cột observability và metrics RED/USE?
```

### Cách bồi — thêm đúng **một** trong ba thứ, không viết dài vô nghĩa

1. **Bảng so sánh** `<table class="cmp">` — hợp với `1.18`, `4.3`, `4.6`, `8.7`, `10.7`, `12.12`, `13.6`
2. **Con số / ví dụ thật** — hợp với `10.2` (công thức ước lượng), `10.13`, `11.3`, `11.5`
3. **Bẫy phỏng vấn** trong `:::warn` — hợp với `2.7`, `3.6`, `5.12`, `8.8`, `12.14`

Vài mục **nên trỏ sang chỗ đã viết kỹ thay vì viết lại** (gộp với việc 1):
`5.12` → chủ đề 18 · `10.7` → 22.3 · `12.1` → 12.15 · `14.10` → chủ đề 20 · `4.11` → 17.8.

### Xong khi

`--stats` báo **thin items < 800: ≤ 8**, và không mục nào < 700.

---

## 3. Thêm code block cho nhóm `core`

### Vấn đề

```
core       60 mục —  0 code block   ← đây
data       52 mục —  6
design     86 mục — 16
platform   46 mục — 21
algorithm  38 mục — 34
```

Nhóm `core` là **Java/JVM/Spring** — chính là chỗ code minh hoạ có giá trị
nhất, mà lại không có dòng nào. Đọc "happens-before" bằng văn xuôi thì rất khó
hình dung.

### 12 mục nên có code, xếp theo mức đáng làm

| Mục | Câu hỏi | Code nên thêm |
|---|---|---|
| `1.1` | JMM, happens-before, volatile | 2 thread + biến `flag`, cho thấy thiếu `volatile` thì loop không thoát |
| `1.8` | ConcurrentHashMap | `computeIfAbsent` vs `containsKey`+`put` |
| `1.9` | synchronized vs ReentrantLock vs StampedLock | 3 đoạn ngắn cạnh nhau |
| `1.11` | hợp đồng equals/hashCode | class vi phạm → mất phần tử trong `HashSet` |
| `1.16` | HashMap: hashing, treeify, resize | vòng đời một `put` khi va chạm |
| `1.13` | checked vs unchecked | wrap exception đúng cách, giữ `cause` |
| `3.2` | `@Transactional` self-invocation | đúng đoạn gọi `this.method()` bị mất transaction |
| `3.3` | propagation REQUIRED/REQUIRES_NEW/NESTED | 3 method lồng nhau + kết quả rollback |
| `3.4` | Spring AOP proxy | vì sao `private`/`final` không được advise |
| `3.15` | bean lifecycle 8 giai đoạn | `@PostConstruct`, `InitializingBean`, `BeanPostProcessor` |
| `2.5` | Java 21 đổi cuộc chơi | pattern matching + virtual thread cạnh code cũ |
| `15.8` | TCP vs UDP, blocking vs non-blocking | socket blocking vs `Selector` |

### Cú pháp (bắt buộc đúng, nếu không sẽ vỡ trang)

```html
<pre><code><span class="k">public</span> <span class="k">void</span> <span class="f">demo</span>() {
    <span class="c">// chú thích</span>
    <span class="k">int</span> x = <span class="n">1</span>;
    String s = <span class="s">"chuỗi"</span>;
}</code></pre>
```

Bảng màu: `.k` từ khoá · `.s` chuỗi · `.c` chú thích · `.n` số · `.f` tên hàm · `.r` nhấn đỏ.

**Ba lỗi làm vỡ trang — validator bắt được cả ba:**

1. **Dòng trắng trong `<pre>`** → khối HTML bị cắt, phần sau đổ ra dạng text.
   Cần ngăn cách thì dùng dòng chú thích: `<span class="c">//</span>`
2. **`<` chưa escape** → `Map<String,Integer>` phải viết `Map&lt;String,Integer&gt;`,
   kể cả trong `` `inline code` ``
3. **Dòng bắt đầu bằng `<`** sẽ mở khối raw HTML — chú ý khi xuống dòng

### Xong khi

`--stats` báo **items with code ≥ 69** (57 + 12), và nhóm `core` không còn là 0.

---

## Ghi chú cho lần sau

- Cách merge nội dung đã dùng: viết một file Python chứa dict item, rồi script
  merge vào `content.json` (idempotent — xoá bản cũ trước khi append). Script
  merge nằm ở scratchpad nên **đã mất**; nhưng `tools/validate-content.mjs`
  thì đã lưu vào repo, đó mới là phần quan trọng.
- Nếu thêm sơ đồ SVG: đặt trong `<figure class='dgm'>`, dùng đúng bảng màu ở
  `:root` của `styles.css`, và **marker id phải độc nhất toàn file** — đặt tên
  theo id mục (`ar6_165`) chứ đừng đánh số tăng dần.
- Việc 1 và 2 chồng lấn: nhiều mục mỏng chỉ cần thêm ref là vừa dày lên vừa
  nối mạng. Làm việc 1 trước rồi đo lại việc 2.
