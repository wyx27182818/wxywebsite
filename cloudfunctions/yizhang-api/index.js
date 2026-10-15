/**
 * 艺账 · 后端接口（HTTP 云函数 / Web 函数）
 *
 * 本文件是「一个函数，多个接口」：网关把 /api/* 的请求都交给它，
 * 它再看路径分派给具体的处理逻辑（详见下面的路由区）。
 *
 * 对外接口（响应统一为 { ok, data, error } 三段式，见 api-contract.md §4）：
 *   GET  /api/health      健康检查（不带业务数据）
 *   GET  /api/categories  读核心表 categories（分类树）
 *   GET  /api/entries     读记录表 entries（账目流水，含分类名与截图）
 *   POST /api/entries     往记录表 entries 写一笔账（必填校验 + 防重复，见 §2.7）
 *
 * 数据访问走 @cloudbase/node-sdk 的 rdb 查询（PostgREST 数据网关）：
 * 云函数环境内自带身份，免数据库密码、免连接配置——2026-10-14 实测打通。
 * 查询条件全部由构建器方法传入（.gte / .lte / .range），等价于 SQL 参数化，无字符串拼接。
 */

var http = require("http");
// node-sdk 懒加载：health 接口不需要它，这样"函数能不能启动"和"依赖装没装好"两个问题互不干扰

var SERVICE = "yizhang-api";
var VERSION = "v0.5";

// ============================================================
// 一、统一响应（{ ok, data, error } 三段式）
// ============================================================

function sendOnce(res, status, payload) {
  // 一个请求只允许回一次，避免"头部已发送"的二次写入报错
  if (res.__sent) return;
  res.__sent = true;

  var body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    // 不写这一行的话，浏览器打开接口地址会变成"下载文件"而不是直接显示
    "Content-Disposition": "inline"
  });
  res.end(body);
}

function ok(res, data) {
  sendOnce(res, 200, { ok: true, data: data, error: null });
}

function fail(res, status, code, message, extra) {
  var error = { code: code, message: message };
  if (extra) error.detail = extra;
  sendOnce(res, status, { ok: false, data: null, error: error });
}

// ============================================================
// 二、数据库访问（node-sdk rdb，免密）
//    rdb 实例放在模块顶层只建一次，云函数实例复用期间一直用它。
//    database: "public" —— 我们的表都在 public schema（node-sdk
//    默认拿环境 ID 当 schema 名，必须显式指定，2026-10-14 实测踩过）。
// ============================================================

var app = null;
var rdbInstance = null;

function getRdb() {
  if (rdbInstance) return rdbInstance;

  // 第一次真正用到数据库时才加载 SDK（懒加载）
  var cloudbase = require("@cloudbase/node-sdk");

  var envId = process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (!envId) {
    var miss = new Error("云函数环境变量 TCB_ENV 不存在——本接口只能在云端云函数里跑，本地运行没有云端身份");
    miss.code = "DB_NOT_AVAILABLE";
    throw miss;
  }

  if (!app) {
    // 鉴权（2026-10-15 踩坑后按官方文档 + SDK 源码修正）：
    //   Web（HTTP）云函数平台**不会**自动注入鉴权 —— 表现是"读得到、写不了"
    //   （permission denied for table entries，错误码 42501）。原因是 SDK 拿不到
    //   身份时退化成匿名（anon）角色，而 anon 对表只有 SELECT 权限。
    //
    //   解法：服务端管理员凭证 api_key（CloudBase 控制台「环境 → API Key 配置」生成），
    //   写进云函数环境变量 CLOUDBASE_APIKEY。传参优先级（对应 SDK 的 normalizeConfig）：
    //     ① init 时显式传 accessKey（最高）
    //     ② init 时显式传 secretId + secretKey
    //     ③ 环境变量 CLOUDBASE_APIKEY（SDK 自己会读，见 dist/utils/utils.js）
    //   这里用 ①，因为显式传最不容易被别的环境变量干扰，且失败时能看到自己的日志。
    //
    //   注意：**不要**从环境变量读 TENCENTCLOUD_SECRETID/SECRETKEY 固化进 config ——
    //   SCF 里那是会过期的临时密钥，固化后长驻实例会突然失效（SDK 源码注释明确警告）。
    var apiKey = process.env.CLOUDBASE_APIKEY;
    var initOpts = { env: envId };
    if (apiKey) {
      initOpts.accessKey = apiKey;
    } else {
      console.warn(
        "[auth] 未发现环境变量 CLOUDBASE_APIKEY —— 云函数将以匿名(anon)身份访问数据库，" +
        "能读不能写。请在 cloudbaserc.json 的 envVariables 里配置后重新部署。"
      );
    }
    app = cloudbase.init(initOpts);
  }
  try {
    rdbInstance = app.rdb({ database: "public" });
  } catch (e) {
    var err = new Error("数据库网关初始化失败：" + e.message);
    err.code = "DB_NOT_AVAILABLE";
    throw err;
  }
  return rdbInstance;
}

