# Cải thiện dữ liệu `content.json` — đã làm & việc còn lại

Ghi ngày **2026-07-31**. Ba việc trong bản TODO trước đã làm xong.

| | Trước | Sau |
|---|---|---|
| Cross-ref (trỏ đúng mục có thật) | 70 | **141** |
| — trong đó ở chủ đề 1–16 | ~4 | **91** |
| Mục mỏng dưới 800 ký tự | 24 | **0** |
| Độ dài trả lời: median · min | 1118 · 644 | **1228 · 801** |
| Mục có code block | 57 | **69** |
| — trong đó nhóm `core` | 0 | **12** |
| Mục có bảng | 57 | 62 |

Số mục và số chủ đề không đổi: **24 chủ đề · 282 mục · 28 sơ đồ SVG**. Không
mục nào bị đánh số lại.

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

## Đã làm gì

### 1. Nối mạng chủ đề cũ với chủ đề mới

Thêm 71 cross-ref, gần như toàn bộ nằm ở chủ đề 1–16 (phần viết trước, vốn
gần như không trỏ đi đâu). Mỗi ref là **một dòng thêm vào khối `:::deep`** của
mục cũ, không viết lại nội dung — cú pháp là id trong ngoặc đơn, ví dụ
`... 4 điều kiện Coffman (23.3).`

Các cụm đã nối:

- **Concurrency** — `1.1`→23.7 · `1.6`→23.8 · `1.7`→23.6, 23.8 · `1.8`→22.7 ·
  `1.9`→23.1, 23.4 · `15.7`→23.5, 23.8
- **Database** — `5.9`→24.6 · `5.10`→23.3 · `5.11`→18.2 · `5.12`→18.1, 18.5,
  18.6, 18.7 · `6.9`→18.8, 12.16 · `7.9`→22.8 · `10.13`→6.2, 10.3
- **API & kiến trúc** — `4.1`→17.1, 17.2 · `4.4`→17.8 · `4.5`→18.6 ·
  `4.11`→17.8, 24.3 · `12.1`–`12.4`→12.15, 12.18, 12.19, 12.20, 12.21 ·
  `12.5`–`12.8`→24.1, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8 · `12.11`→24.1, 24.8 ·
  `12.13`→12.22 · `12.14`→24.3
- **System design & vận hành** — `8.10`, `8.11`, `9.3`→24.7 · `10.6`, `10.8`,
  `10.9`, `10.7`, `11.5`, `16.11`→22.3 · `10.10`→17.6 · `10.14`→21.1, 21.5,
  21.7 · `11.1`→22.1 · `11.7`→22.2, 22.8 · `13.6`→20.8 · `14.4`, `14.6`→21.4 ·
  `14.10`→20.3, 20.4, 20.5, 20.8 · `16.2`→24.6, 12.19 · `16.12`, `16.13`→19.1

### 2. Bồi 24 mục mỏng

Không mục nào còn dưới 800 ký tự (ngắn nhất toàn site giờ là `6.2` với 801 —
mục này chưa bao giờ nằm trong danh sách mỏng). Cách bồi, đúng một thứ mỗi mục:

- **Bảng so sánh** — `1.18` (3 loại Set), `4.3` (4 kiểu streaming), `4.6`
  (REST vs GraphQL), `8.7` (Kafka vs RabbitMQ), `12.12` (4 kiểu coupling)
- **Con số thật** — `10.2` (bộ số back-of-envelope), `10.13` (mốc để biết đang
  ở bước nào), `11.3` (ước lượng URL shortener), `11.5` (chi phí một lời gọi
  Redis mỗi request)
- **Bẫy phỏng vấn trong `:::warn`** — `2.7`, `3.6`, `5.12`, `8.8`, `12.14`
- **Trỏ sang chỗ đã viết kỹ** thay vì viết lại — `2.2`, `2.3`, `4.11`, `5.12`,
  `10.5`, `10.7`, `10.10`, `10.14`, `12.1`, `13.6`, `14.10`

### 3. Code block cho nhóm `core`

Nhóm `core` từ 0 lên 12 mục có code:

