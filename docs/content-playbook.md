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

## 0. Bốn lệnh phải thuộc

```bash
node tools/validate-content.mjs --stats   # cấu trúc: sai là FAIL, phải sạch trước khi push
node tools/audit-content.mjs              # biên tập: parity EN/VI + độ phủ ví dụ
node tools/audit-content.mjs --stale      # kiến thức nào gắn version/năm → cần review
node tools/audit-content.mjs --gaps       # mục nào dài mà chưa có ví dụ minh hoạ
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

Liệt kê mọi mục có gắn số version hoặc năm (hiện tại: 43/324 mục). Đây là
phần rữa trước nhất. Với mỗi mục, tự hỏi:

- Version nêu ra còn là bản người ta thật sự dùng không? (`Spring Boot 3.2`
  viết năm 2025 — 2026 đã khác chưa?)
- Tính năng "preview/incubator" đã final chưa? (`ScopedValue` từng là
  preview, Java 25 đã final → câu chữ phải đổi)
- Con số benchmark có còn đúng thế hệ phần cứng/runtime hiện tại không?
- Khuyến nghị đã đảo chiều chưa? (ví dụ OAuth 2.1 yêu cầu PKCE cho **cả**
  web client — trước đó chỉ khuyến nghị cho mobile/SPA)

### 1.2 Có chỗ nào nói mà không cho thấy không?

```bash
node tools/audit-content.mjs --gaps
```

Sắp xếp theo độ dài giảm dần: mục **càng dài mà càng không có code** thì
càng đáng nghi — giải thích nhiều bằng lời nhưng người đọc chưa nhìn thấy
thứ thật.

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

`difficulty`: `core` (ESSENTIAL) · `hard` (ADVANCED) · `ext` (EXTRA) —
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

Ba chế độ đặt block:

| mode | Chèn vào đâu |
|---|---|
| `deep` | cuối khối `:::deep` — **chọn mặc định** cho chi tiết senior |
| `body` | cuối phần thân, **trước** callout đầu tiên |
| `end` | cuối câu trả lời, sau mọi callout |

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

---

## 5. Kiểm chứng trước khi push

Chạy đủ, theo thứ tự:

```bash
# 1. cấu trúc — phải OK
node tools/validate-content.mjs --stats

# 2. biên tập — parity EN/VI phải "no drift"
node tools/audit-content.mjs

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
| Mỗi ~6 tháng | `--stale` toàn bộ, soát lại benchmark và khuyến nghị bảo mật |
| Sau phỏng vấn thật | ghi câu hỏi chưa trả lời tốt → thành mục mới hoặc bồi mục cũ |

Khi cập nhật một sự thật đã đổi: **sửa nội dung, giữ nguyên `id`**. Nếu
điều cũ vẫn đáng biết (vì hệ thống production còn chạy bản cũ), giữ lại và
ghi rõ mốc — "trước Java 21 thì …, từ 21 trở đi …" có giá trị hơn là xoá
sạch dấu vết.

---

## 7. Checklist rút gọn

- [ ] Đã `grep` xem khái niệm này viết ở đâu chưa → trùng thì cross-ref
- [ ] `id` không đổi, chỉ thêm vào cuối
- [ ] `<` viết thành `&lt;`, kể cả trong inline code
- [ ] Không có dòng trắng trong `<pre>`/`<table>`/`<figure>`
- [ ] `:::tip`/`:::warn` chỉ chứa một đoạn văn
- [ ] SVG marker id đặt theo id mục
- [ ] **Đã sửa cả `.json` và `.vi.json`**
- [ ] `validate-content.mjs` OK · `audit-content.mjs` no drift
- [ ] Test pass · không có `console.*`
- [ ] Đã mở trang bấm thử EN/VI
