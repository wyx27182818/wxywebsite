/**
 * 艺账 · 数据访问层（db）
 *
 * 这一层只管一件事：**怎么跟数据库说话**。
 * 它不认识 HTTP，不知道有 req/res，也不管响应长什么样。
 *
 * 对上层（repository）暴露两个东西：
 *   - getRdb()   拿到已鉴权的数据库操作实例
 *   - unwrap()   把 SDK 的 {data,error} 形态统一成"要么给数据、要么抛异常"
 *
 * —— 2026-10-15 Day 18 分层重构抽出，行为与原 index.js 完全一致。
 */

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
    // database: "public" —— 我们的表都在 public schema（node-sdk
    // 默认拿环境 ID 当 schema 名，必须显式指定，2026-10-14 实测踩过）。
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

module.exports = { getRdb: getRdb, unwrap: unwrap };
