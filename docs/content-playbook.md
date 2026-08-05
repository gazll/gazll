# Content playbook — thêm, sửa và cập nhật kiến thức

Quy trình để nội dung không bị lệch EN/VI, không vỡ trang, và không mồ côi
dữ liệu học của người đọc. Đọc `CLAUDE.md` trước cho bối cảnh kiến trúc;
file này là **thao tác**.

> **Luật bất di bất dịch: không bao giờ đổi `item_id`.**
> `item_id` là khoá đã lưu trong Google Sheet (`progress`, `notes`,
> `study_log`). Đổi tên file topic hay sửa tiêu đề section (làm slug đổi
> theo) là mồ côi toàn bộ tiến độ của mọi người đọc. Chỉ được **thêm vào
> cuối**. Muốn bỏ một mục thì để nguyên id, sửa nội dung.

---

## 0. Năm lệnh phải thuộc

```bash
node tools/validate-content.mjs --stats   # cấu trúc: sai là FAIL, phải sạch trước khi push
node tools/audit-content.mjs              # biên tập: parity EN/VI + độ phủ ví dụ
node tools/audit-content.mjs --stale      # kiến thức nào gắn version/năm → cần review
node tools/audit-content.mjs --gaps       # mục nào dài mà chưa có ví dụ minh hoạ
node tools/audit-content.mjs --refs       # alias kiểu ch.12 chưa trỏ tới item_id thật
node tools/audit-content.mjs --dense      # mục nào dính đoạn → cần xuống dòng (§2.6)
```

Khác nhau chỗ nào: `validate-content.mjs` **fail build** khi cấu trúc sai.
`audit-content.mjs` **không bao giờ fail** — nó chỉ báo cáo để người đọc tự
quyết, vì "nội dung đã đủ hay chưa" là phán đoán, không phải luật.

---

## 1. Điều tra: quyết định sửa cái gì

Đừng bắt đầu bằng việc viết. Bắt đầu bằng việc tìm **chỗ thật sự thiếu**.

### 1.1 Kiến thức đã cũ chưa?

```bash
node tools/audit-content.mjs --stale
```

Liệt kê mọi mục có gắn số version, năm hoặc tên chuẩn/công cụ thay đổi nhanh
(OAuth, OWASP, OpenTelemetry, Resilience4j, HikariCP, async-profiler). Đây là
phần rữa trước nhất. Với mỗi mục, tự hỏi:

- Version nêu ra còn là bản người ta thật sự dùng không? (`Spring Boot 3.2`
  viết năm 2025 — 2026 đã khác chưa?)
- Tính năng "preview/incubator" đã final chưa? (`ScopedValue` từng là
  preview, Java 25 đã final → câu chữ phải đổi)
- Con số benchmark có còn đúng thế hệ phần cứng/runtime hiện tại không?
- Khuyến nghị đã đảo chiều chưa? (ví dụ OAuth 2.1 draft hiện yêu cầu PKCE
  cho **public client** và khuyến nghị cho confidential client; OAuth 2.0
  Security BCP là nguồn chuẩn đã phát hành, không gọi draft là RFC)

### 1.2 Có chỗ nào nói mà không cho thấy không?

```bash
node tools/audit-content.mjs --gaps
```

Sắp xếp theo lượng **văn xuôi người đọc nhìn thấy**: mục càng dài mà không
có code, bảng hoặc figure thì càng đáng nghi. HTML/tag soup không được tính
thành độ dài, còn bảng và diagram đã được coi là bằng chứng minh hoạ.

Tiêu chí chọn (dành cho người đã senior — **bỏ qua mấy thứ cơ bản**):

| Nên thêm ví dụ khi | Không cần thêm khi |
|---|---|
| Mục *nhắc tên* một công cụ/field nhưng chưa bao giờ show (`key_len`, `pg_stat_replication`) | Khái niệm đã có bảng so sánh đầy đủ |
| Lỗi nổ lúc **startup** hoặc **âm thầm** (`MultipleBagFetchException`, implicit cast) | Code chỉ minh hoạ cú pháp phổ thông |
| Có con số đo được để chứng minh (`380MB → 1100MB`) | Ví dụ chỉ lặp lại điều đoạn văn đã nói |
| Có cái bẫy lọt qua được code review | Mục ngắn nhưng đã trọn ý |