// 统一处理 rdb 返回的 { data, error } 形态：有 error 就抛成带错误码的异常
function unwrap(r, what) {
  if (r && r.error) {
    var e = new Error(what + " 查询失败：" + (r.error.message || JSON.stringify(r.error)));
    e.code = "DB_QUERY_FAILED";
    e.detail = r.error.code;
    throw e;
  }
  return (r && r.data) || [];
}

// ============================================================
// 三、查询构建（等价于 SQL 参数化：条件走方法参数，不拼字符串）
// ============================================================

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 账目列表：一笔账 + 它的分类名 + 它的截图数组
// 嵌套语法 categories(full_path) / shots(...) 由 PostgREST 按外键自动关联
async function listEntries(query) {
  var from = query.from || null;
  var to = query.to || null;

  // 日期格式先自己校验，别把脏参数丢给数据库去报错
  if (from && !DATE_RE.test(from)) {
    var e1 = new Error('参数 from 要是 YYYY-MM-DD 格式，收到的是 "' + from + '"');
    e1.code = "INVALID_PARAM";
    throw e1;
  }
  if (to && !DATE_RE.test(to)) {
    var e2 = new Error('参数 to 要是 YYYY-MM-DD 格式，收到的是 "' + to + '"');
    e2.code = "INVALID_PARAM";
    throw e2;
  }

  var limit = clampInt(query.limit, 1, 200, 50);
  var offset = clampInt(query.offset, 0, 1000000, 0);

  var rdb = getRdb();
  var q = rdb
    .from("entries")
    .select("id, category:categories(full_path), date:spent_on, item, amount, shots(seq, file_path)")
    .order("spent_on", { ascending: false })
    .order("id", { ascending: false })
    .order("seq", { ascending: true, referencedTable: "shots" }); // 拼图顺序

  if (from) q = q.gte("spent_on", from);
  if (to) q = q.lte("spent_on", to);
  q = q.range(offset, offset + limit - 1); // range = offset + limit，一体完成

  var rows = unwrap(await q, "账目列表");

  return rows.map(function (row) {
    return {
      id: Number(row.id),
      // 分类统一给「一个字符串」：有分类给完整路径，没归类给"未分类"。
      // 嵌套查询在 category_id 为 NULL 时返回 null，有值时返回 { full_path }，
      // 两种形状都归一化成字符串，前端不用再判空、判类型。
      category: (row.category && row.category.full_path) || "未分类",
      date: row.date,
      item: row.item,
      amount: Number(row.amount),
      shots: (row.shots || []).map(function (s) {
        return { seq: Number(s.seq), path: s.file_path };
      })
    };
  });
}

// 分类树：核心表，基本是只读的"字典"
async function listCategories() {
  var rdb = getRdb();
  var q = rdb
    .from("categories")
    .select("id, parent_id, name, full_path, sort_no")
    .order("sort_no", { ascending: true })
    .order("id", { ascending: true });

  var rows = unwrap(await q, "分类列表");

  return rows.map(function (row) {
    return {
      id: Number(row.id),
      parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
      name: row.name,
      path: row.full_path,
      sortNo: Number(row.sort_no)
    };
  });
}

// ============================================================
// 三·B、写入：新增一笔账（POST /api/entries）  契约见 api-contract.md §2.7
// ============================================================

var MAX_BODY_BYTES = 64 * 1024; // 一笔账的请求体用不了 64KB，超过就拒掉（防滥用）

function badBody(msg) {
  var e = new Error(msg);
  e.code = "INVALID_BODY";
  return e;
}

// 把请求体读全、解析成 JSON 对象（只在 POST 用）
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;

    req.on("data", function (c) {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(badBody("请求体太大了（最多 64KB）"));
        return;
      }
      chunks.push(c);
    });

    req.on("end", function () {
      var raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({}); // 空体当成 {}，后面按"缺字段"统一报错
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return reject(badBody("请求体不是合法的 JSON：" + e.message));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reject(badBody('请求体要是一个 JSON 对象，比如 {"date":"2026-09-20","item":"葡萄","amount":35}'));
      }
      resolve(parsed);
    });

    req.on("error", function (e) {
      reject(badBody("读请求体失败：" + e.message));
    });
  });
}

