/**
 * 艺账 · HTTP 层（只负责"接请求、调函数、返响应"）
 *
 * 这一层做四件事，别的一概不做：
 *   ① 收请求：读 path / method / query / body
 *   ② 调函数：把参数交给 service
 *   ③ 返响应：统一的 { ok, data, error } 三段式 + HTTP 状态码
 *   ④ 兜错：把 service 抛出的 code 翻译成状态码
 *
 * 这里**不写任何数据库查询**，也不写业务规则——那两件事分别在 repository 和 service。
 *
 * —— 2026-10-15 Day 18 分层重构抽出，对外行为与原 index.js 完全一致。
 */

var http = require("http");
var service = require("./services/yizhangService");

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
// 二、请求解析
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
// 三、路由：把路径分派到 service 的方法
// ============================================================

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
      return service.listEntries(query).then(function (data) { ok(res, data); });
    }
    if (method === "POST") {
      return readJsonBody(req)
        .then(function (body) { return service.createEntry(body); })
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
    return service.listCategories().then(function (data) { ok(res, data); });
  }

  return fail(res, 404, "NOT_FOUND",
    "没有这个接口：" + path + "（现有：/api/health、/api/entries、/api/categories）");
}

// ============================================================
// 四、错误码 → HTTP 状态码 的翻译表
// ============================================================

var STATUS_BY_CODE = {
  DB_NOT_AVAILABLE: 503,
  DB_QUERY_FAILED: 502,
  // 参数类错误统一 400：查询参数、写入体、分类查不到
  INVALID_PARAM: 400,
  INVALID_BODY: 400,
  CATEGORY_NOT_FOUND: 400,
  // 重复记录用 409（Conflict）——"这次请求跟已有的撞了"，语义上不是参数写错
  DUPLICATE: 409
};

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
      var mapped = STATUS_BY_CODE[code];
      if (mapped) {
        return fail(res, mapped, code, err.message, err.detail);
      }
      console.error("[api] 未预期错误：", err);
      return fail(res, 500, "INTERNAL_ERROR",
        "服务器内部错误：" + (err && err.message ? err.message : String(err)));
    });
});

server.listen(PORT, function () {
  console.log("[" + SERVICE + " " + VERSION + "] 已启动，监听端口 " + PORT);
});
