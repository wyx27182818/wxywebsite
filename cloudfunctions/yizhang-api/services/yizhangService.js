/**
 * 艺账 · 业务层（service）
 *
 * 这一层放"业务规则"：什么算一笔合法的账、什么算重复、参数该怎么归一化。
 * 它调用 repository 拿/存数据，但不认识 HTTP（不知道 req/res，不管状态码）。
 *
 * 拆分依据：校验规则和业务判断跟"用什么数据库"无关，也跟"怎么收请求"无关，
 * 单独放一层，将来写测试或换存储都不用动它。
 *
 * —— 2026-10-15 Day 18 分层重构抽出，行为与原 index.js 完全一致。
 */

var entries = require("../repositories/entriesRepository");
var categories = require("../repositories/categoriesRepository");

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var MAX_ITEM_LEN = 100;
var MAX_AMOUNT = 99999999.99;

function clampInt(value, min, max, fallback) {
  var n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// 日期不光要长得对（2026-09-20），还得真实存在（2026-02-31 要拦下来）
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  var d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function makeError(code, message, detail) {
  var e = new Error(message);
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}

/**
 * 账目列表：先把查询参数验证归一化，再去库里取。
 * @param {{from?:string, to?:string, limit?:string, offset?:string}} query 原始查询串解析结果
 */
async function listEntries(query) {
  var from = query.from || null;
  var to = query.to || null;

  // 日期格式先自己校验，别把脏参数丢给数据库去报错
  if (from && !DATE_RE.test(from)) {
    throw makeError("INVALID_PARAM", '参数 from 要是 YYYY-MM-DD 格式，收到的是 "' + from + '"');
  }
  if (to && !DATE_RE.test(to)) {
    throw makeError("INVALID_PARAM", '参数 to 要是 YYYY-MM-DD 格式，收到的是 "' + to + '"');
  }

  var limit = clampInt(query.limit, 1, 200, 50);
  var offset = clampInt(query.offset, 0, 1000000, 0);

  return entries.listByDateRange({ from: from, to: to, limit: limit, offset: offset });
}

/**
 * 分类树（本层不含逻辑，纯透传给 repository，保留这层是为了接口层依赖稳定）
 */
async function listCategories() {
  return categories.listAll();
}

/**
 * 新增一笔账：校验 → 查分类 → 防重复 → 写库。
 * @param {object} body 已解析的请求体
 */
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
  } else if (item.length > MAX_ITEM_LEN) {
    problems.push("item 太长（最多 " + MAX_ITEM_LEN + " 个字，现在 " + item.length + " 个）");
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
    } else if (amount > MAX_AMOUNT) {
      problems.push("amount 超出上限（最多 " + MAX_AMOUNT + "）");
    } else {
      amount = Math.round(amount * 100) / 100; // 统一两位小数，和库里 NUMERIC(10,2) 对齐
    }
  }

  if (problems.length) {
    throw makeError("INVALID_BODY", "参数有问题——" + problems.join("；"));
  }

  // ---- 2. 分类：留空 = 未分类（存 NULL，和读取接口对"未分类"的表示一致）；
  //         写了名字就必须能在 categories 里查到 ----
  var categoryId = null;
  if (category && category !== "未分类") {
    var hit = await categories.findIdByPath(category);
    if (!hit) {
      throw makeError(
        "CATEGORY_NOT_FOUND",
        '分类 "' + category + '" 在库里不存在——先 GET /api/categories 看有哪些分类'
      );
    }
    categoryId = hit.id;
  }

  // ---- 3. 防重复：同一天 + 同分类 + 同物资，已经记过就拒绝（契约 §2.4 约定）----
  var dupId = await entries.findDuplicate(categoryId, date, item);
  if (dupId !== null) {
    throw makeError(
      "DUPLICATE",
      "这一天（" + date + "）已经记过「" + item + "」（分类：" + (category || "未分类") +
      "）了，不重复记。如果确实是另一笔，把 item 写得更具体些（比如「苹果（下午）」）再提交",
      "already_exists id=" + dupId
    );
  }

  // ---- 4. 真正写库 ----
  return entries.insert({ categoryId: categoryId, date: date, item: item, amount: amount, category: category });
}

module.exports = {
  listEntries: listEntries,
  listCategories: listCategories,
  createEntry: createEntry
};
