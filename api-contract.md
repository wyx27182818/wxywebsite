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

## 3. 通用约定（以后写新接口都按这个来）

1. **路径规范**：新接口统一 `/api/xxx`（如 `/api/entries`）；本节的健康检查是唯一的历史遗留。
2. **方法语义**：`GET` 读取 · `POST` 新增 · `PUT/PATCH` 修改 · `DELETE` 删除。
3. **返回结构**：
   - 成功 → `{"ok": true, ...业务字段}`
   - 失败 → `{"ok": false, "code": "错误码", "message": "人话解释"}`
4. **时间**：同时给两个字段——`time` 用 ISO 8601，`timeCN` 用北京时间可读串。
5. **金额单位**：**待定**（元 or 分），Day 16 定下来后补进本节。
6. **版本号**：`version` 字段，出现不兼容改动时递增。
7. **认证方式**：**未定**（Day 16–20 决定，可能用 CloudBase 的匿名/自定义登录）。
8. **跨域（重要，还没做）**：控制台里那条路由的"跨域"开关显示**已开启**，但实测响应头里**没有** `Access-Control-Allow-Origin`。也就是说，**前端页面现在还不能直接调这个接口**（浏览器会拦），这正是 Day 16–20 要配的东西。今天清单也明确不做跨域。

---

## 4. 怎么验证接口还活着

命令行（Windows 的 Git Bash / PowerShell 都行）：

```bash
curl -i "https://e27182818wxy-d1gadlaz7c3b34f5a-1503948716.ap-shanghai.app.tcloudbase.com/e27182818wxy"
```

期望看到：`HTTP/1.1 200 OK` + `content-type: application/json` + 上面那段 JSON。

---

## 5. 后续计划（Day 16–20 会往这里加）

| 接口 / 事项 | 用途 | 状态 |
|-------------|------|------|
| `GET /api/entries` | 拉取账目列表 | 未开始 |
| `POST /api/entries` | 新增一笔账 | 未开始 |
| `PUT /api/entries/:id` | 修改一笔 | 未开始 |
| `DELETE /api/entries/:id` | 删除一笔 | 未开始 |
| 数据库表设计（账目表 / 截图存储） | 数据落到云上 | 未开始 |
| 跨域配置 | 让前端页面能直连接口 | 未开始 |
| 截图存储（云存储） | 多设备共用截图 | 未开始 |

---

## 6. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-14 | 首版：环境开通、健康检查接口上线（HTTP 200 实测通过）、前端页面静态托管上线，两端地址确定 |
