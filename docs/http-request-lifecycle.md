# HTTP Request Lifecycle — Spring Boot (Synchronous REST)

Toàn bộ hành trình của **một** HTTP request: từ lúc user bấm chuột → qua mạng → qua kernel → vào Tomcat → qua filter → DispatcherServlet → DB → và quay ngược lại client.

> Mô hình ở đây là **Spring MVC (blocking, thread-per-request)** — không phải WebFlux.

---

## Sơ đồ tổng quan (compact)

```
   CLIENT                EDGE (optional)            HOST (OS/KERNEL)
┌──────────┐        ┌───────────────────────┐   ┌────────────────────────┐
│ Browser  │  DNS   │ CDN → WAF → LB        │   │ NIC → RingBuffer/      │
│ /App     │──TCP──▶│ → Reverse Proxy / GW  │──▶│ SoftIRQ → TCP stack    │
│          │  TLS   │   (SSL Termination)   │   │ (SYN/Accept queue)     │
└──────────┘  HTTP  └───────────────────────┘   │ → Socket Recv Buffer   │
     ▲                                          └───────────┬────────────┘
     │                                                      ▼
     │                             APPLICATION RUNTIME (TOMCAT NIO)
     │                    ┌──────────────────────────────────────────────┐
     │                    │ Acceptor → Poller(epoll) → Worker Pool        │
     │                    │        → Coyote HTTP11 parse → Servlet        │
     │                    └───────────────────────┬──────────────────────┘
     │                                            ▼
     │                     SERVLET CONTAINER — FilterChain.doFilter()
     │                    ┌──────────────────────────────────────────────┐
     │                    │ CorsFilter → Security → MDC/Log/Trace → ...   │
     │                    └───────────────────────┬──────────────────────┘
     │                                            ▼  DispatcherServlet
     │        ┌───────────────────────────────────────────────────────────┐
     │        │ 1 HandlerMapping → 2 preHandle → 3 HandlerAdapter          │
     │        │   3.1 ArgumentResolver → 3.2 Controller → 3.3 Service      │
     │        │   → 3.4 Repository → 3.5 ReturnValueHandler                │
     │        │   → 3.6 HttpMessageConverter (Jackson)                     │
     │        │ 4 postHandle → 5 ExceptionResolver → 6 afterCompletion     │
     │        └───────────────────────┬───────────────────────────────────┘
     │                                ▼  DATA LAYER
     │                    ┌──────────────────────────────────────────────┐
     │                    │ HikariCP → JDBC Driver → MySQL/PostgreSQL     │
     │                    │ (song song: Redis cache)                     │
     │                    └───────────────────────┬──────────────────────┘
     │                                            ▼
     │   RESPONSE PATH (ngược lại, cùng thread)
     └──── Client Receive ◀ TLS encrypt ◀ TCP ACK ◀ Socket write ◀ Flush
                                                        (Keep-Alive giữ connection)
```

**Điểm mấu chốt:** từ bước 4 đến bước 8, **một worker thread duy nhất** giữ nguyên request. Thread chỉ được trả về pool khi response đã flush xong → mọi thứ chậm ở giữa (DB, external API) đều là *thời gian giữ thread*.

---

## 1. Client Side

| Bước | Nội dung |
|---|---|
| User Action | Người dùng bấm/submit → app tạo HTTP Request |
| DNS Resolution | Browser Cache → OS Cache → Recursive DNS (root → TLD → authoritative) |
| TCP 3-Way Handshake | `SYN` → `SYN-ACK` → `ACK` (1 RTT) |
| TLS Handshake | Client Hello → Server Hello → Key Exchange (TLS 1.3: 1 RTT, 0-RTT nếu resume) |
| HTTP Request | `GET /api/v1/resource` + `Host:` + Headers + Body (JSON) |
| Keep-Alive | Connection được **tái sử dụng** cho các request sau → bỏ qua DNS/TCP/TLS |

```
GET /api/v1/resource HTTP/1.1
Host: api.example.com
Authorization: Bearer ...
Content-Type: application/json
```

> 💡 HTTP/1.1: 1 request/connection tại một thời điểm (head-of-line blocking) → browser mở ~6 connection/host.
> HTTP/2: multiplexing nhiều stream trên **một** connection + HPACK nén header.

---

## 2. Edge Layer (Optional)

`CDN → WAF → Load Balancer (ALB / Nginx / F5) → Reverse Proxy / API Gateway`

**Chức năng:**
- **SSL Termination** — giải mã TLS tại edge, đi tiếp bằng HTTP (hoặc re-encrypt)
- **Routing** theo Path/Host
- **Health Check** — loại instance chết khỏi pool
- **Connection Pooling** tới upstream