// 日期不光要长得对（2026-09-20），还得真实存在（2026-02-31 要拦下来）
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  var d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function createEntry(body) {
  // ---- 1. 先把必填和格式查清楚，一次把所有毛病都报出来（不是报一个改一个）----
  var problems = [];

  var date = typeof body.date === "string" ? body.date.trim() : "";
  var item = typeof body.item === "string" ? body.item.trim() : "";
  var category = typeof body.category === "string" ? body.category.trim() : "";
  var amount = null;

  if (!date) {
    problems.push("缺 date（花销日期，格式 YYYY-MM-DD，比如 2026-09-20）");
  } else if (!isRealDate(date)) {
    problems.push('date 要是真实存在的日期，格式 YYYY-MM-DD，收到的是 "' + date + '"');
  }

  if (!item) {
    problems.push("缺 item（买的什么，比如 苹果）");
  } else if (item.length > 100) {
    problems.push("item 太长（最多 100 个字，现在 " + item.length + " 个）");
  }

  var rawAmount = body.amount;
  if (rawAmount === undefined || rawAmount === null || rawAmount === "") {
    problems.push("缺 amount（金额，单位元，比如 26.8）");
  } else {
    amount = Number(rawAmount);
    if (!isFinite(amount)) {
      problems.push('amount 要填数字，收到的是 "' + rawAmount + '"');
    } else if (amount < 0) {
      problems.push("amount 不能是负数，收到的是 " + amount);
    } else if (amount > 99999999.99) {
      problems.push("amount 超出上限（最多 99999999.99）");
    } else {
      amount = Math.round(amount * 100) / 100; // 统一两位小数，和库里 NUMERIC(10,2) 对齐
    }
  }

  if (problems.length) {
    throw badBody("参数有问题——" + problems.join("；"));
  }

  var rdb = getRdb();

  // ---- 2. 分类：留空 = 未分类（存 NULL，和读取接口对"未分类"的表示一致）；
  //         写了名字就必须能在 categories 里查到 ----
  var categoryId = null;
  if (category && category !== "未分类") {
    var catRows = unwrap(
      await rdb.from("categories").select("id").eq("full_path", category).range(0, 0),
      "分类查询"
    );
    if (!catRows.length) {
      var ec = new Error('分类 "' + category + '" 在库里不存在——先 GET /api/categories 看有哪些分类');
      ec.code = "CATEGORY_NOT_FOUND";
      throw ec;
    }
    categoryId = Number(catRows[0].id);
  }

  // ---- 3. 防重复：同一天 + 同分类 + 同物资，已经记过就拒绝（契约 §2.7 约定）----
  var dupQ = rdb.from("entries").select("id").eq("spent_on", date).eq("item", item);
  dupQ = categoryId === null ? dupQ.is("category_id", null) : dupQ.eq("category_id", categoryId);
  var dupRows = unwrap(await dupQ.range(0, 0), "重复检查");
  if (dupRows.length) {
    var ed = new Error(
      "这一天（" + date + "）已经记过「" + item + "」（分类：" + (category || "未分类") +
      "）了，不重复记。如果确实是另一笔，把 item 写得更具体些（比如「苹果（下午）」）再提交"
    );
    ed.code = "DUPLICATE";
    ed.detail = "already_exists id=" + dupRows[0].id;
    throw ed;
  }

  // ---- 4. 真正写库：列名和值交给构建器参数化，不拼 SQL 字符串 ----
  var inserted = unwrap(
    await rdb
      .from("entries")
      .insert([{ category_id: categoryId, spent_on: date, item: item, amount: amount }])
      .select("id, spent_on, item, amount"),
    "新增账目"
  );

  var row = inserted[0];
  if (!row) {
    var ei = new Error("写入后没有拿到新记录");
    ei.code = "INTERNAL_ERROR";
    throw ei;
  }

  // ---- 5. 返回形状和 GET /api/entries 的单条一模一样，前端可以复用同一套渲染 ----
  return {
    id: Number(row.id),
    category: category || "未分类",
    date: row.spent_on,
    item: row.item,
    amount: Number(row.amount),
    shots: []
  };
}

function health(req) {
  var now = new Date();
  return {
    service: SERVICE,
    version: VERSION,
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || "unknown",
    time: now.toISOString(),
    timeCN: now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    method: req.method,
    path: req.url,
    // 数据访问方式说明（不含任何密钥）
    dbMode: "cloudbase-rdb/public",
    // 鉴权状态：只报"有没有配"，绝不回显密钥本身
    auth: process.env.CLOUDBASE_APIKEY ? "api_key" : "anon(未配 CLOUDBASE_APIKEY)"
  };
}

