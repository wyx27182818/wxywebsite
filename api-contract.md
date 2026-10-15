# 艺账 · 接口契约（api-contract.md）

> Day 15 产物 · 最后更新：2026-10-15（Day 18 更新）
>
> 这份文档是**前端和后端之间的约定书**：前端照它写请求，后端照它写返回。
> 以后每加一个接口，就在这里加一节——两边的写法才不会各走各的。

---

## 1. 两端地址（先认门）

| 角色 | 地址 | 说明 |
|------|------|------|
| **前端页面**（静态托管） | `https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.tcloudbaseapp.com/` | 手机能打开的这个 |
| **后端接口**（云函数网关） | `https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com` | 所有接口都挂在它后面；业务接口统一走 `/api/*` |
| 云开发环境 ID | `e27182818wxy-d1gadlaz7c3b34f5a` | 区域 ap-shanghai |
| 数据库（PostgreSQL） | 库名 `postgres-ko5pvt42`，schema `public` | 见 §3，用 CLI 或控制台执行 SQL |
| 承载**业务接口**的云函数 | `yizhang-api` | Day 17 新建。一个函数处理多个路径：`/api/health`、`/api/categories`、`/api/entries`（GET + POST） |
| 承载**旧健康检查**的云函数 | `http-nodejs-helloworld-evdn` | Day 15 用模板建的，现在只挂着 `/e27182818wxy` 一个路径 |

⚠️ 两个域名不是一回事：`tcloudbaseapp.com` 是**前端页面**，`ap-shanghai.app.tcloudbase.com` 是**后端接口**。别互相填错。

⚠️ **同一域名下，路径不同、指向的函数也不同**（2026-10-15 踩坑，务必记牢）：

| 路径 | 指向的函数 | 说明 |
|------|-----------|------|
| `/api/*` | `yizhang-api` | **业务接口全在这里** |
| `/e27182818wxy` | `http-nodejs-helloworld-evdn` | Day 15 的模板函数，只返回 `version: v0.1` 的平铺 JSON |

排查时如果打到 `/e27182818wxy`，会拿到模板函数的老响应（`v0.1`、没有 `dbMode`/`auth` 字段），很容易误判成「新代码没生效」。**认准 `/api` 前缀。** 用 `tcb routes list` 可查当前路由指向。

---

## 2. 接口清单

> **统一形状**：业务接口都在网关的 `/api` 前缀下，全部由同一个云函数 `yizhang-api` 处理；
> 响应一律是 `{ ok, data, error }` 三段式（详见 §4.3）。
> 云函数内部怎么按路径分派，见 §2.6。
>
> **当前 4 个接口**（截至 Day 18）：

| 接口 | 方法 | 作用 | 状态 |
|------|------|------|------|
| `/api/health` | GET | 后端存活检查（含鉴权状态） | ✅ |
| `/api/categories` | GET | 读分类树 | ✅ |
| `/api/entries` | GET | 读账目列表（支持日期区间） | ✅ |
| `/api/entries` | POST | 新增一笔账 | ✅ |

### 2.1 健康检查 `GET /api/health`

- **状态**：✅ 已实现（2026-10-15 实测 HTTP 200，版本 `v0.5`）
- **完整地址**：`https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/api/health`
- **方法**：GET
- **认证**：无
- **请求参数**：无
- **作用**：只回答一句话——"后端活着"。不碰数据库。

**成功响应**（HTTP 200）