> ⚠️ Tầng này *có thể không tồn tại* (dev/local). Nhưng khi có, nó là nơi đầu tiên sinh ra `X-Forwarded-For` / `X-Request-Id` — Spring cần `server.forward-headers-strategy=framework` để lấy đúng IP/scheme gốc.

---

## 3. Host Layer (OS / Kernel)

```
NIC (HW Interrupt / NAPI)
   → Ring Buffer & SoftIRQ
      → TCP Stack Processing: SYN Queue → Accept Queue
         → Socket Receive Buffer (OS buffer)
            → user space (Tomcat đọc)
```

**Tham số kernel liên quan:**
- `net.core.somaxconn` — độ sâu **accept queue** (đi cùng `acceptCount` của Tomcat)
- `net.ipv4.tcp_max_syn_backlog` — độ sâu **SYN queue**
- `net.ipv4.tcp_syncookies` — chống SYN flood khi SYN queue đầy

> ⚠️ Accept queue đầy → kernel **drop** SYN/ACK im lặng → client thấy timeout/connection refused, trong khi app log *sạch bong*. Đây là loại sự cố hay bị đổ oan cho application.

---

## 4. Application Runtime (Tomcat NIO)

```
Acceptor Thread → Poller Thread (Selector/epoll) → Worker Thread Pool → Coyote HTTP11 parse
     nhận socket        theo dõi readiness         xử lý đồng bộ        → Request/Response object
```

- **Acceptor**: chỉ `accept()` socket rồi đăng ký vào Poller (không xử lý gì thêm)
- **Poller**: dùng `Selector`/epoll theo dõi hàng nghìn connection bằng 1–2 thread
- **Worker Thread Pool**: khi socket có data → giao cho worker thread, thread này **giữ suốt vòng đời request**
- **Coyote HTTP11**: parse request line/header/body → dựng `HttpServletRequest`/`Response`

**Cấu hình quan trọng:**

| Property | Ý nghĩa |
|---|---|
| `server.tomcat.accept-count` | độ dài backlog queue khi hết thread (mặc định 100) |
| `server.tomcat.max-connections` | số connection tối đa được giữ (mặc định 8192) |
| `server.tomcat.threads.max` | số worker thread (mặc định 200) |
| `server.tomcat.threads.min-spare` | thread giữ sẵn (mặc định 10) |
| `server.tomcat.connection-timeout` | timeout đọc request đầu tiên |
| `server.tomcat.keep-alive-timeout` | thời gian giữ connection idle |

> 💡 NIO cho phép **maxConnections ≫ maxThreads**: connection được giữ ở Poller, chỉ tiêu thụ thread khi thực sự có việc.
> Java 21: `spring.threads.virtual.enabled=true` → mỗi request một virtual thread, không còn bị chặn bởi `maxThreads`.

---

## 5. Servlet Container — Filter Chain

```
CorsFilter → Spring Security Filter Chain → Custom Filters (MDC, Logging, Tracing) → … → DispatcherServlet
```

- Chạy **tuần tự**, mỗi filter gọi `chain.doFilter(req, res)` để đi tiếp
- Có thể **short-circuit**: không gọi `doFilter` → trả response ngay (vd. Security trả 401, rate limiter trả 429)
- Response **unwind ngược** qua chain → phần code sau `chain.doFilter(...)` chạy trên đường về

> ⚠️ Filter đặt MDC (correlation id) **bắt buộc** phải `MDC.clear()` trong `finally` — thread được tái sử dụng từ pool, không clear = log lẫn request của người khác.

---

## 6. Spring MVC Flow — DispatcherServlet

DispatcherServlet là **Front Controller**: điều phối, không xử lý business.

| # | Thành phần | Vai trò |
|---|---|---|
| 1 | `HandlerMapping` | Tìm Controller phù hợp với `@RequestMapping` |
| 2 | `HandlerExecutionChain` | Gọi `Interceptor.preHandle()` |
| 3 | `HandlerAdapter` | `InvocableHandlerMethod` — thực thi handler |
| 3.1 | `ArgumentResolver` | Deserialize JSON, `@Valid`, `@RequestParam`, `@PathVariable` |
| 3.2 | Controller | `@RestController` — nhận DTO, gọi service |
| 3.3 | Service Layer | `@Transactional` — mở/commit transaction ở đây |
| 3.4 | Repository Layer | Spring Data JPA / JDBC |
| 3.5 | `ReturnValueHandler` | Xử lý giá trị trả về (`ResponseEntity`, DTO…) |
| 3.6 | `HttpMessageConverter` | Jackson serialize object → JSON |
| 4 | `Interceptor.postHandle` | Chỉ chạy nếu **không** có exception |
| 5 | `HandlerExceptionResolver` | Bắt exception & map HTTP status (`@ControllerAdvice`) |
| 6 | `Interceptor.afterCompletion` | **Luôn** chạy — cleanup ThreadLocal / MDC |

