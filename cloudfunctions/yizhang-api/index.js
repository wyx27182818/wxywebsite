/**
 * 艺账 · 云函数入口
 *
 * 2026-10-15 Day 18 分层重构后，这里只剩"启动入口"一件事：
 * 真正的实现在 app.js，本文件被 scf_bootstrap 执行（`exec node index.js`）。
 *
 * 目录分层（详见 README 或 api-contract.md）：
 *   index.js                        入口（本文件，只 require app）
 *   app.js                          HTTP 层：接请求 / 调服务 / 返响应 / 兜错
 *   services/yizhangService.js      业务层：校验规则、业务判断
 *   repositories/*.js               数据仓库层：每张表的全部 SQL 都在这
 *   db/client.js                    数据访问层：连库、鉴权、错误归一
 *
 * 保持这个文件名不变，是因为 scf_bootstrap 和部署配置都指向它。
 */

require("./app");
