// QuickSpecialTitle 预选匹配逻辑单测（与 renderer.js 中逻辑同步复制，验证修复效果）
// 运行：node tests/test-match.js
// 说明：用例夹具为虚构数据，仅保留真实场景的名字形态（头衔+名字、LV/徽章前缀、下划线分隔等）

// ===== 与 renderer.js 同步的纯函数 =====
function foldWidth(s) {
  return String(s || "")
    .replace(/（/g, "(").replace(/）/g, ")")
    .replace(/［/g, "[").replace(/］/g, "]")
    .replace(/【/g, "[").replace(/】/g, "]")
    .replace(/＿/g, "_").replace(/—|–/g, "-")
    .replace(/\s+/g, " ");
}
const BADGE_RE = /^(LV\d+|荣耀王者|最强王者|无双王者|钻石|星耀|铂金|黄金|白银|青铜|王者)\s*/;
function stripBadge(s) {
  return String(s || "").replace(BADGE_RE, "").trim();
}
function buildVariants(m) {
  const title = String(m.title || "").trim();
  const role = m.role === "owner" ? "群主" : m.role === "admin" ? "管理员" : "";
  const lv = String(m.level || "").trim();
  const bases = [String(m.card || "").trim(), String(m.nickname || "").trim()].filter(Boolean);
  const variants = new Set();
  for (const b of bases) {
    variants.add(b);
    if (/^\d+$/.test(lv)) variants.add("LV" + lv + b);
    if (title) {
      variants.add(title + b);
      variants.add(title + "_" + b);
      variants.add(title + " " + b);
    }
    if (role) variants.add(role + b);
    if (title && role) variants.add(role + title + b);
  }
  return [...variants];
}
function stripRoleLabel(text) {
  return String(text || "").replace(/\s+/g, " ").trim().replace(/\s*(群主|管理员|成员)\s*$/, "").trim();
}

// ===== 预选匹配循环（与 renderer.js preselect 分支同步）=====
function preselect(memberNameForPreselect, members, freshByUin, nameCache, gid) {
  const baseName = foldWidth(memberNameForPreselect);
  const nameCands = [baseName.replace(/^LV\d+\s*/, ""), stripBadge(baseName)];
  // 子串匹配约束：field 作为 name 的完整子串时必须足够长且占比较大，
  // 防止"示例大学电气小星星".includes("星") 这类单字短昵称大面积误配
  const containsHit = (name, field) => {
    if (!name.includes(field)) return 0;
    if (field.length < 4) return 0;
    if (field.length * 2 < name.length) return 0;
    return field.length;
  };
  let best = null, bestLen = 0;
  for (const x of members) {
    const uid = String(x.user_id);
    const freshName = freshByUin.get(uid);
    const cachedName = nameCache[gid] && nameCache[gid][uid];
    const vs = buildVariants(x);
    if (freshName && !vs.includes(freshName)) {
      const t2 = String(x.title || "").trim();
      const r2 = x.role === "owner" ? "群主" : x.role === "admin" ? "管理员" : "";
      vs.push(freshName);
      if (t2) vs.push(t2 + freshName);
      if (r2) vs.push(r2 + freshName);
    }
    if (cachedName && cachedName !== freshName && !vs.includes(cachedName)) vs.push(cachedName);
    const titleF = foldWidth(String(x.title || "").trim());
    for (const name of nameCands) {
      if (!name) continue;
      for (const v of vs) {
        const field = foldWidth(v);
        if (!field) continue;
        if (field === name) {
          if (field.length * 2 > bestLen) { bestLen = field.length * 2; best = x; }
          continue;
        }
        if (name.length >= 2) {
          let hit = 0;
          if (field.startsWith(name) || name.startsWith(field)) hit = field.length;
          else if ((hit = containsHit(name, field)) > 0) { /* name 包含 field 且足够长可信 */ }
          else if (field.includes(name)) hit = name.length;
          if (hit > bestLen) { bestLen = hit; best = x; }
        }
      }
      if (titleF && name.startsWith(titleF)) {
        const rest = name.slice(titleF.length).replace(/^[_ ]+/, "").trim();
        if (rest) {
          for (const v of vs) {
            const field = foldWidth(v);
            if (!field) continue;
            if (field === rest) {
              if (field.length * 2 > bestLen) { bestLen = field.length * 2; best = x; }
              continue;
            }
            if (rest.length >= 2) {
              let hit = 0;
              if (field.startsWith(rest) || rest.startsWith(field)) hit = field.length;
              else if ((hit = containsHit(rest, field)) > 0) { /* rest 包含 field 且足够长可信 */ }
              else if (field.includes(rest)) hit = rest.length;
              if (hit > bestLen) { bestLen = hit; best = x; }
            }
          }
        }
      }
    }
  }
  return best ? String(best.user_id) : null;
}