> 💡 `@Transactional` nằm ở service (bước 3.3) nhưng **serialize JSON ở bước 3.6 — sau khi tx đã commit**. Đây là lý do lazy-loading của JPA nổ `LazyInitializationException` khi Jackson đụng vào collection chưa fetch.

---

## 7. Data Layer

```
HikariCP (pool) → JDBC Driver → Database (MySQL / PostgreSQL)
                              ↘ Redis (Cache)
```

**HikariCP:**

| Property | Ghi chú |
|---|---|
| `maximum-pool-size` | thường 10–20; **nhỏ hơn nhiều** so với 200 thread Tomcat |
| `connection-timeout` | chờ lấy connection từ pool (mặc định 30s) — hết → `SQLTransientConnectionException` |
| `idle-timeout` / `max-lifetime` | phải **nhỏ hơn** timeout của DB / firewall |

> ⚠️ Nút thắt thật thường **không** phải thread pool Tomcat mà là HikariCP: 200 thread tranh 20 connection → 180 thread xếp hàng. Tăng `maxThreads` chỉ làm queue dài hơn, không nhanh hơn.
> Theo dõi `hikaricp_connections_pending` qua Actuator.

---

## 8. Response Path Back to Client

```
Response Flush (filter chain unwinding)
  → Tomcat Socket Write (flush OS send buffer)
    → TCP ACK (Keep-Alive hoặc FIN)
      → TLS Encryption (nếu HTTPS)
        → Client Receive (JSON parse / DOM render)
```

Đi ngược đúng các tầng đã đi qua, **trên cùng worker thread**. Thread chỉ được trả về pool sau bước này.

---

## Cross-Cutting Concerns

| Mối quan tâm | Cơ chế Spring |
|---|---|
| Security | Authentication & Authorization (Security Filter Chain) |
| Logging | MDC + Correlation ID |
| Tracing | OpenTelemetry (trace id lan qua các service) |
| Metrics | Micrometer (→ Prometheus) |
| Rate Limiting | Bảo vệ ở edge hoặc filter |
| Exception Handling | `@ControllerAdvice` |
| Validation | `@Valid` (Bean Validation) |
| Transaction | `@Transactional` (AOP proxy) |

---

## Protocol Stack

| Tầng | Giao thức |
|---|---|
| Application | HTTP/1.1 · HTTP/2 |
| Presentation | TLS / SSL |
| Transport | TCP |
| Network | IP |
| Link | Ethernet |

---

## Potential Bottlenecks

| Nút thắt | Nguyên nhân | Dấu hiệu / metric |
|---|---|---|
| DNS Latency | phụ thuộc bên ngoài | p99 lệch bất thường ở request đầu |
| TLS Handshake | CPU / Network | CPU cao khi không keep-alive |
| Load Balancer | Saturation | 502/504 tại LB, không có log app |
| Tomcat Accept Queue | Backlog full | connection refused/timeout, app log sạch |
| Tomcat Thread Pool | Exhausted | `tomcat_threads_busy` chạm max |
| HikariCP Pool | Exhausted | `hikaricp_connections_pending > 0` |
| Slow Queries / Lock | Database | thời gian tx dài, deadlock |
| Redis Latency | Network / CPU | cache lookup chậm hơn cả DB |
| Serialization | Big payload | CPU cao ở Jackson, response lớn |
| GC Pause | Stop-the-world | p99 nhảy vọt theo chu kỳ |

---

## Failure Flow

```
Exception / Error (ở bất kỳ tầng nào)
   → HandlerExceptionResolver (hoặc @ControllerAdvice)
      → Error Response (JSON)
         → Client nhận 4xx / 5xx
```

Lỗi xảy ra **trước** DispatcherServlet (vd. trong filter Security) **không** đi qua `@ControllerAdvice` — cần `AuthenticationEntryPoint`/`ErrorController` để định dạng JSON thống nhất.

---

## Legend (theo ảnh gốc)

| Ký hiệu | Ý nghĩa |
|---|---|
| ─────▶ | Synchronous Flow |
| ─ ─ ─▶ | Internal Flow |
| ◀─ ─ ─ | Return Flow |
| ┈┈┈ (viền đứt) | Optional Component |

---

## Nguồn

Sơ đồ gốc: [`http-request-lifecycle.png`](http-request-lifecycle.png)
