const { ipcMain } = require("electron");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");

// 可用环境变量覆盖：NAPCAT_API_BASE、NAPCAT_API_TOKEN、QUICK_TITLE_DEBUG_LOG
const API_BASE = process.env.NAPCAT_API_BASE || "http://127.0.0.1:3000";
// 请通过环境变量 NAPCAT_API_TOKEN 注入 OneBot API Token（需与 NapCat onebot11 配置一致）；
// 留空则请求不带 Authorization 头（仅适用于 NapCat 未开启鉴权的场景）
const API_TOKEN = process.env.NAPCAT_API_TOKEN || "";
const DEBUG_LOG = process.env.QUICK_TITLE_DEBUG_LOG || "quick-title-debug.log";

// 本地探针通道：向 probe-command.json 写入 {urlIncludes, code}，
// 插件在匹配的窗口里执行 code 并把结果写入 probe-result.json（仅本机调试用，
// 路径可通过 QUICK_TITLE_PROBE_CMD / QUICK_TITLE_PROBE_RESULT 覆盖）
const PROBE_CMD = process.env.QUICK_TITLE_PROBE_CMD || "probe-command.json";
const PROBE_RESULT = process.env.QUICK_TITLE_PROBE_RESULT || "probe-result.json";

// 渲染层可通过 IPC 调用的只读接口白名单
const READONLY_APIS = new Set([
  "/get_group_member_list",
  "/get_group_info",
  "/get_group_member_info",
  "/get_group_msg_history",
  "/get_group_list"
]);

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const client = url.protocol === "https:" ? https : http;
    const body = JSON.stringify(data);

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    };

    if (API_TOKEN) {
      headers.Authorization = `Bearer ${API_TOKEN}`;
    }

    const req = client.request(url, {
      method: "POST",
      headers,
      timeout: 10000
    }, (res) => {
      let text = "";

      res.setEncoding("utf8");
      res.on("data", chunk => text += chunk);
      res.on("end", () => {
        try {
          const result = JSON.parse(text);

          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            (result.status === "ok" || result.retcode === 0)
          ) {
            resolve(result);
          } else {
            reject(new Error(
              result.message || result.wording ||
              `API 请求失败，HTTP ${res.statusCode}`
            ));
          }
        } catch {
          reject(new Error(`API 返回了无法解析的响应：${text}`));
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    req.end(body);
  });
}

const windows = new Set();
let probeBusy = false;
let probeStarted = false;

// ===== 移动端网页（手机经局域网访问，代理转发到本机 NapCat API）=====
const MOBILE_PORT = 3210;
const MOBILE_KEY = API_TOKEN; // 访问密钥沿用 API Token
const MOBILE_APIS = new Set(["/get_group_list", "/get_group_member_list", "/set_group_special_title"]);
let mobileStarted = false;

function startMobileServer() {
  if (mobileStarted) return;
  mobileStarted = true;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const key = url.searchParams.get("key") || req.headers["x-key"] || "";
      if (key !== MOBILE_KEY) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("密钥错误：地址栏需带 ?key=你的Token（与 NapCat API Token 相同）");
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(MOBILE_HTML);
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const path = url.pathname.slice(4);
        if (!MOBILE_APIS.has(path)) { res.writeHead(404); res.end('{"error":"not allowed"}'); return; }
        let body = "";
        for await (const chunk of req) body += chunk;
        const data = body ? JSON.parse(body) : {};
        try {
          const result = await postJson(path, data);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String((e && e.message) || e) }));
        }
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (e) {
      try { res.writeHead(500); res.end(String((e && e.message) || e)); } catch {}
    }
  });
  server.listen(MOBILE_PORT, "0.0.0.0", () => {
    try {
      fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] mobile server listening on 0.0.0.0:${MOBILE_PORT}\n`);
    } catch {}
  });
}

const MOBILE_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>群头衔</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f2f3f5;margin:0;padding:16px;color:#333}
  .card{background:#fff;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  h1{font-size:18px;margin:0 0 12px}
  label{display:block;font-size:12px;color:#888;margin:10px 0 4px}
  select,input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:16px;background:#f7f8fa;color:inherit}
  button{width:100%;padding:13px;margin-top:14px;border:none;border-radius:8px;font-size:16px;background:#0099ff;color:#fff}
  button.ghost{background:none;border:1px solid #ccc;color:#666}
  #toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;max-width:90vw}
  .status{font-size:12px;color:#999;margin-top:8px}
</style>
</head>
<body>
<h1>👑 群头衔设置</h1>
<div class="card">
  <label>群</label>
  <select id="group"><option>加载中…</option></select>
  <label>搜索成员（名片 / QQ昵称 / QQ号 / 头衔）</label>
  <input id="search" placeholder="输入关键字过滤">
  <label>成员</label>
  <select id="member" disabled><option>请先选择群</option></select>
  <label>头衔（最长 18 字；留空 = 清除）</label>
  <input id="title" placeholder="输入新头衔">
  <button id="set">设置头衔</button>
  <button id="clear" class="ghost">清除该成员头衔</button>
  <div class="status" id="status"></div>
</div>
<div id="toast"></div>
<script>
var KEY = new URLSearchParams(location.search).get("key") || "";
function api(path, data) {
  return fetch("/api" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-key": KEY },
    body: JSON.stringify(data || {})
  }).then(function (r) { return r.json(); });
}
function toast(msg, ok) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.style.opacity = "1";
  setTimeout(function () { t.style.opacity = "0"; }, 2200);
}
function status(s) { document.getElementById("status").textContent = s || ""; }
var members = [];
var groupSel = document.getElementById("group");
var memberSel = document.getElementById("member");
var searchEl = document.getElementById("search");
var titleEl = document.getElementById("title");

function loadMembers() {
  var gid = groupSel.value;
  if (!gid) return;
  memberSel.disabled = true;
  memberSel.innerHTML = "<option>加载中…</option>";
  titleEl.value = "";
  api("/get_group_member_list", { group_id: gid, no_cache: true }).then(function (r) {
    members = (r && r.data) || [];
    memberSel.innerHTML = "";
    members.forEach(function (m) {
      var o = document.createElement("option");
      o.value = String(m.user_id);
      o.textContent = (m.card || m.nickname || m.user_id) + (m.title ? "［" + m.title + "］" : "") + " (" + m.user_id + ")";
      o.dataset.search = [m.card, m.nickname, m.title, m.user_id].filter(Boolean).join(" ").toLowerCase();
      memberSel.appendChild(o);
    });
    memberSel.disabled = false;
    status("共 " + members.length + " 人");
    applyFilter();
  }).catch(function (e) { toast("成员加载失败：" + e.message); });
}
function applyFilter() {
  var kw = (searchEl.value || "").trim().toLowerCase();
  var vis = 0;
  for (var i = 0; i < memberSel.options.length; i++) {
    var o = memberSel.options[i];
    var hay = o.textContent.toLowerCase() + " " + (o.dataset.search || "");
    var show = !kw || hay.indexOf(kw) >= 0;
    o.style.display = show ? "" : "none";
    if (show) vis++;
  }
  if (kw && vis === 1) {
    for (var j = 0; j < memberSel.options.length; j++) {
      if (memberSel.options[j].style.display !== "none") { memberSel.selectedIndex = j; break; }
    }
    onMemberChange();
  }
}
function onMemberChange() {
  var uin = memberSel.value;
  var m = members.filter(function (x) { return String(x.user_id) === uin; })[0];
  titleEl.value = (m && m.title) || "";
}
function setTitle(v) {
  var gid = groupSel.value, uid = memberSel.value;
  if (!gid || !uid) { toast("请先选择群和成员"); return; }
  if (v.length > 18) { toast("头衔过长（>18字）"); return; }
  api("/set_group_special_title", { group_id: gid, user_id: uid, special_title: v }).then(function () {
    toast(v ? "✓ 已设置：" + v : "✓ 已清除");
    loadMembers();
  }).catch(function (e) { toast("失败：" + (e.message || e)); });
}
groupSel.addEventListener("change", loadMembers);
searchEl.addEventListener("input", function () { setTimeout(applyFilter, 150); });
memberSel.addEventListener("change", onMemberChange);
document.getElementById("set").addEventListener("click", function () { setTitle(titleEl.value.trim()); });
document.getElementById("clear").addEventListener("click", function () {
  if (confirm("确认清除该成员的专属头衔？")) setTitle("");
});

api("/get_group_list", {}).then(function (r) {
  var groups = (r && r.data) || [];
  groupSel.innerHTML = "";
  groups.forEach(function (g) {
    var o = document.createElement("option");
    o.value = String(g.group_id);
    o.textContent = g.group_name + " (" + g.member_count + ")";
    groupSel.appendChild(o);
  });
  status(groups.length + " 个群");
}).catch(function (e) {
  groupSel.innerHTML = "<option>群列表加载失败</option>";
  toast("请确认 PC 上 QQ 已启动：" + (e.message || e));
});
</script>
</body>
</html>`;

function writeProbe(payload) {
  try { fs.writeFileSync(PROBE_RESULT, JSON.stringify(payload)); } catch {}
}

async function probeTick() {
  let cmd = null;
  try {
    cmd = JSON.parse(fs.readFileSync(PROBE_CMD, "utf8"));
    fs.unlinkSync(PROBE_CMD);
  } catch { return; }

  if (probeBusy) { writeProbe({ ok: false, error: "busy" }); return; }
  probeBusy = true;
  try {
    const urls = [];
    const matches = [];
    for (const w of windows) {
      let url = "";
      try { url = w.webContents.getURL() || ""; } catch {}
      urls.push(url);
      if (!cmd.urlIncludes || url.includes(cmd.urlIncludes)) matches.push(w);
    }
    if (!matches.length) {
      writeProbe({ ok: false, error: "no matching window", urls });
      return;
    }
    if (cmd.all) {
      const results = [];
      for (const w of matches) {
        let url = "";
        try { url = w.webContents.getURL() || ""; } catch {}
        try {
          const r = await Promise.race([
            w.webContents.executeJavaScript(cmd.code, true),
            new Promise((_, rej) => setTimeout(() => rej(new Error("probe timeout 20s")), 20000))
          ]);
          results.push({ url, ok: true, result: r === undefined ? null : r });
        } catch (e) {
          results.push({ url, ok: false, error: String((e && e.message) || e) });
        }
      }
      writeProbe({ ok: true, all: results });
      return;
    }
    const result = await Promise.race([
      matches[0].webContents.executeJavaScript(cmd.code, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error("probe timeout 30s")), 30000))
    ]);
    writeProbe({ ok: true, result: result === undefined ? null : result });
  } catch (e) {
    writeProbe({ ok: false, error: String((e && e.message) || e) });
  }
  probeBusy = false;
}