// ===== 用例 =====
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | got=${got} want=${want}`);
}

// ---- 修复目标：三个失败案例（名册滞后，无 freshName、无头像缓存）----
// 案例1：头衔test测试员(小明)，名册 nick 为旧值"旧昵称A"
{
  const members = [{ user_id: 900001, card: "", nickname: "旧昵称A", title: "头衔test", level: "100", role: "admin" }];
  const fresh = new Map();
  // 1a. 无缓存：名册全滞后 → 不应误配到该成员（正确行为：走手动兜底）
  check("案例1a 无缓存不误配", preselect("头衔test测试员(小明)", members, fresh, {}, "80001"), null);
  // 1b. 有持久化缓存（之前消息对齐学过）→ 必须命中
  check("案例1b 缓存命中", preselect("头衔test测试员(小明)", members, fresh, { "80001": { "900001": "测试员(小明)" } }, "80001"), "900001");
  // 1c. 名册未滞后（nick 已是新值）→ 头衔剥离后命中
  const m2 = [{ user_id: 900001, card: "", nickname: "测试员(小明)", title: "头衔test", level: "100", role: "admin" }];
  check("案例1c 名册新+头衔剥离命中", preselect("头衔test测试员(小明)", m2, fresh, {}, "80001"), "900001");
}

// 案例2：LV100示例大学示例大学-小星星
{
  const members = [{ user_id: 900002, card: "", nickname: "旧昵称B", title: "示例大学", level: "100", role: "member" }];
  const fresh = new Map();
  check("案例2a 无缓存不误配", preselect("LV100示例大学示例大学-小星星", members, fresh, {}, "80002"), null);
  check("案例2b 缓存命中", preselect("LV100示例大学示例大学-小星星", members, fresh, { "80002": { "900002": "示例大学-小星星" } }, "80002"), "900002");
  const m2 = [{ user_id: 900002, card: "", nickname: "示例大学-小星星", title: "示例大学", level: "100", role: "member" }];
  check("案例2c 名册新+LV剥离+头衔剥离命中", preselect("LV100示例大学示例大学-小星星", m2, fresh, {}, "80002"), "900002");
}

// 案例3：王者示例校_新酱 / 示例校_新酱（徽章前缀 + 头衔 + 下划线分隔）
{
  const members = [{ user_id: 900003, card: "旧昵称C", nickname: "旧昵称D", title: "示例校", level: "", role: "member" }];
  const fresh = new Map();
  check("案例3a 无缓存不误配(王者前缀)", preselect("王者示例校_新酱", members, fresh, {}, "80001"), null);
  check("案例3b 缓存命中", preselect("王者示例校_新酱", members, fresh, { "80001": { "900003": "新酱" } }, "80001"), "900003");
  const m2 = [{ user_id: 900003, card: "", nickname: "新酱", title: "示例校", level: "", role: "member" }];
  check("案例3c 名册新+徽章/头衔/下划线命中", preselect("示例校_新酱", m2, fresh, {}, "80001"), "900003");
}

// ---- 回归：原有成功案例仍应命中 ----
// 有群昵称常规
{
  const members = [{ user_id: 900004, card: "测试名片", nickname: "旧昵称E", title: "示例大学", level: "73", role: "member" }];
  const fresh = new Map([["900004", "示例大学测试名片"]]);
  check("回归A freshName命中(LV73)", preselect("LV73示例大学测试名片", members, fresh, {}, "80002"), "900004");
  // 无 freshName，但名册新：title 剥离后 card 命中
  check("回归A2 无fresh头衔剥离命中", preselect("LV73示例大学测试名片", members, new Map(), {}, "80002"), "900004");
}
// 无群昵称 + freshName（王者新昵称F：显示名=徽章+新昵称，名册旧）
{
  const members = [{ user_id: 900005, card: "", nickname: "旧昵称G", title: "", level: "100", role: "member" }];
  const fresh = new Map([["900005", "新昵称F"]]); // 剥徽章后的 freshName
  check("回归B freshName命中(无群昵称)", preselect("王者新昵称F", members, fresh, {}, "80003"), "900005");
}
// 多空格昵称（foldWidth 空白归一）
{
  const members = [{ user_id: 900006, card: "", nickname: "O  o  。", title: "示例大学", level: "", role: "member" }];
  const fresh = new Map([["900006", "O o 。"]]);
  check("回归C 多空格归一", preselect("O o 。", members, fresh, {}, "80002"), "900006");
}
// 单字名精确匹配（成员名册未滞后）
{
  const members = [{ user_id: 900007, card: "", nickname: "主", title: "示例公司", level: "", role: "owner" }];
  check("回归D 单字名(群主主, 名册新)", preselect("群主主", members, new Map(), {}, "80002"), "900007");
}

// 案例4（本次误配修复）：右键"LV100示例大学电气小星星"被 900008（nick="星"）误配
{
  const fake = { user_id: 900008, card: "测试名片乙", nickname: "星", title: "示例大学乙", level: "1", role: "member" };
  const target = { user_id: 900002, card: "", nickname: "旧昵称B", title: "示例大学", level: "100", role: "member" };
  const members = [fake, target];
  const fresh = new Map();
  // 4a. 无缓存、名册均滞后：绝不能误配到 900008（"星"是"…电气小星星"的子串）
  check("案例4a 单字短昵称不误配", preselect("LV100示例大学电气小星星", members, fresh, {}, "80002"), null);
  // 4b. 有正确 freshName（消息对齐学到了新名）→ 命中目标 900002
  const fresh2 = new Map([["900002", "电气小星星"]]);
  check("案例4b freshName命中目标", preselect("LV100示例大学电气小星星", members, fresh2, {}, "80002"), "900002");
  // 4c. 名册已更新（nick=电气小星星）→ 头衔剥离命中目标
  const m2 = [{ user_id: 900008, card: "测试名片乙", nickname: "星", title: "示例大学乙", level: "1", role: "member" },
              { user_id: 900002, card: "", nickname: "电气小星星", title: "示例大学", level: "100", role: "member" }];
  check("案例4c 名册新+头衔剥离命中目标", preselect("LV100示例大学电气小星星", m2, fresh, {}, "80002"), "900002");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
