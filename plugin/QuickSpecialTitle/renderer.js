(() => {
  const dbg = (info) => { try { window.quickSpecialTitle?.debug?.(info); } catch {} };

  dbg({ t: "load", href: location.href });

  const MENU_SELECTOR = ".q-context-menu";
  const ITEM_CLASS = "quick-special-title-item";
  const GROUP_KEY = "quickSpecialTitle.lastGroupId";
  const AVATAR_KEY = "quickSpecialTitle.avatarCache";
  const NAMECACHE_KEY = "quickSpecialTitle.nameCache";

  // ---- 名字→QQ号 持久化缓存（群号 → uin → UI显示名）----
  // 消息正文对齐是唯一可靠的 DOM↔API 桥，学到的映射跨会话累积：
  // 成员即使很久不发言，只要之前对齐过一次，之后右键就能直接命中。
  let nameCache = {};
  try { nameCache = JSON.parse(localStorage.getItem(NAMECACHE_KEY) || "{}").map || {}; } catch {}
  function saveNameCache() {
    try {
      const slim = {};
      let total = 0;
      for (const [gid, m] of Object.entries(nameCache)) {
        slim[gid] = Object.fromEntries(Object.entries(m).slice(-300));
        total += Object.keys(slim[gid]).length;
        if (total > 3000) break;
      }
      localStorage.setItem(NAMECACHE_KEY, JSON.stringify({ v: 1, map: slim }));
    } catch {}
  }
  function setCachedName(gid, uin, nm) {
    if (!gid || !uin || !nm) return;
    (nameCache[gid] = nameCache[gid] || {})[String(uin)] = nm;
    saveNameCache();
  }

  // ---- 头像哈希 → QQ号 缓存（跨弹窗持久，名字无关的身份桥）----
  const avatarCache = new Map();     // s_hash -> uin
  const avatarConflicts = new Set(); // 多人共用哈希（如默认头像）→ 弃用
  try {
    const saved = JSON.parse(localStorage.getItem(AVATAR_KEY) || "{}");
    for (const [h, u] of Object.entries(saved.map || {})) avatarCache.set(h, String(u));
    for (const h of saved.conflicts || []) avatarConflicts.add(h);
  } catch {}
  function saveAvatarCache() {
    try {
      localStorage.setItem(AVATAR_KEY, JSON.stringify({
        map: Object.fromEntries([...avatarCache.entries()].slice(-500)),
        conflicts: [...avatarConflicts].slice(-100)
      }));
    } catch {}
  }
  function hashOfAvatarEl(el) {
    if (!el) return "";
    let style = "";
    try { style = (el.getAttribute && el.getAttribute("style")) || ""; } catch {}
    const m = style.match(/s_[0-9a-f]{16,}/);
    return m ? m[0] : "";
  }
  // 找带背景图的头像元素（消息结构里有无样式的 avatar-span 空壳，真头像可能在外层）
  function avatarElNear(el) {
    if (!el) return null;
    const sel = "[class*='avatar'][style*='background']";
    return el.querySelector(sel)
      || (el.parentElement ? el.parentElement.querySelector(sel) : null)
      || (el.closest("[class*='ml-item']") ? el.closest("[class*='ml-item']").querySelector(sel) : null);
  }
  function readAvatarHash(target) {
    if (!(target instanceof Element)) return "";
    const panelItem = target.closest("[class*='group-user']");
    if (panelItem && !String(panelItem.className).includes("group-user-list")) {
      return hashOfAvatarEl(panelItem.querySelector("[class*='group-user__avatar']"));
    }
    const msg = target.closest("[class*='message-container'],[class*='ml-item']");
    if (msg) return hashOfAvatarEl(msg.querySelector("[class*='avatar']"));
    return "";
  }
  function learnAvatar(hash, uin) {
    if (!hash || !uin) return;
    if (avatarConflicts.has(hash)) return;
    const prev = avatarCache.get(hash);
    if (prev && prev !== uin) {
      avatarConflicts.add(hash);
      avatarCache.delete(hash);
      saveAvatarCache();
      return;
    }
    if (!prev) { avatarCache.set(hash, uin); saveAvatarCache(); }
  }

  let lastTarget = null;

  // ---- API 封装 ----
  const api = (path, data) => window.quickSpecialTitle?.api?.({ path, data });

  // ---- DOM 识别（QQNT 生产版不在 DOM 上暴露 Vue 数据，改用文本匹配）----

  // 当前聊天区顶部的群名（去掉尾部的成员数 "(N)"）
  function readChatGroupName() {
    const el = document.querySelector(".chat-header__contact-name")
      || document.querySelector(".chat-header__title")
      || document.querySelector(".panel-header__title");
    if (!el) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim().replace(/\s*\(\d+\)\s*$/, "").trim();
  }

  // 清理 QQ 残留的右键菜单与遮罩，避免挡住弹窗交互（QQ 每次右键会重新创建）
  function clearQqMenuLeftovers() {
    try {
      document.querySelectorAll(".q-context-menu__overlay, .q-context-menu").forEach((el) => el.remove());
    } catch {}
  }

  function stripRoleLabel(text) {
    return String(text || "").replace(/\s+/g, " ").trim().replace(/\s*(群主|管理员|成员)\s*$/, "").trim();
  }

  // 右键目标 → 成员显示名（两个场景：右侧成员面板、聊天区消息）
  function readMemberName(target) {
    if (!(target instanceof Element)) return "";
    // 场景1：成员列表面板项（排除列表容器本身）
    const listItem = target.closest("[class*='group-user']");
    if (listItem && !String(listItem.className).includes("group-user-list")) {
      const content = listItem.querySelector("[class*='group-user__content']") || listItem;
      return stripRoleLabel(content.textContent || "");
    }
    // 场景2：聊天区消息。回复引用里嵌套着内层消息容器，必须爬到最外层，
    // 否则会抓到"被引用者"的名字（reply-title）而不是真正发送者
    let msg = target.closest("[class*='message-container'],[class*='ml-item']");
    if (msg) {
      while (true) {
        const next = msg.parentElement?.closest?.("[class*='message-container'],[class*='ml-item']");
        if (!next) break;
        msg = next;
      }
      let nameEl = msg.querySelector(".user-name");
      if (!nameEl) nameEl = msg.querySelector("[class*='user-name'],[class*='username']");
      if (nameEl) return stripRoleLabel(nameEl.textContent || "");
    }
    return "";
  }

  // 全半角折叠：名字里的括号/下划线/破折号 QQ 显示可能与 API 存储宽度不一致；
  // 连续空白也压成单空格（API 返回的 nick 可能带多个空格，DOM 侧经 stripRoleLabel 已压缩）
  function foldWidth(s) {
    return String(s || "")
      .replace(/（/g, "(").replace(/）/g, ")")
      .replace(/［/g, "[").replace(/］/g, "]")
      .replace(/【/g, "[").replace(/】/g, "]")
      .replace(/＿/g, "_").replace(/—|–/g, "-")
      .replace(/\s+/g, " ");
  }

  // QQ 消息区会在成员名前拼等级徽章/王者段位（LV100、王者、钻石…），与名册无关，匹配前剥掉。
  // 长词在前保证最长优先（荣耀王者 先于 王者）。
  const BADGE_RE = /^(LV\d+|荣耀王者|最强王者|无双王者|钻石|星耀|铂金|黄金|白银|青铜|王者)\s*/;
  function stripBadge(s) {
    return String(s || "").replace(BADGE_RE, "").trim();
  }

  // 每个成员的"可能显示形态"：QQ 会把等级/头衔/身份拼在名字前
  // （如"王者小甲""群主小乙""LV100示例大学…"），头衔与名字之间可能无分隔或带 _ / 空格
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

  // 群名 → 群号（NapCat 群列表匹配）
  async function resolveGroupIdByName(groupName) {
    if (!groupName) return { id: "", how: "no-name" };
    try {
      const resp = await api("/get_group_list", {});
      const groups = resp?.data ?? [];
      const hit = groups.filter((g) => String(g.group_name || "").replace(/\s+/g, " ").trim() === groupName);
      if (hit.length === 1) return { id: String(hit[0].group_id), how: "name-unique", name: groupName };
      if (hit.length > 1) return { id: String(hit[0].group_id), how: "name-dup:" + hit.length, name: groupName };
      return { id: "", how: "name-not-found" };
    } catch (e) {
      return { id: "", how: "api-fail:" + (e?.message || e) };
    }
  }

  // ---- DOM 弹窗（Electron 不支持 window.prompt）----
  // rows 按传入顺序渲染：{ kind: "input"|"select", key, label, value?, placeholder?, populate?(control,label) }
  function showModal({ title, rows, onOk }) {
    const old = document.getElementById("qst-modal");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "qst-modal";
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647",
      "background:rgba(0,0,0,.4)", "display:flex",
      "align-items:center", "justify-content:center"
    ].join(";");

    const box = document.createElement("div");
    box.style.cssText = [
      "background:var(--background_Standard,#fff)", "color:var(--text_primary,#333)",
      "border-radius:10px", "padding:18px 20px", "min-width:340px",
      "box-shadow:0 8px 30px rgba(0,0,0,.25)", "font-size:14px"
    ].join(";");

    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText = "font-weight:600;margin-bottom:12px";
    box.appendChild(h);

    const controls = {};

    for (const row of rows) {
      const label = document.createElement("div");
      label.textContent = row.label;
      label.style.cssText = "margin:8px 0 4px;color:var(--text_secondary,#888);font-size:12px";
      box.appendChild(label);

      let control;
      if (row.kind === "select") {
        control = document.createElement("select");
      } else {
        control = document.createElement("input");
        control.value = row.value ?? "";
        control.placeholder = row.placeholder ?? "";
      }
      control.dataset.key = row.key;
      control.style.cssText = [
        "width:100%", "box-sizing:border-box", "padding:7px 10px",
        "border:1px solid var(--border-primary,#ddd)", "border-radius:6px",
        "background:var(--background_2,#f7f7f7)", "color:inherit", "font-size:14px",
        "caret-color:var(--text_primary,#333)",
        "cursor:" + (row.kind === "select" ? "pointer" : "text")
      ].join(";");
      controls[row.key] = control;
      box.appendChild(control);

      if (row.populate) row.populate(control, label);
    }

    const tip = document.createElement("div");
    tip.style.cssText = "margin-top:10px;color:var(--text_secondary,#999);font-size:12px;min-height:16px";
    box.appendChild(tip);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "margin-top:12px;display:flex;justify-content:flex-end;gap:10px";

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "取消";
    btnCancel.style.cssText = "padding:6px 16px;border-radius:6px;border:1px solid var(--border-primary,#ccc);background:transparent;color:inherit;cursor:pointer";

    const btnOk = document.createElement("button");
    btnOk.textContent = "确定";
    btnOk.style.cssText = "padding:6px 16px;border-radius:6px;border:none;background:var(--brand_standard,#0099ff);color:#fff;cursor:pointer";

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnOk);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    btnCancel.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    btnOk.onclick = () => {
      const values = {};
      for (const row of rows) {
        values[row.key] = row.kind === "select" ? controls[row.key].value : controls[row.key].value.trim();
      }
      const missing = rows.find((row) => !row.optional && !values[row.key]);
      if (missing) {
        tip.textContent = `请填写：${missing.label}`;
        return;
      }
      close();
      onOk(values);
    };
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnOk.click();
      if (e.key === "Escape") close();
    });
  }

  // 非阻塞浮动通知（自动消失，免点确定）
  function showToast(text, ms = 2500) {
    const old = document.getElementById("qst-toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "qst-toast";
    t.textContent = text;
    t.style.cssText = [
      "position:fixed", "top:24px", "left:50%", "transform:translateX(-50%)",
      "z-index:2147483647", "padding:10px 22px", "border-radius:8px",
      "background:rgba(0,0,0,.78)", "color:#fff", "font-size:14px",
      "box-shadow:0 4px 16px rgba(0,0,0,.3)", "pointer-events:none",
      "transition:opacity .3s", "opacity:1"
    ].join(";");
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 350);
    }, ms);
  }

  function openTitleModal() {
    clearQqMenuLeftovers();
    const groupName = readChatGroupName();
    const memberName = readMemberName(lastTarget);
    const savedGroup = localStorage.getItem(GROUP_KEY) || "";
    dbg({ t: "ctx", groupName, memberName, savedGroup });

    const titleByUser = new Map(); // user_id -> 当前头衔
    const freshByUin = new Map();  // user_id -> 界面最新名（消息对齐反推）
    let memberNameForPreselect = memberName;

    // 消息文本归一化（去空白 + 全半角折叠），作为 DOM↔API 对齐的钥匙
    function normText(s) {
      return foldWidth(String(s || "")).replace(/\s+/g, "");
    }

    // 拉取最近消息历史，用消息文本对齐 DOM，反推"界面新名字 → QQ号"映射。
    // 背景：QQ 渲染层显示的名字（成员改的最新昵称/名片）比内核名册新，
    // 名册接口（含 no_cache、stranger_info、消息历史）全部滞后，
    // 唯一可靠的对齐方式是消息正文——两边正文一致，名字即可对应到 uin。
    async function buildFreshNames(gid) {
      try {
        // count 拉大 + 正文门槛放宽：QQ 多级缓存滞后时，消息正文是唯一可靠对齐钥匙
        const resp = await api("/get_group_msg_history", { group_id: gid, count: 300 });
        const msgs = resp?.data?.messages ?? [];
        if (!msgs.length) return;
        // 首选：message_id 精确对齐（DOM ml-item 的 id 即 message_id，与消息类型无关）
        const uinByMsgId = new Map();
        for (const m of msgs) uinByMsgId.set(String(m.message_id), String(m.sender?.user_id ?? ""));
        let idAligned = 0;
        for (const el of document.querySelectorAll("[class*='ml-item']")) {
          const mid = el.id ? String(el.id) : "";
          if (!mid) continue;
          const uin = uinByMsgId.get(mid);
          if (!uin) continue;
          const nameEl = el.querySelector(".user-name");
          if (!nameEl) continue;
          const nm = stripBadge(stripRoleLabel(nameEl.textContent || ""));
          if (nm) { freshByUin.set(uin, nm); setCachedName(gid, uin, nm); idAligned++; }
          learnAvatar(hashOfAvatarEl(avatarElNear(el)), uin);
        }
        // 兜底：消息正文对齐（覆盖 ml-item 无 id 的情况）。
        // 同一文本被多人发过时标记冲突，冲突文本不参与对齐——否则会把错误的名字
        // 学到 freshByUin/nameCache，造成后续永久误配
        const textMap = new Map();
        const textConflicts = new Set();
        for (const m of msgs) {
          const segs = Array.isArray(m.message) ? m.message : [];
          const txt = normText(segs.map((s) => s?.data?.text ?? "").join(""));
          if (txt.length < 4) continue;
          const sender = String(m.sender?.user_id ?? "");
          if (textMap.has(txt)) {
            if (textMap.get(txt) !== sender) { textMap.delete(txt); textConflicts.add(txt); }
          } else if (!textConflicts.has(txt)) {
            textMap.set(txt, sender);
          }
        }
        let textAligned = 0;
        for (const el of document.querySelectorAll("[class*='message-container']")) {
          const nameEl = el.querySelector(".user-name");
          const contentEl = el.querySelector("[class*='message-content']");
          if (!nameEl || !contentEl) continue;
          const txt = normText(contentEl.textContent || "");
          if (txt.length < 4 || textConflicts.has(txt)) continue;
          let uin = textMap.get(txt);
          if (!uin) {
            for (const [k, v] of textMap) {
              if (k.length >= 8 && (txt.includes(k) || k.includes(txt))) { uin = v; break; }
            }
          }
          if (!uin) continue;
          const nm = stripBadge(stripRoleLabel(nameEl.textContent || ""));
          if (nm && !freshByUin.has(uin)) { freshByUin.set(uin, nm); textAligned++; setCachedName(gid, uin, nm); }
          learnAvatar(hashOfAvatarEl(avatarElNear(el)), uin);
        }
        dbg({ t: "fresh-names", byId: idAligned, byText: textAligned, names: [...freshByUin.entries()].slice(0, 8).map(([u, n]) => u + ":" + n) });
      } catch (e) {
        dbg({ t: "fresh-names-fail", error: String(e?.message || e) });
      }
    }

    const loadMembers = (select, label) => {
      const gidInput = document.querySelector("#qst-modal [data-key='group_id']");
      const gid = gidInput?.value.trim() || "";
      if (!/^\d+$/.test(gid)) {
        select.innerHTML = "";
        const o = document.createElement("option");
        o.textContent = "请先填写群号";
        select.appendChild(o);
        return;
      }
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.textContent = "加载中…";
      select.appendChild(opt);
      api("/get_group_member_list", { group_id: gid, no_cache: true })
        .then(async (resp) => {
          select.innerHTML = "";
          const members = resp?.data ?? [];
          if (!members.length) {
            const o = document.createElement("option");
            o.textContent = "未获取到成员（确认群号正确）";
            select.appendChild(o);
            return;
          }
          // 消息对齐反推界面最新名（名册缓存滞后时的关键补充）
          await buildFreshNames(gid);
          for (const m of members) {
            const o = document.createElement("option");
            o.value = String(m.user_id);
            const fresh = freshByUin.get(String(m.user_id));
            const rosterName = m.card || m.nickname || m.user_id;
            const name = fresh && fresh !== rosterName ? `${fresh}（册:${rosterName}）` : rosterName;
            const title = m.title ? `［${m.title}］` : "";
            o.textContent = `${name}${title} (${m.user_id})`;
            // 搜索索引：界面名 + 群名片 + QQ昵称 + 头衔 + QQ号 全字段
            o.dataset.search = [fresh, m.card, m.nickname, m.title, m.user_id].filter(Boolean).join(" ").toLowerCase();
            select.appendChild(o);
            titleByUser.set(String(m.user_id), m.title || "");
          }
          label.textContent = `选择成员（共 ${members.length} 人）`;

          // 占位项：未识别到右键成员时强制手动选择，不再静默选中第一个
          const ph = document.createElement("option");
          ph.value = "";
          ph.textContent = "— 未识别到右键成员，请手动选择 —";
          select.prepend(ph);

          // 按右键成员的显示名预选。QQ 展示名可能是 [头衔/身份]+名字 的拼接
          // （"王者小甲""群主小乙""LV100示例大学小丙（...）"），因此对每个成员生成
          // 变体集合再比对；精确匹配任意长度，模糊匹配要求名字 ≥2 字防误报。
          // 头像优先：精确且不受改名/名册滞后影响（历史学过的头像哈希直接命中）
          let avatarHit = "";
          const avHash = readAvatarHash(lastTarget);
          if (avHash && !avatarConflicts.has(avHash)) {
            const u = avatarCache.get(avHash);
            if (u && members.some((x) => String(x.user_id) === u)) avatarHit = u;
          }
          if (avatarHit) {
            select.value = avatarHit;
            const mm = members.find((x) => String(x.user_id) === avatarHit);
            label.textContent = `选择成员（已定位·头像：${(mm && (mm.card || mm.nickname)) || avatarHit}）`;
            dbg({ t: "preselect-avatar", hash: avHash.slice(0, 12), uin: avatarHit });
          } else if (memberNameForPreselect) {
            // 显示名 = [等级/段位徽章] + [专属头衔] + 名字，徽章与名册无关先剥掉；
            // 保留原始名与剥后名两个候选分别匹配（防真名恰好以"王者/LV"开头的成员）
            const baseName = foldWidth(memberNameForPreselect);
            const nameCands = [baseName.replace(/^LV\d+\s*/, ""), stripBadge(baseName)];
            // 子串匹配约束：field 作为 name 的完整子串时必须足够长且占比较大。
            // 否则"电子科技大学成电小星星".includes("成") 这种单字短昵称会大面积误配
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
                    else if ((hit = containsHit(name, field)) > 0) { /* name 包含 field，且 field 足够长可信 */ }
                    else if (field.includes(name)) hit = name.length; // 变体带头衔/身份前缀，名字是其子串
                    if (hit > bestLen) { bestLen = hit; best = x; }
                  }
                }
                // 显示名以该成员专属头衔开头（QQ 拼成 title+名字 / title_名字）：
                // 剥掉头衔后用剩余部分再匹配名册名（名册未滞后时的常见形态）
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
                        else if ((hit = containsHit(rest, field)) > 0) { /* rest 包含 field，且 field 足够长可信 */ }
                        else if (field.includes(rest)) hit = rest.length;
                        if (hit > bestLen) { bestLen = hit; best = x; }
                      }
                    }
                  }
                }
              }
            }
            if (best) {
              select.value = String(best.user_id);
              const shownName = freshByUin.get(String(best.user_id)) || (nameCache[gid] && nameCache[gid][String(best.user_id)]) || best.card || best.nickname;
              label.textContent = `选择成员（已定位：${shownName}）`;
              dbg({ t: "preselect", memberName: memberNameForPreselect, uin: best.user_id, card: String(best.card || ""), nick: String(best.nickname || "") });
            } else {
              select.value = "";
              // 兜底：把（剥徽章后的）右键名自动填入搜索框，直接呈现过滤候选
              const searchEl = document.getElementById("qst-modal")?.querySelector("[data-key='member_search']");
              if (searchEl && !searchEl.value) {
                searchEl.value = stripBadge(baseName);
                searchEl.dispatchEvent(new Event("input"));
              }
              dbg({ t: "preselect-none", memberName: memberNameForPreselect });
            }
          } else {
            select.value = "";
          }
          select.dispatchEvent(new Event("change"));
          applyMemberFilter();
        })
        .catch((e) => {
          select.innerHTML = "";
          const o = document.createElement("option");
          o.textContent = `成员列表获取失败：${e.message}`;
          select.appendChild(o);
          dbg({ t: "member-list-fail", error: String(e.message || e) });
        });
    };

    const groupLabelDefault = groupName
      ? `群号（识别当前群中：${groupName}）`
      : (savedGroup ? "群号（上次使用，当前不在群聊界面）" : "群号（未能自动识别，请填写）");

    showModal({
      title: "设置专属头衔",
      rows: [
        { kind: "input", key: "group_id", label: groupLabelDefault, value: savedGroup },
        { kind: "input", key: "member_search", label: "搜索过滤（界面名/名册名/QQ号/头衔，定位失败时用）", value: "", placeholder: "输入关键字过滤成员列表", optional: true },
        {
          kind: "select", key: "user_id", label: memberName ? `选择成员（已右键：${memberName}）` : "选择成员",
          populate: (select, label) => {
            loadMembers(select, label);
            // 选中成员变化时，把该成员的当前头衔自动填入输入框（防止误清空）
            select.addEventListener("change", () => {
              const titleInput = document.querySelector("#qst-modal [data-key='special_title']");
              if (titleInput) titleInput.value = titleByUser.get(select.value) ?? "";
            });
          }
        },
        { kind: "input", key: "special_title", label: "专属头衔（最长 18 字；留空 = 清除头衔）", value: "", placeholder: "输入新头衔，选中成员后自动带出当前头衔" }
      ],
      onOk: async (v) => {
        // 留空提交 = 清除头衔，必须二次确认，防止误触
        if (!v.special_title && !confirm("头衔为空：确认清除该成员的专属头衔？")) {
          dbg({ t: "clear-cancelled", user_id: v.user_id });
          return;
        }
        try {
          if (!window.quickSpecialTitle?.setTitle) {
            throw new Error("插件 IPC 未就绪，请检查 LiteLoader 加载情况");
          }
          localStorage.setItem(GROUP_KEY, v.group_id);
          await window.quickSpecialTitle.setTitle({
            group_id: v.group_id,
            user_id: v.user_id,
            special_title: v.special_title
          });
          dbg({ t: "set-ok", ...v });
          showToast(v.special_title
            ? `✓ 头衔已设置：${v.special_title}`
            : `✓ 头衔已清除`, 2500);
        } catch (error) {
          console.error("[QuickSpecialTitle]", error);
          dbg({ t: "set-fail", error: String(error?.message || error) });
          alert(`设置失败：${error?.message || error}`);
        }
      }
    });

    const modal = document.getElementById("qst-modal");
    const groupInput = modal?.querySelector("[data-key='group_id']");
    const groupLabelEl = modal?.querySelector("[data-key='group_id']")?.previousElementSibling;
    let debounceTimer = null;

    // 搜索过滤：按选项文本（界面名+名册名+QQ号+头衔）过滤，唯一命中自动选中
    function applyMemberFilter() {
      const mEl = document.getElementById("qst-modal");
      if (!mEl) return;
      const searchEl = mEl.querySelector("[data-key='member_search']");
      const sel = mEl.querySelector("select[data-key='user_id']");
      if (!sel) return;
      const kw = ((searchEl && searchEl.value) || "").trim().toLowerCase();
      const visible = [];
      for (const o of sel.options) {
        const isPlaceholder = !o.value;
        const hay = (String(o.textContent) + " " + (o.dataset.search || "")).toLowerCase();
        const show = !kw || isPlaceholder || hay.includes(kw);
        o.style.display = show ? "" : "none";
        if (show && !isPlaceholder) visible.push(o);
      }
      if (kw && visible.length === 1) {
        sel.value = visible[0].value;
        sel.dispatchEvent(new Event("change"));
      }
    }
    {
      const searchInput = modal?.querySelector("[data-key='member_search']");
      let searchTimer = null;
      searchInput?.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyMemberFilter, 200);
      });
    }

    // 异步：群名 → 群号，成功后自动加载成员
    if (groupName) {
      resolveGroupIdByName(groupName).then(({ id, how, name }) => {
        if (!document.getElementById("qst-modal")) return; // 弹窗已关
        if (id && groupInput) {
          groupInput.value = id;
          if (groupLabelEl) groupLabelEl.textContent = `群号（已识别当前群：${name}）`;
          dbg({ t: "group-resolved", id, how });
          const select = modal.querySelector("select[data-key='user_id']");
          const label = select?.previousElementSibling;
          if (select && label) loadMembers(select, label);
        } else if (groupLabelEl) {
          groupLabelEl.textContent = `群号（群名匹配失败：${how}，请手动填写）`;
          dbg({ t: "group-resolve-fail", how });
        }
      });
    }

    // 手动改群号时联动刷新成员列表
    groupInput?.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        memberNameForPreselect = ""; // 群变了，按名预选失效
        const select = modal?.querySelector("select[data-key='user_id']");
        const label = select?.previousElementSibling;
        if (select && label) loadMembers(select, label);
      }, 600);
    });
    if (savedGroup && !groupName) groupInput?.dispatchEvent(new Event("input"));
  }

  function addMenuItem(menu) {
    if (!(menu instanceof HTMLElement)) return;
    if (menu.querySelector(`.${ITEM_CLASS}`)) return;

    const item = document.createElement("div");
    item.className = `${ITEM_CLASS} q-context-menu-item q-context-menu-item--normal`;
    item.style.cssText = "display:flex;align-items:center;gap:8px;user-select:none";

    const text = document.createElement("span");
    text.className = "q-context-menu-item__text";
    text.textContent = "设置专属头衔";
    item.appendChild(text);

    item.addEventListener("mouseenter", () => {
      item.style.background = "var(--background-hover,rgba(127,127,127,.12))";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });

    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTitleModal();
    });

    menu.appendChild(item);
    dbg({ t: "item-added" });
  }

  function scanMenus() {
    document.querySelectorAll(MENU_SELECTOR).forEach(addMenuItem);
  }

  const observer = new MutationObserver(scanMenus);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("contextmenu", (event) => {
    lastTarget = event.target;
    setTimeout(scanMenus, 0);
    setTimeout(scanMenus, 100);
    setTimeout(scanMenus, 500);
  }, true);

  setInterval(scanMenus, 1500);

  console.info("[QuickSpecialTitle] 已加载");
})();