### 1.3 Kiểm chéo trước khi viết — tránh trùng lặp

Đây là bước **hay bị bỏ nhất** và tốn công nhất khi phát hiện muộn:

```bash
# khái niệm định viết đã nằm đâu đó chưa?
grep -o "UUIDv7\|MultipleBagFetch\|key_len" public/data/topics/*.json | grep -v '.vi.json' | sort | uniq -c
```

Nếu đã có chỗ khác viết kỹ → **trỏ sang đó bằng cross-ref**, đừng viết lại.
Cross-ref viết là id trong ngoặc đơn, validator kiểm target có thật:

```
... id có thứ tự thời gian (06-db-scaling.sharding-partitioning.q3).
```

Chạy thêm `node tools/audit-content.mjs --refs`. Alias tự do như `(ch.12)`
không được validator kiểm target, dễ sai sau khi sắp xếp tài liệu; phải thay
bằng `item_id` bất biến. Mỗi khái niệm nên có **một topic sở hữu phần giải
thích sâu**, các topic khác tóm tắt theo ngữ cảnh rồi cross-ref sang đó.

### 1.4 Phân loại claim trước khi viết

Mỗi khẳng định quan trọng thuộc một trong ba loại:

| Loại | Cách viết |
|---|---|
| `normative` | Chuẩn/API/documentation nói gì; dùng MUST/SHOULD đúng nghĩa và ghi rõ version |
| `heuristic` | Kinh nghiệm phụ thuộc workload; nêu điều kiện, tín hiệu đo và lúc nào đổi quyết định |
| `example` | Một phép đo/case study cụ thể; không suy rộng thành chân lý phổ quát |

Con số benchmark chỉ có giá trị khi kèm workload, dữ liệu, phần cứng,
runtime/config và phương pháp đo. Nếu thiếu provenance, đổi thành quy trình
đo hoặc ghi rõ đây là ví dụ minh hoạ — không viết `nhanh hơn 4×`, `tốn 70%`
như một hằng số của công nghệ.

---

## 2. Viết: luật format

### 2.1 Schema một mục — đúng 4 khoá, không hơn

```json
{
  "id": "05-db-core-index-lock.indexes-what-they-really-are.q4",
  "difficulty": "core",
  "q": "…",
  "a": "…"
}
```

`difficulty`: `core` (CORE) · `advanced` (ADVANCED) · `extra` (EXTRA) —
định nghĩa ở [lib/constants.js](../public/lib/constants.js).
`id` = `{topic-key}.{section-slug}.q{n}`, `topic-key` là tên file bỏ `.json`.

### 2.2 Cú pháp renderer hỗ trợ

`renderMarkdown` ([lib/markdown.js](../public/lib/markdown.js)) chỉ hiểu bấy nhiêu đây:

| Cú pháp | Ra gì |
|---|---|
| `**đậm**` · `*nghiêng*` · `` `code` `` | `<strong>` `<em>` `<code>` |
| `- ` hoặc `1. ` đầu dòng | `<ul>` / `<ol>` |
| `[[r:…]]` `[[g:…]]` `[[o:…]]` `[[b:…]]` | chữ tô màu (đỏ/xanh lá/cam/xanh dương) |
| `:::tip Nhãn` … `:::` | hộp chốt ý |
| `:::warn Nhãn` … `:::` | hộp cảnh báo |
| `:::deep` … `:::` | khối DEEP DIVE · SENIOR |
| dòng bắt đầu bằng `<` | HTML thô, **đến dòng trắng đầu tiên** |

### 2.3 Bốn cái bẫy làm vỡ trang

**a. `renderMarkdown` không bao giờ escape → `<` phải viết `&lt;`**, kể cả
trong `` `inline code` ``. `` `jcmd <pid>` `` sinh ra thẻ `<pid>` thật và
trình duyệt nuốt mất. Chỉ `<` theo sau bởi dấu cách mới sống sót thành chữ.

**b. Dòng trắng trong `<pre>`/`<table>`/`<figure>` cắt đứt khối HTML.**
Cần ngăn cách thì dùng một dòng comment:

