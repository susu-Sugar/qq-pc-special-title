// 探针示例：在 QQ 窗口执行一段 JS 并把结果取回（用于调试插件渲染层）
// 用法：
//   1. 确保插件已通过环境变量 QUICK_TITLE_PROBE_CMD / QUICK_TITLE_PROBE_RESULT
//      指向 probe-command.json / probe-result.json（或使用默认当前目录）
//   2. node tools/probe-client.js tools/probe-example.js
//   3. 输出即窗口内执行结果
(function () {
  // 示例：读取页面标题与当前可见文本量（替换为你要调试的任意逻辑）
  return {
    title: document.title,
    bodyLen: (document.body && document.body.innerText || "").length,
    url: location.href
  };
})()
