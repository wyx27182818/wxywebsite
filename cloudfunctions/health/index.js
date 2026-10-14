// 艺账后端 · 健康检查（Day 15 · HTTP 云函数 / Web 函数版）
//
// CloudBase 里的「HTTP 云函数」和普通「事件函数」不一样：
//   事件函数：写 exports.main，平台调一次返回一次；
//   HTTP 云函数：要自己起一个 Web 服务器，平台把 HTTP 请求转给它，服务器要一直活着监听端口。
// 本文件是 HTTP 云函数版：用 Node 自带的 http 模块（零依赖，不用 npm install），
// 不管请求打到哪个路径，都返回同一段 JSON —— 今天它的使命就是证明「公网能访问到我」。
//
// 监听端口必须听平台环境变量给的，不能写死：不同版本平台给的变量名不一样，所以依次尝试。

var http = require("http");

var PORT = Number(
  process.env.TENCENTCLOUD_SERVERPORT ||
  process.env.TCB_SERVERPORT ||
  process.env.PORT ||
  9000
);

var server = http.createServer(function (req, res) {
  var now = new Date();
  var payload = {
    ok: true,
    service: "yizhang-api",
    version: "v0.1",
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || "unknown",
    time: now.toISOString(),
    timeCN: now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false
    }),
    method: req.method,
    path: req.url
  };
  var body = JSON.stringify(payload);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
});

server.listen(PORT, function () {
  console.log("health server listening on port " + PORT);
});