// ============================================================
// 四、路由：把路径分派到上面的处理函数
// ============================================================

/**
 * 归一化路径。
 * 网关有两种可能：开了"路径透传"时给的是完整路径 /api/entries；
 * 没开时前缀被剥掉，剩下 /entries。两种都认，这里统一成 /entries。
 */
function normalizePath(rawUrl) {
  var p = String(rawUrl || "/").split("?")[0];
  if (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
  if (p === "/api") return "/";
  if (p.indexOf("/api/") === 0) return p.slice(4);
  return p || "/";
}

function parseQuery(rawUrl) {
  var query = {};
  var s = String(rawUrl || "");
  var i = s.indexOf("?");
  if (i < 0) return query;
  s.slice(i + 1).split("&").forEach(function (pair) {
    if (!pair) return;
    var kv = pair.split("=");
    var key = decodeURIComponent(kv[0] || "");
    if (!key) return;
    query[key] = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
  });
  return query;
}

function handle(req, res) {
  var path = normalizePath(req.url);
  var query = parseQuery(req.url);
  var method = String(req.method || "GET").toUpperCase();

  if (path === "/" || path === "/health") {
    if (method !== "GET") {
      return fail(res, 405, "METHOD_NOT_ALLOWED",
        "/api/health 只支持 GET，收到的是 " + method);
    }
    return ok(res, health(req));
  }

  if (path === "/entries") {
    if (method === "GET") {
      return listEntries(query).then(function (data) { ok(res, data); });
    }
    if (method === "POST") {
      return readJsonBody(req)
        .then(function (body) { return createEntry(body); })
        .then(function (data) { ok(res, data); });
    }
    return fail(res, 405, "METHOD_NOT_ALLOWED",
      "/api/entries 现在支持 GET（读列表）和 POST（新增一笔），收到的是 " + method);
  }

  if (path === "/categories") {
    if (method !== "GET") {
      return fail(res, 405, "METHOD_NOT_ALLOWED",
        "/api/categories 现在只支持 GET，收到的是 " + method);
    }
    return listCategories().then(function (data) { ok(res, data); });
  }

  return fail(res, 404, "NOT_FOUND",
    "没有这个接口：" + path + "（现有：/api/health、/api/entries、/api/categories）");
}

// ============================================================
// 五、HTTP 服务
// ============================================================

// 监听端口：平台用 SCF_FRAME_RUNTIME_PORT（=9000）来连我们，
// 而 TENCENTCLOUD_SERVERPORT / TCB_SERVERPORT / PORT 三个变量在本环境都是空的，
// 所以要落到 9000 这个兜底值上。
// 注意：_SCF_SERVER_PORT（=28902）是 SCF 框架内部自用的端口，绝不能拿来监听，
// 2026-10-14 就因为把它写进取值链，函数一直"启动不了"（平台在 9000 上等不到响应）。
var PORT = Number(
  process.env.TENCENTCLOUD_SERVERPORT ||
  process.env.TCB_SERVERPORT ||
  process.env.PORT ||
  9000
);

var server = http.createServer(function (req, res) {
  Promise.resolve()
    .then(function () { return handle(req, res); })
    .catch(function (err) {
      var code = (err && err.code) || "INTERNAL_ERROR";
      if (code === "DB_NOT_AVAILABLE") {
        return fail(res, 503, code, err.message);
      }
      if (code === "DB_QUERY_FAILED") {
        return fail(res, 502, code, err.message, err.detail);
      }
      // 参数类错误统一 400：查询参数（INVALID_PARAM）、写入体（INVALID_BODY）、分类查不到（CATEGORY_NOT_FOUND）
      if (code === "INVALID_PARAM" || code === "INVALID_BODY" || code === "CATEGORY_NOT_FOUND") {
        return fail(res, 400, code, err.message);
      }
      // 重复记录单独用 409（Conflict）——"这次请求跟已有的撞了"，语义上不是参数写错
      if (code === "DUPLICATE") {
        return fail(res, 409, code, err.message, err.detail);
      }
      console.error("[api] 未预期错误：", err);
      return fail(res, 500, "INTERNAL_ERROR",
        "服务器内部错误：" + (err && err.message ? err.message : String(err)));
    });
});

server.listen(PORT, function () {
  console.log("[" + SERVICE + " " + VERSION + "] 已启动，监听端口 " + PORT);
});