exports.onBrowserWindowCreated = (window) => {
  try {
    windows.add(window);
    window.once("closed", () => windows.delete(window));
  } catch {}

  startMobileServer();

  if (!probeStarted) {
    probeStarted = true;
    setInterval(() => { probeTick().catch(() => {}); }, 600);
  }

  if (ipcMain.listenerCount("quick-title:set") > 0) return;

  ipcMain.handle("quick-title:set", async (_event, data) => {
    const group_id = String(data?.group_id ?? "").trim();
    const user_id = String(data?.user_id ?? "").trim();
    const special_title = String(data?.special_title ?? "");

    if (!/^\d+$/.test(group_id) || !/^\d+$/.test(user_id)) {
      throw new Error("群号和成员 QQ 号必须是数字");
    }

    if (special_title.length > 18) {
      throw new Error("头衔过长，请缩短后重试");
    }

    return await postJson("/set_group_special_title", {
      group_id,
      user_id,
      special_title
    });
  });

  ipcMain.handle("quick-title:api", async (_event, { path, data }) => {
    if (!READONLY_APIS.has(path)) {
      throw new Error(`不允许调用的接口：${path}`);
    }
    return await postJson(path, data ?? {});
  });

  ipcMain.handle("quick-title:debug", (_event, info) => {
    try {
      const line = typeof info === "string" ? info : JSON.stringify(info);
      fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${line}\n`);
    } catch {}
    return true;
  });
};