| Mục | Code đã thêm |
|---|---|
| `1.1` | 2 thread + `stop`, thiếu `volatile` thì vòng lặp không thoát và `data` in ra 0 |
| `1.8` | `containsKey`+`put` thua `computeIfAbsent` |
| `1.9` | `synchronized` / `ReentrantLock.tryLock` / `StampedLock` optimistic read cạnh nhau |
| `1.11` | id do DB sinh → `hashCode` đổi → phần tử kẹt trong `HashSet` |
| `1.13` | wrap exception giữ `cause`, kèm `rollbackFor` |
| `1.16` | vòng đời một `put`: spread, bucket, treeify, resize |
| `2.5` | `instanceof` cũ so với pattern matching for switch + virtual thread executor |
| `3.2` | đúng đoạn `this.confirm(id)` mất transaction, và cách tách bean |
| `3.3` | 3 propagation lồng nhau + kết quả rollback từng cái |
| `3.4` | `private`/`final` im lặng không được advise, kèm subclass CGLIB sinh ra |
| `3.15` | hook nào ở giai đoạn nào, và vì sao `@PostConstruct` chưa có proxy |
| `15.8` | cùng một server viết bằng blocking socket và bằng `Selector` |

---

## Việc còn để ngỏ

- **Nhóm `data` mới có 6/52 mục có code.** Ứng viên rõ nhất: `5.4`
  (leftmost-prefix bằng vài câu `EXPLAIN`), `5.5` (các trường hợp index không
  được dùng), `6.9` (`JOIN FETCH` so với `@EntityGraph`), `7.9` (`SET NX PX`
  cho seat-hold).
- **Chủ đề 17–24 gần như chưa trỏ ngược về 1–16.** Giờ đã cân về mặt tổng số
  (91 so với 50) nhưng chiều ngược lại vẫn thưa ở vài chỗ, ví dụ chủ đề 19 và
  21 hầu như không nhắc lại phần nền tương ứng.
- **`6.2`, `5.4`, `2.13`, `7.3`, `5.6`, `11.6`** nằm trong khoảng 801–815 ký
  tự — chưa phải mỏng nhưng là nhóm sát ngưỡng, đáng bồi nếu đụng tới.

---

## Ghi chú cho lần sau

- Cách merge đã dùng lần này: một file text theo định dạng
  `@@ <body|deep|end> <item-id>` rồi tới nội dung literal, và một script đọc
  file đó chèn vào `content.json` (idempotent — chèn lại thì bỏ qua vì nội
  dung đã có). Script nằm ở scratchpad nên **sẽ mất**; cái đáng giữ là
  `tools/validate-content.mjs`, đã ở trong repo.
  - `body` chèn vào cuối phần thân, **trước** khối `:::` đầu tiên
  - `deep` chèn vào cuối khối `:::deep`
  - `end` chèn vào cuối câu trả lời
- **`:::tip` và `:::warn` chỉ nhận một đoạn văn.** `renderMarkdown` nối mọi
  dòng bên trong bằng dấu cách rồi chạy `inlineMd` — danh sách, bảng, `<pre>`
  đặt trong đó sẽ bẹp thành một dòng. Chỉ `:::deep` mới đệ quy render đầy đủ.
- Cú pháp code block (sai là vỡ trang, validator bắt được cả ba lỗi):

```html
<pre><code><span class="k">public</span> <span class="k">void</span> <span class="f">demo</span>() {
    <span class="c">// chú thích</span>
    <span class="k">int</span> x = <span class="n">1</span>;
    String s = <span class="s">"chuỗi"</span>;
}</code></pre>
```

  Bảng màu: `.k` từ khoá · `.s` chuỗi · `.c` chú thích · `.n` số · `.f` tên
  hàm · `.r` nhấn đỏ (dùng cho dòng "đây là chỗ sai").

  1. **Dòng trắng trong `<pre>`** làm đứt khối HTML. Cần ngăn cách thì dùng
     một dòng `<span class="c">    </span>` — đó là cách các block hiện có đang
     làm.
  2. **`<` và `&` phải escape**: `Map&lt;String,Integer&gt;`, `h &amp; (n-1)`,
     `() -&gt; {}`. Kể cả trong `` `inline code` `` ngoài khối `<pre>`.
  3. **Dòng bắt đầu bằng `<`** mở một khối raw HTML mới — chú ý khi xuống dòng.
- Nếu thêm sơ đồ SVG: đặt trong `<figure class='dgm'>`, dùng đúng bảng màu ở
  `:root` của `styles.css`, và **marker id phải độc nhất toàn file** — đặt tên
  theo id mục (`ar6_165`) chứ đừng đánh số tăng dần.
