/**
 * 艺账 · categories 表的数据仓库（repository）
 *
 * 这一层只管 categories（分类表）的读写：**所有针对这个表的数据库查询都写在这里**。
 * 分类表本质是本"字典"，目前只有读操作。
 *
 * 表结构见 database/schema.sql（支持「/」分隔的多级路径，full_path 唯一）。
 *
 * —— 2026-10-15 Day 18 分层重构抽出，行为与原 index.js 完全一致。
 */

var db = require("../db/client");
var unwrap = db.unwrap;

// 数据库行 → 接口 JSON
function toCategoryJson(row) {
  return {
    id: Number(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    name: row.name,
    path: row.full_path,
    sortNo: Number(row.sort_no)
  };
}

/**
 * 查全部分类，按 sort_no、id 升序（同级排序优先，其次按创建顺序）。
 */
async function listAll() {
  var rdb = db.getRdb();
  var q = rdb
    .from("categories")
    .select("id, parent_id, name, full_path, sort_no")
    .order("sort_no", { ascending: true })
    .order("id", { ascending: true });

  var rows = unwrap(await q, "分类列表");
  return rows.map(toCategoryJson);
}

/**
 * 按完整路径查一个分类的 id（写入时校验分类是否存在用）。
 * @returns {Promise<{id:number, path:string}|null>} 命中则返回 {id, path}，没有则 null
 */
async function findIdByPath(path) {
  var rdb = db.getRdb();
  var rows = unwrap(
    await rdb.from("categories").select("id, full_path").eq("full_path", path).range(0, 0),
    "分类查询"
  );
  if (!rows.length) return null;
  return { id: Number(rows[0].id), path: rows[0].full_path };
}

module.exports = {
  listAll: listAll,
  findIdByPath: findIdByPath
};
