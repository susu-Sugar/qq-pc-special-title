// 探针客户端：向插件写入 probe-command.json，等待 probe-result.json
// 用法：node tools/probe-client.js <probe-file.js> [urlIncludes]
// 路径可通过环境变量 QUICK_TITLE_PROBE_DIR 覆盖（默认当前目录）
const fs = require("fs");

const DIR = process.env.QUICK_TITLE_PROBE_DIR || ".";
const CMD = DIR + "/probe-command.json";
const RESULT = DIR + "/probe-result.json";

const code = fs.readFileSync(process.argv[2], "utf8");
const urlIncludes = process.argv[3] || "index.html";

try { fs.unlinkSync(RESULT); } catch {}
fs.writeFileSync(CMD, JSON.stringify({ urlIncludes, code }));

const deadline = Date.now() + 55000;
(function poll() {
  try {
    const r = fs.readFileSync(RESULT, "utf8");
    console.log(r.length > 4000 ? r.slice(0, 4000) + "\n...[truncated " + r.length + " bytes]" : r);
    return;
  } catch {}
  if (Date.now() > deadline) { console.log("TIMEOUT: 探针无结果（插件未加载或窗口不匹配）"); return; }
  setTimeout(poll, 500);
})();
