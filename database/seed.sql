-- ============================================================
-- 艺账 · 示例数据（seed.sql）
-- 目标数据库：CloudBase 环境自带的 PostgreSQL 17
-- 前置：先执行 schema.sql 建好三张表
--
-- 可重复执行：开头 TRUNCATE 一次清空三张表并把自增编号归零，
--   再插入主键写死的固定数据，所以跑多少遍结果都一样。
--   ⚠️ 会清空这三张表，只用于开发阶段。
-- ============================================================

-- 第一步：清空旧数据，并把自增序号重置回 1（PG 用 RESTART IDENTITY，MySQL 是 ALTER TABLE ... AUTO_INCREMENT = 1）
TRUNCATE TABLE shots, entries, categories RESTART IDENTITY CASCADE;

-- 第二步：插入分类（先父级，后子级）
INSERT INTO categories (id, parent_id, name, full_path, sort_no) VALUES
  (1, NULL, '未分类', '未分类',    0),
  (2, NULL, '餐饮',   '餐饮',     10),
  (3, 2,    '水果',   '餐饮/水果', 10),
  (4, 2,    '饮品',   '餐饮/饮品', 20),
  (5, NULL, '交通',   '交通',     20),
  (6, NULL, '日用',   '日用',     30);

-- 第三步：插入账目（category_id 对应上面的分类 id）
INSERT INTO entries (id, category_id, spent_on, item, amount) VALUES
  (1, 3,    '2026-09-12', '苹果',       26.80),
  (2, 3,    '2026-09-12', '葡萄',       35.00),
  (3, 4,    '2026-09-13', '奶茶',       18.00),
  (4, 2,    '2026-09-14', '午餐',       42.50),
  (5, 5,    '2026-09-15', '地铁',        6.00),
  (6, 6,    '2026-09-16', '洗衣液',     39.90),
  (7, NULL, '2026-09-17', '未归类小票', 12.00),
  (8, 3,    '2026-09-18', '香蕉',        9.90);

-- 第四步：插入截图（entry_id 对应上面的账目 id）
--   第 1 笔特意给了 2 张，用来演示「同一笔多张截图 + 拼接顺序」
INSERT INTO shots (id, entry_id, seq, file_path, width, height) VALUES
  (1, 1, 1, 'shots/2026-09-12/entry-1-1.png', 440, 978),
  (2, 1, 2, 'shots/2026-09-12/entry-1-2.png', 440, 978),
  (3, 2, 1, 'shots/2026-09-12/entry-2-1.png', 440, 978),
  (4, 3, 1, 'shots/2026-09-13/entry-3-1.png', 440, 978),
  (5, 5, 1, 'shots/2026-09-15/entry-5-1.png', 440, 978),
  (6, 6, 1, 'shots/2026-09-16/entry-6-1.png', 440, 978);

-- 第五步：把自增序列对齐到当前最大 id（因为上面是写死 id 插入的，
--   不对齐的话下一条自动插入会从 1 开始撞号）
SELECT setval(pg_get_serial_sequence('categories', 'id'), (SELECT MAX(id) FROM categories));
SELECT setval(pg_get_serial_sequence('entries',    'id'), (SELECT MAX(id) FROM entries));
SELECT setval(pg_get_serial_sequence('shots',      'id'), (SELECT MAX(id) FROM shots));

-- ============================================================
-- 执行完可用的验证 SQL（复制走单独跑）
-- ============================================================

-- ① 三张表各有多少条？期望：分类 6 / 账目 8 / 截图 6
-- SELECT 'categories' AS 表名, COUNT(*) AS 条数 FROM categories
-- UNION ALL SELECT 'entries', COUNT(*) FROM entries
-- UNION ALL SELECT 'shots',   COUNT(*) FROM shots;

-- ② 账目连同它的分类（看外键是否接对；期望只有「未归类小票」的分类为 NULL）
-- SELECT e.id, c.full_path AS 分类, e.spent_on AS 日期, e.item AS 物资, e.amount AS 金额
-- FROM entries e LEFT JOIN categories c ON c.id = e.category_id
-- ORDER BY e.spent_on, e.id;

-- ③ 按时间段算总额（艺账最常看的数字）：9 月 12 日至 15 日合计 128.30
-- SELECT SUM(amount) AS 合计 FROM entries WHERE spent_on BETWEEN '2026-09-12' AND '2026-09-15';

-- ④ 按分类统计
-- SELECT c.full_path, COUNT(*) AS 笔数, SUM(e.amount) AS 合计
-- FROM entries e JOIN categories c ON c.id = e.category_id
-- GROUP BY c.full_path ORDER BY 合计 DESC;

-- ⑤ 每笔账目带几张截图（验证外键与一对多）
-- SELECT e.id, e.item, COUNT(s.id) AS 截图数
-- FROM entries e LEFT JOIN shots s ON s.entry_id = e.id
-- GROUP BY e.id, e.item ORDER BY e.id;

-- ⑥ 自引用外键验证：看分类的上下级关系
-- SELECT child.full_path AS 子分类, parent.full_path AS 父分类
-- FROM categories child LEFT JOIN categories parent ON parent.id = child.parent_id
-- ORDER BY child.id;
