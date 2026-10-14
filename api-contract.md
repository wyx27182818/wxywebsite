# 艺账 · 接口契约（api-contract.md）

> Day 15 产物 · 最后更新：2026-10-14
>
> 这份文档是**前端和后端之间的约定书**：前端照它写请求，后端照它写返回。
> 以后每加一个接口，就在这里加一节——两边的写法才不会各走各的。

---

## 1. 两端地址（先认门）

| 角色 | 地址 | 说明 |
|------|------|------|
| **前端页面**（静态托管） | `https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.tcloudbaseapp.com/` | 手机能打开的这个 |
| **后端接口**（云函数网关） | `https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com` | 所有接口都挂在它后面 |
| 云开发环境 ID | `e27182818wxy-d1gadlaz7c3b34f5a` | 区域 ap-shanghai |
| 数据库（PostgreSQL） | 库名 `postgres-ko5pvt42`，schema `public` | 见 §3，用 CLI 或控制台执行 SQL |
| 承载接口的云函数 | `http-nodejs-helloworld-evdn` | 由 HTTP 云函数模板创建 |

⚠️ 两个域名不是一回事：`tcloudbaseapp.com` 是**前端页面**，`ap-shanghai.app.tcloudbase.com` 是**后端接口**。别互相填错。

---

## 2. 接口清单

### 2.1 健康检查 `GET /e27182818wxy`

- **状态**：已上线（2026-10-14 实测 HTTP 200）
- **完整地址**：
  `https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/e27182818wxy`
- **方法**：GET
- **认证**：无
- **请求参数**：无
- **作用**：只回答一句话——"后端活着"。没有任何业务逻辑。

**成功响应**（HTTP 200 · `Content-Type: application/json; charset=utf-8`）

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

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | boolean | 恒为 `true`，表示这次调用成功 |
| `service` | string | 服务名，固定 `yizhang-api` |
| `version` | string | 接口版本，当前 `v0.1` |
| `env` | string | 云开发环境 ID，用来确认响应确实来自我们的环境 |
| `time` | string | 服务器时间，ISO 8601（UTC） |
| `timeCN` | string | 同一时间的北京时间可读格式 |
| `method` | string | 本次请求用的方法（GET / POST / OPTIONS…） |
| `path` | string | 云函数内部看到的路径（见下方备注③） |

**失败响应**（路径写错时，HTTP 404）

```json
{
  "code": "INVALID_PATH",
  "message": "Invalid path. For more information, please refer to https://docs.cloudbase.net/error-code/service/INVALID_PATH",
  "requestId": "d7afa6fd-1c07-49b7-ada1-5172d657a867"
}
```

注意：这种 404 是**网关**回的（没找到对应路由），不是云函数回的——所以结构里没有 `ok` 字段，而是网关的 `code/message/requestId` 格式。

#### 关于这个接口的三点备注

① **路径为什么是 `/e27182818wxy` 而不是 `/api/health`**
建路由时"触发路径"填成了环境名。功能完全正常，Joye 决定不再改（"能用就好"）。**后续新接口一律用 `/api/xxx`** 的规范路径，这个保持现状。

② **浏览器打开可能变成下载**
响应头里带 `content-disposition: attachment`，所以浏览器可能直接把 JSON 存成文件而不是显示在页面上。想在页面里看，就打开开发者工具的 Network 面板，或直接用下面的 curl 命令。

③ **云函数内部看到的 `path` 是 `/`**
路由前缀（`/e27182818wxy`）在网关这一层就被去掉了，所以函数里 `req.url` 拿到的是 `/`。**写业务接口时要注意**：不能靠函数内部的 `path` 区分路由，靠的是"不同路径绑不同函数"。

---

## 3. 数据模型（数据库表）

**数据库类型**：CloudBase 环境**自带的 PostgreSQL 17**（实测 `SELECT version()` = `PostgreSQL 17.11`，无需额外开通、无额外费用）。
> 最初设计时打算用 CloudBase 的 MySQL 型数据库，实测发现环境里 MySQL 需要单独开通、而 PostgreSQL 已经现成可用，因此**改用 PostgreSQL**——三张表的设计完全不变，只是 SQL 写法换成 PostgreSQL 方言。

| 项 | 值 |
|----|----|
| 引擎 | PostgreSQL 17.11 |
| 数据库名 | `postgres-ko5pvt42` |
| 建表位置 | 默认 schema `public` |
| 连接方式 | 不暴露 IP/端口；用 CloudBase CLI（`tcb db execute --sql "..." -e <环境ID>`）或控制台「数据库 → SQL 执行」 |

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

### 3.3 四条设计规则（改动数据库时要遵守）

1. **删分类不删账目**：`entries.category_id` 置空，前端显示为「未分类」。
2. **删账目连带删截图**：截图不能脱离账目独立存在。
3. **金额一律用 NUMERIC(10,2) 存"元"**，不用浮点数、不用分——保证合计不出小数误差。
4. **`updated_at` 由后端接口在 UPDATE 时显式写入**——PostgreSQL 没有 MySQL 的 `ON UPDATE CURRENT_TIMESTAMP`，所以这条交给代码负责（Day 17+ 的接口里实现）。

### 3.4 怎么在库里执行这些脚本

**方式一：命令行（推荐，已配好）**

```bash
tcb db execute --sql "SELECT COUNT(*) FROM entries" -e e27182818wxy-d1gadlaz7c3b34f5a
```

**方式二：控制台** — 「数据库」→ SQL 执行入口里粘贴 `database/schema.sql`、`database/seed.sql` 的内容。

**当前库中已有数据**（2026-10-14 实测）：`categories` 6 条 / `entries` 8 条 / `shots` 6 条；9/12–9/15 合计 = **128.30**。

---

## 4. 通用约定（以后写新接口都按这个来）

1. **路径规范**：新接口统一 `/api/xxx`（如 `/api/entries`）；本节的健康检查是唯一的历史遗留。
2. **方法语义**：`GET` 读取 · `POST` 新增 · `PUT/PATCH` 修改 · `DELETE` 删除。
3. **返回结构**：
   - 成功 → `{"ok": true, ...业务字段}`
   - 失败 → `{"ok": false, "code": "错误码", "message": "人话解释"}`
4. **时间**：同时给两个字段——`time` 用 ISO 8601，`timeCN` 用北京时间可读串。
5. **金额单位**：**元，两位小数**（数据库用 `DECIMAL(10,2)`）——Day 16 已定案。
6. **版本号**：`version` 字段，出现不兼容改动时递增。
7. **认证方式**：**未定**（Day 16–20 决定，可能用 CloudBase 的匿名/自定义登录）。
8. **跨域（重要，还没做）**：控制台里那条路由的"跨域"开关显示**已开启**，但实测响应头里**没有** `Access-Control-Allow-Origin`。也就是说，**前端页面现在还不能直接调这个接口**（浏览器会拦），这正是 Day 16–20 要配的东西。今天清单也明确不做跨域。

---

## 5. 怎么验证接口还活着

命令行（Windows 的 Git Bash / PowerShell 都行）：

```bash
curl -i "https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/e27182818wxy"
```

期望看到：`HTTP/1.1 200 OK` + `content-type: application/json` + 上面那段 JSON。

---

## 6. 后续计划（Day 16–20 会往这里加）

| 接口 / 事项 | 用途 | 状态 |
|-------------|------|------|
| 数据库表设计（categories / entries / shots） | 数据落到云上 | **已完成**（Day 16，见 `database/schema.sql`） |
| `GET /api/entries` | 拉取账目列表 | 未开始 |
| `POST /api/entries` | 新增一笔账 | 未开始 |
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