```html
<span class="c">    </span>
```

**c. `:::tip` và `:::warn` chỉ nhận MỘT đoạn văn.** Renderer nối mọi dòng
bên trong bằng dấu cách rồi chạy inline — list, bảng, `<pre>` đặt trong đó
sẽ bẹp thành một dòng. **Chỉ `:::deep` mới render đệ quy đầy đủ.**

**d. SVG `<marker id>` phải độc nhất toàn site.** Mọi card mở ra dùng chung
một DOM, nên `url(#ar6)` trỏ vào diagram nào render trước. Đặt tên theo id
mục: `ar6_165`.

### 2.4 Code block — bảng màu và khuôn

```html
<pre><code><span class="c">-- chú thích</span>
<span class="k">SELECT</span> col <span class="k">FROM</span> t <span class="k">WHERE</span> x = <span class="n">1</span>;
<span class="c">--</span>
<span class="k">public</span> <span class="k">void</span> <span class="f">demo</span>() {
    Map&lt;String,Integer&gt; m = <span class="k">new</span> HashMap&lt;&gt;();
    String s = <span class="s">"chuỗi"</span>;
    <span class="r">// dòng sai — tô đỏ</span>
}</code></pre>
```

`.k` từ khoá · `.s` chuỗi · `.c` chú thích · `.n` số · `.f` tên hàm ·
`.r` nhấn đỏ. Các class này **scoped trong `pre code`** — chúng chỉ dài một
chữ và đụng với class UI (`.f` là form-field của modal interview).

Nguyên tắc viết code cho tài liệu này: **mã giả là được, chỗ nào code thật
mà ngắn thì code thật.** Không viết khung sườn thừa. Comment mang phần giải
thích — người đọc nhìn code là hiểu, không phải đọc đoạn văn bên dưới mới hiểu.

Nếu gọi snippet là code thật, nó phải biên dịch/chạy trên đúng version đã
nêu hoặc được lấy từ API documentation chính thức. Nếu cố tình lược import,
error handling hay infrastructure, ghi `pseudocode`/`abridged`; đừng để mã
trông như copy-paste được nhưng dùng API đã lỗi thời.

### 2.5 Metadata review nằm ngoài schema runtime

Item runtime vẫn đúng **4 khoá**. Provenance của claim dễ lỗi thời ghi riêng
trong `public/data/content-reviews.json`, keyed bằng chính `item_id`:

```json
{
  "13-security-oauth2.oauth2-oidc.q2": {
    "reviewed_at": "2026-08-01",
    "target_versions": ["OAuth 2.1 draft-15", "OAuth 2.0 Security BCP"],
    "claim_type": "normative",
    "sources": ["https://www.rfc-editor.org/rfc/rfc9700.html"]
  }
}
```

Chỉ dùng nguồn chính thức/primary cho claim normative. `reviewed_at` cho biết
lần kiểm chứng cuối, không phải lời hứa nội dung đúng mãi. Review lại khi có
release/standard/advisory mới, không chỉ đợi lịch sáu tháng.

### 2.6 Đừng để dính đoạn — đơn vị đọc là "run"

Người đọc gặp nội dung theo từng **run**: một đoạn văn, một gạch đầu dòng,
hoặc một callout. Run dài là thứ làm câu trả lời "dính" lại, không phải tổng
độ dài của mục.

| Ngưỡng | Ý nghĩa |
|---|---|
| ≤ 300 ký tự / run | **bất biến hiện tại của toàn bộ `data/`** — run dài nhất đúng 300 |
| > 300 ký tự / run | `--dense` gọi là **wall**, cần tách |
| > 120 ký tự / ô bảng không có `<br>` | ô bảng đang chứa văn xuôi, tách bằng `<b>Nhãn:</b> … <br>` |

Phân bố hiện tại (7254 run): p50 119 · p90 224 · p95 253 · p99 288 · max 300.

Cách tách, theo thứ tự nên thử:

