/**
 * 艺账 · entries 表的数据仓库（repository）
 *
 * 这一层只管 entries（账目表）的读写：**所有针对这个表的数据库查询都写在这里**。
 * 接口层要数据就调这里的方法，不直接碰 rdb。
 *
 * 对上暴露的都是"业务语言"的方法（listEntries / findDuplicate / insertEntry…），
 * 不暴露"SQL 语言"的东西（不带 .eq/.gte 这类构建器细节出去）。
 *
 * 表结构见 database/schema.sql；字段 ↔ JSON 的对应见 api-contract.md §3.2。
 *
 * —— 2026-10-15 Day 18 分层重构抽出，行为与原 index.js 完全一致。
 */

var db = require("../db/client");
var unwrap = db.unwrap;

// 数据库列名 → 接口 JSON 字段名的归一化。
// category 在库里有两种形态（NULL / { full_path }），这里统一成字符串：
// 有分类给完整路径，没归类固定给"未分类"，前端不用再判空、判类型。
function toEntryJson(row) {
  return {
    id: Number(row.id),
    category: (row.category && row.category.full_path) || "未分类",
    date: row.date,
    item: row.item,
    amount: Number(row.amount),
    shots: (row.shots || []).map(function (s) {
      return { seq: Number(s.seq), path: s.file_path };
    })
  };
}

/**
 * 按日期区间查账目列表（含分类路径与截图数组）。
 * @param {{from?:string, to?:string, limit:number, offset:number}} opts 已由接口层校验/归一化过的参数
 */
async function listByDateRange(opts) {
  var rdb = db.getRdb();
  var q = rdb
    .from("entries")
    .select("id, category:categories(full_path), date:spent_on, item, amount, shots(seq, file_path)")
    .order("spent_on", { ascending: false })
    .order("id", { ascending: false })
    .order("seq", { ascending: true, referencedTable: "shots" }); // 拼图顺序

  if (opts.from) q = q.gte("spent_on", opts.from);
  if (opts.to) q = q.lte("spent_on", opts.to);
  q = q.range(opts.offset, opts.offset + opts.limit - 1); // range = offset + limit，一体完成

  var rows = unwrap(await q, "账目列表");
  return rows.map(toEntryJson);
}

/**
 * 查"同日期 + 同分类 + 同物资"是否已存在（防重复用）。
 * categoryId 为 null 时按 `category_id IS NULL` 比对 —— 不是拿空字符串去比。
 * @returns {Promise<number|null>} 已存在的记录 id；没有则 null
 */
async function findDuplicate(categoryId, date, item) {
  var rdb = db.getRdb();
  var q = rdb.from("entries").select("id").eq("spent_on", date).eq("item", item);
  q = categoryId === null ? q.is("category_id", null) : q.eq("category_id", categoryId);
  var rows = unwrap(await q.range(0, 0), "重复检查");
  return rows.length ? Number(rows[0].id) : null;
}

/**
 * 新增一笔账，返回写库后的记录（已归一化成接口 JSON 形状）。
 * 列名和值交给构建器参数化，不拼 SQL 字符串。
 */
async function insert(data) {
  var rdb = db.getRdb();
  var inserted = unwrap(
    await rdb
      .from("entries")
      .insert([{ category_id: data.categoryId, spent_on: data.date, item: data.item, amount: data.amount }])
      .select("id, spent_on, item, amount"),
    "新增账目"
  );

  var row = inserted[0];
  if (!row) {
    var e = new Error("写入后没有拿到新记录");
    e.code = "INTERNAL_ERROR";
    throw e;
  }

  // 返回形状和 GET 的单条一模一样（新记录还没截图，shots 固定 []），前端可复用同一套渲染
  return {
    id: Number(row.id),
    category: data.category || "未分类",
    date: row.spent_on,
    item: row.item,
    amount: Number(row.amount),
    shots: []
  };
}

module.exports = {
  listByDateRange: listByDateRange,
  findDuplicate: findDuplicate,
  insert: insert
};