```json
{
  "ok": true,
  "data": {
    "service": "yizhang-api",
    "version": "v0.5",
    "env": "e27182818wxy-d1gadlaz7c3b34f5a",
    "time": "2026-10-15T11:00:32.195Z",
    "timeCN": "2026/10/15 19:00:32",
    "method": "GET",
    "path": "/api/health",
    "dbMode": "cloudbase-rdb/public",
    "auth": "api_key"
  },
  "error": null
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | boolean | 恒为 `true`，表示这次调用成功 |
| `data.service` | string | 服务名，固定 `yizhang-api` |
| `data.version` | string | 接口版本，当前 `v0.5` |
| `data.env` | string | 云开发环境 ID，用来确认响应确实来自我们的环境 |
| `data.time` | string | 服务器时间，ISO 8601（UTC） |
| `data.timeCN` | string | 同一时间的北京时间可读格式 |
| `data.method` | string | 本次请求用的方法 |
| `data.path` | string | 网关透传进来的原始路径 |
| `data.dbMode` | string | 数据来源说明，当前 `cloudbase-rdb/public`（不查库，仅标示用） |
| `data.auth` | string | 鉴权状态：配好凭证时是 `api_key`；没配则是 `anon(未配 CLOUDBASE_APIKEY)`。**只报状态，不回显密钥** |

---

### 2.2 分类列表 `GET /api/categories`

- **状态**：✅ 已实现（2026-10-14 实测 HTTP 200，返回 6 条）
- **读哪张表**：`categories`（**核心表**，基本只读的分类字典）
- **作用**：给前端渲染分类树用。返回**扁平列表**，靠 `parentId` 自己拼层级（和前端现在存的方式一致）。
- **请求参数**：无

**成功响应**（HTTP 200，实测原文）

```json
{
  "ok": true,
  "data": [
    { "id": 1, "parentId": null, "name": "未分类", "path": "未分类", "sortNo": 0 },
    { "id": 2, "parentId": null, "name": "餐饮", "path": "餐饮", "sortNo": 10 },
    { "id": 3, "parentId": 2, "name": "水果", "path": "餐饮/水果", "sortNo": 10 },
    { "id": 4, "parentId": 2, "name": "饮品", "path": "餐饮/饮品", "sortNo": 20 },
    { "id": 5, "parentId": null, "name": "交通", "path": "交通", "sortNo": 20 },
    { "id": 6, "parentId": null, "name": "日用", "path": "日用", "sortNo": 30 }
  ],
  "error": null
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `id` | number | 分类 ID |
| `parentId` | number \| null | 父分类 ID；`null` = 顶级分类 |
| `name` | string | 本级名称（如「水果」） |
| `path` | string | 完整路径（如「餐饮/水果」），和前端存法一致 |
| `sortNo` | number | 同级排序号，越小越靠前（已按它排好序） |

---

### 2.3 账目列表 `GET /api/entries`

- **状态**：✅ 已实现（2026-10-14 实测 HTTP 200，返回 8 条）
- **读哪张表**：`entries`（**记录表**，持续增长）+ 关联的 `categories`、`shots`
- **作用**：账目流水。每笔自带分类路径和截图数组，按日期倒序（新的在前）。

**请求参数**（全部可选）

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `from` | string | 无 | 起始日期，`YYYY-MM-DD`（含当天） |
| `to` | string | 无 | 结束日期，`YYYY-MM-DD`（含当天） |
| `limit` | number | 50 | 每页条数，超出范围会被夹到 1–200 |
| `offset` | number | 0 | 跳过前几条（翻页用） |

例：`/api/entries?from=2026-09-12&to=2026-09-15&limit=20`

**成功响应**（HTTP 200，实测原文，此处截 2 条示例）

```json
{
  "ok": true,
  "data": [
    {
      "id": 8,
      "category": "餐饮/水果",
      "date": "2026-09-18",
      "item": "香蕉",
      "amount": 9.9,
      "shots": []
    },
    {
      "id": 1,
      "category": "餐饮/水果",
      "date": "2026-09-12",
      "item": "苹果",
      "amount": 26.8,
      "shots": [
        { "seq": 1, "path": "shots/2026-09-12/entry-1-1.png" },
        { "seq": 2, "path": "shots/2026-09-12/entry-1-2.png" }
      ]
    }
  ],
  "error": null
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `id` | number | 账目 ID |
| `category` | string | 分类完整路径；**未归类时固定为字符串 `未分类`**（不会返回 null 或对象） |
| `date` | string | 花销日期 `YYYY-MM-DD` |
| `item` | string | 物资名 |
| `amount` | number | 金额（元，两位小数） |
| `shots` | array | 截图数组，按 `seq` 升序（拼图顺序）；没传截图就是 `[]` |
| `shots[].seq` | number | 第几张，从 1 开始 |
| `shots[].path` | string | 图片在云存储中的相对路径 |

**参数写错时**（HTTP 400）

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_PARAM",
    "message": "参数 from 要是 YYYY-MM-DD 格式，收到的是 \"2026/09/12\""
  }
}
```

---

### 2.4 新增一笔账 `POST /api/entries`

- **状态**：✅ 已实现（2026-10-15 实测 HTTP 200 / 409 / 400 三种情况全过）
- **完整地址**：`https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/api/entries`
- **方法**：POST
- **认证**：无（前端侧）；云函数访库靠服务端凭证 `api_key`，见 §4.9
- **请求头**：`Content-Type: application/json`
- **请求体大小上限**：64 KB（超了返回 400 `INVALID_BODY`）

**请求体字段**

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `date` | ✅ | string | 花销日期，格式 `YYYY-MM-DD`，**必须是真实存在的日期**（`2026-02-31` 会被拦下） |
| `item` | ✅ | string | 买了什么，最长 100 字 |
| `amount` | ✅ | number | 金额（元），≥ 0，最多两位小数（会自动四舍五入到两位） |
| `category` | ❌ | string | 分类完整路径（如 `餐饮/水果`）。**留空 = 未分类**；填了就必须能在 `categories` 里查到 |

**请求示例**

```bash
curl -X POST ".../api/entries" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-10-15","category":"餐饮","item":"麻辣烫","amount":26.8}'
```

**成功响应**（HTTP 200）

```json
{
  "ok": true,
  "data": {
    "id": 10,
    "category": "餐饮",
    "date": "2026-10-15",
    "item": "麻辣烫",
    "amount": 26.8,
    "shots": []
  },
  "error": null
}
```

> **返回形状和 `GET /api/entries` 的单条完全一致**——前端可以用同一套渲染逻辑，不用为"新增返回"另写一份。
> 新记录还没截图，所以 `shots` 固定是 `[]`。

**三种失败情况**

| 情况 | HTTP | `error.code` | 响应示例 |
|------|------|--------------|----------|
| 缺必填 / 格式不对 | 400 | `INVALID_BODY` | `"参数有问题——缺 date（花销日期，格式 YYYY-MM-DD，比如 2026-09-20）；缺 amount（金额，单位元，比如 26.8）"` |
| 分类在库里不存在 | 400 | `CATEGORY_NOT_FOUND` | `"分类 \"餐饮/水果\" 在库里不存在——先 GET /api/categories 看有哪些分类"` |
| 同一天同分类同物资已记过 | 409 | `DUPLICATE` | `"这一天（2026-10-15）已经记过「麻辣烫」（分类：餐饮）了，不重复记。如果确实是另一笔，把 item 写得更具体些（比如「苹果（下午）」）再提交"` |

**三条实现约定**（做校验时的取舍，写下来免得以后忘）

1. **一次报全部问题**：必填和格式一次性查完再返回，不是"报一个、改一个、再报下一个"。
2. **防重复的判据是「三件齐同」**：`date` + `category` + `item` 三个都一样才算重复。
   - `category` 留空时按「`category_id IS NULL`」比对，不是拿空字符串去比。
   - 判重范围是**全库**（不限当天录入的那一批）。
   - 想记同一天同分类的第二笔同类开销，把 `item` 写具体些区分开即可。
3. **分类留空存 NULL**，不存空字符串——和读取接口把 NULL 显示成 `未分类` 保持一致。

---

### 2.5 错误码一览

| HTTP | `error.code` | 什么时候出现 |
|------|--------------|--------------|
| 400 | `INVALID_PARAM` | 查询参数问题（如日期格式不对） |
| 400 | `INVALID_BODY` | 写入的请求体有问题：缺必填字段、格式不对、请求体不是合法 JSON、超过 64KB |
| 400 | `CATEGORY_NOT_FOUND` | 写入时指定的分类在 `categories` 里查不到 |
| 409 | `DUPLICATE` | 写入的这笔（同日期 + 同分类 + 同物资）已经存在 |
| 404 | `NOT_FOUND` | 路径不存在（函数收到了，但没有这个接口） |
| 405 | `METHOD_NOT_ALLOWED` | 用了接口不支持的方法 |
| 502 | `DB_QUERY_FAILED` | 数据库查询本身出错 |
| 503 | `DB_NOT_AVAILABLE` | 拿不到数据库身份（本地跑、或环境变量缺失） |
| 500 | `INTERNAL_ERROR` | 其他没预料到的错误 |

> **400 和 409 的分界**：400 是"你这次请求本身写得不对"，改请求就能过；409 是"请求没写错，但跟库里已有的撞了"，需要改内容或换个说法。

---

### 2.6 云函数内部怎么区分路径（重要）

网关那条 `/api` 路由**开着了「路径透传」**，所以函数内 `req.url` 拿到的是**完整路径**（如 `/api/entries?limit=5`）。
函数内部把路径归一化后再分派：`/api/entries` 和 `/entries` 都会命中同一个处理逻辑——这样将来路由前缀怎么调都不影响代码。

> 📌 这条是对 Day 15 那份旧契约的**更正**：当时写的是"不能靠函数内部 path 区分路由"，那是在没开路径透传的情况下；
> 现在开了，一个函数处理多个接口成为可能（当前 4 个接口共用一个函数）。
>
> **路径归一化的规则**：`/api` → `/`；`/api/xxx` → `/xxx`；末尾斜杠会被去掉；查询串不参与判断。
> 所以 `/api/entries`、`/entries`、`/api/entries?limit=5` 都会走同一个分支。

---

### 2.7 历史遗留：`GET /e27182818wxy`

Day 15 建的第一个健康检查，走的是**另一个云函数**（`http-nodejs-helloworld-evdn`），响应是**平铺**的、不是三段式：

```json
{
  "ok": true,
  "service": "yizhang-api",
  "version": "v0.1",
  "env": "e27182818wxy-d1gadlaz7c3b34f5a",
  "time": "2026-10-14T11:15:08.347Z",
  "timeCN": "2026/10/14 19:15:08",
  "method": "GET",
  "path": "/"
}
```

保留它只为向后兼容，**新代码一律用 `/api/health`**。

> ⚠️ **2026-10-15 实测踩坑**：这两个路径在**同一个域名**下，但指向**不同的云函数**。
> 排查时误把 `/e27182818wxy` 当业务接口打，拿到的是这里的 `v0.1` 平铺响应（没有 `dbMode`、没有 `auth`），
> 一度误判成"新部署的代码没生效"。**认准 `/api` 前缀**；路由现状用 `tcb routes list` 查。

---

## 3. 数据模型（数据库表）

**数据库类型**：CloudBase 环境**自带的 PostgreSQL 17**（实测 `SELECT version()` = `PostgreSQL 17.11`，无需额外开通、无额外费用）。
> 最初设计时打算用 CloudBase 的 MySQL 型数据库，实测发现环境里 MySQL 需要单独开通、而 PostgreSQL 已经现成可用，因此**改用 PostgreSQL**——三张表的设计完全不变，只是 SQL 写法换成 PostgreSQL 方言。

| 项 | 值 |
|----|----|
| 引擎 | PostgreSQL 17.11 |
| 数据库名 | `postgres-ko5pvt42` |
| 建表位置 | 默认 schema `public` |
| 连接方式 | **云函数内免密**：用 `@cloudbase/node-sdk` 的 `rdb()` 数据网关（云函数环境自带身份，不用配任何密码/IP）；本地/脚本查库用 CloudBase CLI `tcb db execute` |

**建表脚本（唯一实现来源）**：

| 文件 | 作用 |
|------|------|
| `database/schema.sql` | 建三张表（主键 / 外键 / 约束齐全），可重复执行 |
| `database/seed.sql` | 先清空再插入固定示例数据，可重复执行 |

### 3.1 三张表和它们的关系

```
categories（分类） ← entries（账目） ← shots（截图）
   1 个分类下多笔账目        1 笔账目下多张截图
```

**① `categories` 分类**：支持「/」分隔的多级路径（和前端现在的存法一致）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | BIGINT | 主键（IDENTITY 自增） | |
| `parent_id` | BIGINT | 外键 → `categories.id`（自引用），可为空 | 顶级分类为 NULL |
| `name` | VARCHAR(50) | NOT NULL | 本级名称 |
| `full_path` | VARCHAR(255) | NOT NULL + 唯一 | 如 `餐饮/水果` |
| `sort_no` | INTEGER | NOT NULL 默认 0 | 同级排序 |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL | 时间戳 |

**② `entries` 账目**：一笔花销

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | BIGINT | 主键（IDENTITY 自增） | |
| `category_id` | BIGINT | 外键 → `categories.id`，可为空，**删分类置空** | 删分类不删账，账目退回"未分类" |
| `spent_on` | DATE | NOT NULL + 索引 | 花销日期 |
| `item` | VARCHAR(100) | NOT NULL | 物资名 |
| `amount` | NUMERIC(10,2) | NOT NULL + CHECK ≥ 0 | **金额：元，两位小数** |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL | 时间戳 |

**③ `shots` 截图**：每笔账目下的支付截图

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | BIGINT | 主键（IDENTITY 自增） | |
| `entry_id` | BIGINT | 外键 → `entries.id`，NOT NULL，**删账目级联删截图** | |
| `seq` | INTEGER | NOT NULL 默认 1，与 `entry_id` 组成唯一键 | 同一笔内的第几张（拼图顺序） |
| `file_path` | VARCHAR(255) | NOT NULL | 图片在云存储的相对路径 |
| `width` / `height` | INTEGER | 可为空 | 像素尺寸（拼图排版用） |
| `created_at` | TIMESTAMPTZ | NOT NULL | 时间戳 |

### 3.2 数据库字段 ↔ 接口 JSON 字段的对应

接口对外用**前端现有的字段名**，这样前端接接口时改动最小：

| 数据库 | 接口 JSON | 格式 / 说明 |
|--------|-----------|------------|
| `entries.id` | `id` | 数字 |
| `categories.full_path` | `category` | 字符串，如 `餐饮/水果`；未分类时为 `未分类` |
| `entries.spent_on` | `date` | 字符串 `YYYY-MM-DD` |
| `entries.item` | `item` | 字符串 |
| `entries.amount` | `amount` | 数字，单位元（两位小数） |
| `shots`（多条，按 `seq` 排序） | `shots` | 数组 `[{ "seq": 1, "path": "..." }]` |
| `categories.id / parent_id / name / sort_no` | `id / parentId / name / sortNo` | 见 §2.2 |

### 3.3 四条设计规则（改动数据库时要遵守）

1. **删分类不删账目**：`entries.category_id` 置空，前端显示为「未分类」。
2. **删账目连带删截图**：截图不能脱离账目独立存在。
3. **金额一律用 NUMERIC(10,2) 存"元"**，不用浮点数、不用分——保证合计不出小数误差。
4. **`updated_at` 由后端接口在 UPDATE 时显式写入**——PostgreSQL 没有 MySQL 的 `ON UPDATE CURRENT_TIMESTAMP`，所以这条交给代码负责（写增删改接口时实现）。

### 3.4 怎么在库里执行这些脚本

**方式一：命令行（推荐，已配好）**

```bash
tcb db execute --sql "SELECT COUNT(*) FROM entries" -e e27182818wxy-d1gadlaz7c3b34f5a
```

**方式二：控制台** — 「数据库」→ SQL 执行入口里粘贴 `database/schema.sql`、`database/seed.sql` 的内容。

**当前库中已有数据**（2026-10-14 实测）：`categories` 6 条 / `entries` 8 条 / `shots` 6 条；9/12–9/15 合计 = **128.30**。

---

## 4. 通用约定（以后写新接口都按这个来）

1. **路径规范**：业务接口统一 `/api/xxx`（如 `/api/entries`）；`/e27182818wxy` 是历史遗留。
2. **方法语义**：`GET` 读取 · `POST` 新增 · `PUT/PATCH` 修改 · `DELETE` 删除。
3. **返回结构（统一三段式）**：
   - 成功 → `{"ok": true, "data": <数据>, "error": null}`，HTTP 200
   - 失败 → `{"ok": false, "data": null, "error": {"code": "错误码", "message": "人话解释"}}`，HTTP 为对应状态码
   - 错误码见 §2.5；`error` 里可能还有可选的 `detail` 字段带更细的原始信息
4. **时间**：同时给两个字段——`time` 用 ISO 8601，`timeCN` 用北京时间可读串。
5. **金额单位**：**元，两位小数**（数据库用 `NUMERIC(10,2)`）——Day 16 已定案。
6. **版本号**：`version` 字段，出现不兼容改动时递增。
7. **参数校验**：脏参数在函数里先拦下（如日期格式），返回 400，不丢给数据库去报错。
8. **SQL 注入防护**：查询条件全部走 SDK 的构建器方法（`.gte()` / `.lte()` / `.range()`），等价于参数化查询，不做字符串拼接。
9. **认证方式（2026-10-15 定案）**：
   - **前端 → 接口**：目前**无认证**（谁都能调）。等以后加用户体系再补。
   - **云函数 → 数据库**：用**服务端管理员凭证 `api_key`**，存在云函数环境变量 `CLOUDBASE_APIKEY` 里。
     凭证本身**不进代码、不进仓库**（`cloudbaserc.json` 已被 `.gitignore` 排除）。
   - **为什么需要它**：CloudBase 的 **Web（HTTP）云函数不注入登录身份**（官方设计，只有事件函数才注入）。
     不配的话 SDK 会退化成匿名（`anon`）角色，而 `anon` 对业务表**只有 SELECT 权限**——
     表现就是"读得到、写不了"，报 `permission denied for table entries`（错误码 42501）。
   - **别用临时密钥**：不要从环境变量读 `TENCENTCLOUD_SECRETID/SECRETKEY` 固化进 `init` 配置——
     SCF 里那是会过期的临时密钥，固化后长驻实例会突然失效。
   - **验证方法**：`GET /api/health` 的 `data.auth` 字段会告诉你当前是 `api_key` 还是 `anon`。
   - **管理入口**：`tcb env apikey create <名字> --type api_key -e <envId>`，或控制台「环境 → API Key 配置」。
10. **跨域（重要，还没做）**：控制台里那条路由的"跨域"开关显示**已开启**，但实测响应头里**没有** `Access-Control-Allow-Origin`，`OPTIONS` 预检返回 405。
    也就是说，**前端页面现在还不能直接调这些接口**（浏览器会拦），这是后面要配的东西。今天清单也明确不做跨域。
11. **浏览器直接打开接口会变成下载**：网关会把响应的 `Content-Disposition` 统一改写成 `attachment`（函数里设 `inline` 也会被覆盖，已实测）。
    想在页面上看 JSON，用 curl，或开开发者工具的 Network 面板。
12. **代码分层（2026-10-15 定案）**：云函数按四层组织，依赖方向是单行道。详见 §4.10。

### 4.10 后端代码分层（2026-10-15 重构后）

`cloudfunctions/yizhang-api/` 目录结构：

```
yizhang-api/
├── index.js                     入口，17 行，只有 require("./app")
├── app.js                       HTTP 层：路由分派 / 响应 / 兜错
├── services/
│   └── yizhangService.js        业务层：校验规则与业务判断
├── repositories/
│   ├── entriesRepository.js     entries 表的全部查询
│   └── categoriesRepository.js  categories 表的全部查询
└── db/
    └── client.js                数据访问层：连接与鉴权
```

**每层只管一件事**：

| 层 | 文件 | 只负责 | 不负责 |
|----|------|--------|--------|
| 入口 | `index.js` | 启动 | 任何逻辑 |
| HTTP 层 | `app.js` | 接请求、分路由、返响应、兜错 | 业务判断、SQL |
| 业务层 | `services/yizhangService.js` | 参数校验、业务规则（防重复等） | HTTP 细节、SQL |
| 仓库层 | `repositories/*.js` | 全部数据库查询，**一张表一个文件** | 业务判断、HTTP |
| 数据访问层 | `db/client.js` | 数据库连接与鉴权、结果解包 | 任何业务逻辑 |

**两条硬规则**：

1. **依赖方向单行道**：`index → app → service → repository → client`。上层可以调下层，**下层绝不回头调上层**。
2. **各自唯一出口**：`db/client.js` 是唯一碰数据库连接的地方；`repositories/` 是唯一写查询的地方。`app.js` 里不该出现任何 `.from(...)` 或 SQL 片段。

**加一个新接口要改哪三个文件**（以「删除一笔」为例）：

1. `app.js` —— 路由表加一条，把 `DELETE /api/entries/:id` 分派给 service；
2. `services/yizhangService.js` —— 加 `deleteEntry(id)`，做参数校验与业务判断；
3. `repositories/entriesRepository.js` —— 加 `remove(id)`，写这条 SQL。

**为什么这么拆**：换数据库只动 `client.js` 和 repositories；加接口三处各补一小块，互不干扰。重构前是单文件 498 行，所有事混在一起。

**现状**：2026-10-15 完成重构，**未新增任何功能**，四个接口行为与响应形状完全不变（已逐个回归验证，见 §7）。

---

## 5. 怎么验证接口还活着

命令行（Windows 的 Git Bash / PowerShell 都行）：

```bash
BASE="https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/api"

# 健康检查（看 auth 是不是 api_key）
curl "$BASE/health"

# 分类列表
curl "$BASE/categories"

# 账目列表（只取 9/12–9/15）
curl "$BASE/entries?from=2026-09-12&to=2026-09-15"
```

期望：`HTTP/1.1 200` + `content-type: application/json` + `ok: true` 的 JSON。

**验证"数据真的来自数据库"**：改一条库里的数据，再调接口看它跟着变。

```bash
tcb db execute --sql "UPDATE entries SET item='香蕉（改过）' WHERE id=8" -e e27182818wxy-d1gadlaz7c3b34f5a
curl "$BASE/entries?limit=1"     # 立刻能看到 item 变成「香蕉（改过）」
```

**验证写入接口**（三条一起跑，覆盖正常 / 重复 / 缺字段）：

```bash
# ① 正常写入 → 200，返回新记录的 id
curl -X POST "$BASE/entries" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-15","category":"餐饮","item":"测试-麻辣烫","amount":26.8}'

# ② 原样再发一次 → 409 DUPLICATE
curl -X POST "$BASE/entries" -H "Content-Type: application/json" \
  -d '{"date":"2026-10-15","category":"餐饮","item":"测试-麻辣烫","amount":26.8}'

# ③ 只给 item → 400 INVALID_BODY，一次报出缺 date 和缺 amount
curl -X POST "$BASE/entries" -H "Content-Type: application/json" \
  -d '{"item":"只有名字"}'

# ④ 回归：确认刚写的能读出来
curl "$BASE/entries?from=2026-10-15&to=2026-10-15"

# ⑤ 测试完把这条测试数据删掉，保持库干净
tcb db execute --sql "DELETE FROM entries WHERE item='测试-麻辣烫' AND spent_on=DATE '2026-10-15'" -e e27182818wxy-d1gadlaz7c3b34f5a
```

---

## 6. 后续计划（会往这里加）

| 接口 / 事项 | 用途 | 状态 |
|-------------|------|------|
| 数据库表设计（categories / entries / shots） | 数据落到云上 | ✅ 已完成（Day 16） |
| `GET /api/categories` | 读分类树 | ✅ 已完成（Day 17） |
| `GET /api/entries` | 拉取账目列表 | ✅ 已完成（Day 17） |
| `POST /api/entries` | 新增一笔账 | ✅ 已完成（Day 18） |
| 服务端凭证 `api_key` | 让云函数有写库权限 | ✅ 已完成（Day 18） |
| `PUT /api/entries/:id` | 修改一笔 | 未开始 |
| `DELETE /api/entries/:id` | 删除一笔 | 未开始 |
| 跨域配置 | 让前端页面能直连接口 | 未开始 |
| 截图存储（云存储） | 多设备共用截图 | 未开始 |

---

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-14 | 首版：环境开通、健康检查接口上线（HTTP 200 实测通过）、前端页面静态托管上线，两端地址确定 |
| 2026-10-14 | Day 16：补充「数据模型」一节（categories / entries / shots 三张表）；金额单位定案为「元，NUMERIC(10,2)」；新增 `database/schema.sql`、`database/seed.sql`，**已在云库实际执行并验证** |
| 2026-10-14 | Day 16 修订：数据库引擎由「MySQL 型」改为环境**自带的 PostgreSQL 17**（免开通、零额外费用），脚本改 PostgreSQL 方言，表设计不变 |
| 2026-10-14 | Day 17：新增云函数 `yizhang-api`，实现 `GET /api/categories`、`GET /api/entries` 两个读取接口（均实测 HTTP 200）；**统一返回改为 `{ ok, data, error }` 三段式**（§4.3 已改）；新增错误码表；更正「函数内可以靠路径区分路由」（路径透传已开启）；补充跨域现状（仍不可直连）与 `Content-Disposition` 被网关改写两条实测结论 |
| 2026-10-15 | Day 18：实现 `POST /api/entries` 写入接口（新增 §2.4），**实测三种情况全过**——正常写入 200 / 重复 409 `DUPLICATE` / 缺字段 400 `INVALID_BODY`，并回归验证新写入的数据可被 `GET /api/entries` 读出；错误码表补 3 条（`INVALID_BODY`、`CATEGORY_NOT_FOUND`、`DUPLICATE`）；**§4.9 认证方式定案**——云函数访库改用服务端凭证 `api_key`（环境变量 `CLOUDBASE_APIKEY`），根治 Web 云函数退化成 `anon` 角色导致的 42501 写入拒绝；§2.1 health 响应新增 `data.auth` 字段（版本升 `v0.5`）；**§1 新增路由指向说明**（`/api/*` → `yizhang-api`，`/e27182818wxy` → 模板函数，排查时勿混淆）；§5 补写入接口的完整验证命令 |
| 2026-10-15 | Day 18：**后端分层重构**（新增 §4.10）——云函数 `yizhang-api` 从单文件（`index.js` 498 行）拆为四层：`index.js`（入口）/ `app.js`（HTTP 层）/ `services/yizhangService.js`（业务层）/ `repositories/*.js`（仓库层，一张表一个文件）/ `db/client.js`（数据访问层）。**只搬代码、未新增任何功能**；四个接口（3 个 GET + 1 个 POST 的三种情况）已逐个回归，响应形状与状态码与重构前完全一致，三表数据量复核 8/6/6。§4 通用约定新增第 12 条指向本节 |