- **Dòng trắng** giữa hai ý — rẻ nhất, hiệu quả nhất.
- **`**Lead-in:**` rồi list** thay cho chuỗi câu nối bằng dấu phẩy/`and`.
- **`<br>` + `<b>nhãn</b>` trong `<td>`** thay vì viết văn xuôi trong ô bảng.
- **Cắt `<pre>` dài thành khối có nhãn**, ngăn bằng dòng `────` — xem lại
  §2.3b: dòng trắng trong `<pre>` sẽ cắt đứt khối HTML, nên phải dùng nhãn
  chứ không phải dòng trắng.

> **`:::tip` và `:::warn` không tách được bằng dòng trắng.** Renderer nối mọi
> dòng bên trong thành một đoạn (§2.3c), nên một `:::warn` 400 ký tự vẫn hiện
> ra là một khối liền. Chỉ có hai cách: viết ngắn lại, hoặc đưa phần giải
> thích ra ngoài box. `:::deep` thì render đệ quy nên tách bình thường.

Sửa EN thì **sửa cả VI**: `--dense` in số theo dạng `EN/VI`, hai bên lệch
nhau là biết đã quên một bên.

---

## 3. EN/VI: hai file, một cấu trúc

English là **ngôn ngữ gốc**; `NN-slug.json` là bản EN đầy đủ,
`NN-slug.vi.json` là bản VI đầy đủ. Cả hai **cùng thứ tự section, cùng thứ
tự item, cùng `id`, cùng `difficulty`** — chỉ khác chữ.

### Dịch thế nào

- **Giữ nguyên thuật ngữ tiếng Anh**: `happens-before`, `escape analysis`,
  `backpressure`, `partition`, `cache`, `request`. Đây là cách dev backend
  VN thật sự nói và viết.
- **Dịch phần văn xuôi**: giải thích, hệ quả, lời khuyên.
- **Không dịch**: tiêu đề section kỹ thuật (`Concurrency`, `OAuth2 & OIDC`),
  tags trong `meta.json`, tên riêng.
- **Đừng để sót từ tiếng Anh thường** giữa câu tiếng Việt (`tailored`,
  `however`, `instead of`) — `audit-content.mjs` bắt được nhóm này.
- Văn VI **súc tích hơn EN là bình thường** (khoảng 0.6–0.9 lần độ dài).
  Không phải lỗi.
- **Số theo locale VI**: `86.400`, `2,6`, `1.200`. Ký hiệu nhân dùng `×`.

### Bất biến phải giữ

Số lượng `<pre>`, `<table>`, `<svg>`, `:::deep/tip/warn`, `[[…]]` **phải
bằng nhau** giữa hai file. Sửa một bên mà quên bên kia là lỗi hay gặp nhất
— `audit-content.mjs` báo ngay ở mục "EN/VI parity".

Giao diện thì **luôn tiếng Anh, không đổi theo switch** — kể cả nhãn
`DEEP DIVE · SENIOR`. Chỉ *nội dung học* mới có EN/VI.

---

## 4. Áp dụng thay đổi

### 4.1 Sửa nhỏ, một chỗ

Sửa thẳng trong `data/topics/NN-slug.json` **và** `.vi.json`. Nhớ giữ
format 2-space + newline cuối file, nếu không một thay đổi nhỏ biến thành
diff cả file.

### 4.2 Thêm block vào nhiều mục — dùng patch file

Sửa tay các file này rất dễ sai: mỗi câu trả lời là **một dòng JSON dài
hàng nghìn ký tự**. Dùng [tools/add-content.mjs](../tools/add-content.mjs):

```bash
node tools/add-content.mjs my.patch --dry-run   # xem trước
node tools/add-content.mjs my.patch             # áp dụng
```

Định dạng patch — header rồi nội dung literal đến header kế tiếp:

```
@@ deep 05-db-core-index-lock.indexes-what-they-really-are.q4 en
**`key_len` tells you how much of the index was really used:**
<pre><code>...</code></pre>

@@ deep 05-db-core-index-lock.indexes-what-they-really-are.q4 vi
**`key_len` cho biết index thực sự dùng tới đâu:**
<pre><code>...</code></pre>
```

Các chế độ đặt block:

| mode | Chèn vào đâu |
|---|---|
| `deep` | cuối khối `:::deep` — **chọn mặc định** cho chi tiết senior |
| `body` | cuối phần thân, **trước** callout đầu tiên |
| `end` | cuối câu trả lời, sau mọi callout |

Khi cần biên tập lại toàn bộ một field, dùng `answer` hoặc `question` thay
cho mode chèn. `answer` nhận nội dung nhiều dòng tới header kế tiếp;
`question` bắt buộc đúng một dòng. Cả hai vẫn tìm item bằng immutable id và
hỗ trợ `--dry-run`:

```
@@ question 07-sql-nosql-db-engines.engine-by-engine.q4 en
When does MongoDB avoid joins, and what consistency trade-offs remain?

@@ answer 07-sql-nosql-db-engines.engine-by-engine.q4 en
Complete replacement answer…
```

Để sửa đúng một fragment trong answer mà không copy lại cả field, dùng
`replace`; đặt old/new fragment hai phía của dòng `=>`. Công cụ sẽ fail nếu
old fragment không tồn tại hoặc xuất hiện nhiều lần, và sẽ skip khi new
fragment đã có:

```
@@ replace 01-java-core-jvm.memory-execution-model.q1 en
Old exact text
=>
New exact text
```

Để append một item vào section hiện có, dùng mode `item`, thêm
`core|advanced|extra` ở cuối header và đặt câu hỏi ở dòng đầu với tiền tố `? `.
ID phải là `q` kế tiếp của section; object được ghi ra vẫn giữ đúng bốn field
`id`, `difficulty`, `q`, `a`:

```
@@ item 03-spring-boot-deep-build.auto-configuration-build.q11 en extra
? Which platform generation should a new service target?
Answer text…

@@ item 03-spring-boot-deep-build.auto-configuration-build.q11 vi extra
? Dịch vụ mới nên chọn thế hệ platform nào?
Nội dung trả lời…
```

Công cụ này **idempotent** (chạy lại không nhân đôi) và **cảnh báo khi chỉ
patch một ngôn ngữ**.

### 4.3 Thêm topic mới (hiếm)

1. `public/data/topics/NN-slug.json` + `NN-slug.vi.json`
2. Thêm dòng vào `manifest.json`: `{ "n": NN, "file": "topics/NN-slug.json", "topic_type": "…" }`
3. Thêm khối vào `meta.json` — **cả `en` và `vi`**, mỗi bên đủ
   `label`/`title`/`intro`/`tags`, cộng `key` (= tên file bỏ `.json`) và
   `topic_type` (phải khớp manifest)
4. `topic_type` phải thuộc `TOPIC_TYPES` — sai một chữ là topic mất màu và
   rớt khỏi thanh filter

Vòng tiến độ tự tính theo tổng số mục, không hardcode — không phải sửa gì thêm.

### 4.4 Thêm case study dài

Case Studies dùng cùng quy ước số và cặp ngôn ngữ với Topics, nhưng không đi
vào Study Track hay mẫu question/answer:

1. Thêm row `n` kế tiếp vào `public/data/case-studies/manifest.json`; `file`
   phải là `case-studies/NN-slug.json`. Giữ `slug` không có số để URL cũ ổn định.
2. Thêm metadata `en` + `vi` vào `case-studies/meta.json`; `key` phải đúng
   `NN-slug`.
3. Tạo `NN-slug.json` + `NN-slug.vi.json`, mỗi file chứa `guide` đầy đủ và
   `body_file` tương ứng.
4. Tạo đủ `articles/NN-slug.html` + `articles/NN-slug.vi.html`. Hai body phải
   có cùng heading ID, thứ tự hình và code block; không dịch nội dung trong
   `<pre><code>`.
5. Đặt toàn bộ hình tại `assets/case-studies/NN-slug/`; cấm hotlink ảnh từ
   publisher và không để asset mồ côi.

`tests/case-studies.test.mjs` khóa các quy tắc trên, đồng thời kiểm tra đủ 96
hình hiện tại trong cả hai nguồn. Header EN/VI dùng chung `Content.lang`; không
tạo language state riêng cho Case Studies.

---

## 5. Kiểm chứng trước khi push

Chạy đủ, theo thứ tự:

```bash
# 1. cấu trúc — phải OK
node tools/validate-content.mjs --stats

# 2. biên tập — parity EN/VI phải "no drift"
node tools/audit-content.mjs

# 2b. cross-ref tạm kiểu ch.xx phải là "none"
node tools/audit-content.mjs --refs

# 2c. mục vừa sửa không được nằm trong danh sách wall (§2.6)
node tools/audit-content.mjs --dense

# 3. cú pháp JS (giống CI)
for f in $(find public -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done

# 4. test
NODE_NO_WARNINGS=1 node --experimental-vm-modules --test tests/*.test.mjs

# 5. CI từ chối mọi console.* — lệnh này phải KHÔNG ra gì
grep -RInE 'console\.(log|info|warn|error|debug)|Logger\.log' public apps-script

# 6. xem thật
cd public && python -m http.server 8080     # hoặc: npx serve public
```

### Kiểm render khi đã thêm HTML thô

Validator bắt lỗi cấu trúc, nhưng muốn chắc block hiển thị đúng thì render
thử bằng chính renderer của site:

```bash
node -e "
import('./public/lib/markdown.js').then(m => {
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('public/data/topics/05-db-core-index-lock.json','utf8'));
  d.sections.forEach(s => s.items.forEach(it => {
    if (it.id !== 'ID-CAN-KIEM') return;
    const h = m.renderMarkdown(it.a);
    const n = re => (h.match(re) || []).length;
    console.log('pre', n(/<pre>/g), n(/<\/pre>/g), 'div', n(/<div/g), n(/<\/div>/g),
                'leak', /&lt;pre&gt;|:::/.test(h));
  }));
});"
```

`pre`/`div` phải cân, `leak` phải `false`. `leak=true` nghĩa là có `<`
chưa escape hoặc `:::` không đóng.

Cuối cùng **mở trang và bấm thử EN/VI** trên chính mục vừa sửa. Có những
thứ chỉ thấy bằng mắt: bảng tràn, code xuống dòng xấu, diagram mượn
arrowhead của nhau.

---

## 6. Nhịp cập nhật đề nghị

| Khi nào | Làm gì |
|---|---|
| Mỗi lần đụng vào nội dung | mục 5 — đủ 6 bước |
| Có bản Java/Spring LTS mới | `--stale`, rà nhóm `core` + topic 2, 23 |
| Có RFC/draft, OWASP, OTel semantic convention hoặc security advisory mới | rà topic 13, 20 và metadata nguồn liên quan |
| Có release DB/Kafka/Kubernetes/library vận hành mới | `--stale`, rà claim normative và migration note |
| Mỗi ~6 tháng | `--stale` toàn bộ, soát benchmark, heuristic và link nguồn |
| Sau phỏng vấn thật | ghi câu hỏi chưa trả lời tốt → thành mục mới hoặc bồi mục cũ |

Khi cập nhật một sự thật đã đổi: **sửa nội dung, giữ nguyên `id`**. Nếu
điều cũ vẫn đáng biết (vì hệ thống production còn chạy bản cũ), giữ lại và
ghi rõ mốc — "trước Java 21 thì …, từ 21 trở đi …" có giá trị hơn là xoá
sạch dấu vết.

---

## 7. Checklist rút gọn

- [ ] Đã `grep` xem khái niệm này viết ở đâu chưa → trùng thì cross-ref
- [ ] Cross-ref dùng `item_id` thật; `--refs` báo `none`
- [ ] Claim là normative/heuristic/example; benchmark có provenance
- [ ] Claim dễ lỗi thời đã cập nhật `content-reviews.json`
- [ ] `id` không đổi, chỉ thêm vào cuối
- [ ] `<` viết thành `&lt;`, kể cả trong inline code
- [ ] Không có dòng trắng trong `<pre>`/`<table>`/`<figure>`
- [ ] `:::tip`/`:::warn` chỉ chứa một đoạn văn — và đủ ngắn để đọc liền (§2.6)
- [ ] Không có run nào > 300 ký tự; ô bảng dài đã tách bằng `<br>`
- [ ] SVG marker id đặt theo id mục
- [ ] **Đã sửa cả `.json` và `.vi.json`**
- [ ] `validate-content.mjs` OK · `audit-content.mjs` no drift
- [ ] Test pass · không có `console.*`
- [ ] Đã mở trang bấm thử EN/VI
