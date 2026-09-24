// 行程大侦探 · 前端逻辑(线上纯静态版)
// SYSTEM_PROMPT / DEFAULT_API_URL / DEFAULT_MODEL 由 js/prompt.js 提供。
// 请求由浏览器直接发往用户填写的 OpenAI 兼容接口。
"use strict";

if (typeof SYSTEM_PROMPT === "undefined"){
  alert("提示词脚本未加载,请确认 js/prompt.js 存在");
}

const chatEl      = document.getElementById("chat");
const keyEl       = document.getElementById("key");
const modelEl     = document.getElementById("model");
const apiUrlEl    = document.getElementById("apiUrl");
const inputEl     = document.getElementById("input");
const sendBtn     = document.getElementById("send");
const retryBtn    = document.getElementById("retry");
const newCaseBtn  = document.getElementById("newCase");
const toggleCfgBtn= document.getElementById("toggleConfig");
const configPanel = document.getElementById("configPanel");
const verdictBar  = document.getElementById("verdictBar");
const cluePanel   = document.getElementById("cluePanel");

let messages = [];       // 完整对话历史(含 system / user / assistant)
let lastUserTurn = null; // 上一次"待回答"的消息快照,供"重新侦查"使用
let lastPlan = null;     // 最近一次解析出的行程 JSON,供导出使用

// ---------------- 记忆配置(仅保存在本浏览器) ----------------
const savedKey   = localStorage.getItem("ds_key");
const savedModel = localStorage.getItem("ds_model");
const savedUrl   = localStorage.getItem("ds_url");
if (savedKey)   keyEl.value    = savedKey;
if (savedModel) modelEl.value  = savedModel;
if (savedUrl)   apiUrlEl.value = savedUrl;
keyEl.addEventListener("change",   function(){ localStorage.setItem("ds_key",   keyEl.value.trim()); });
modelEl.addEventListener("change", function(){ localStorage.setItem("ds_model", modelEl.value.trim()); });
apiUrlEl.addEventListener("change",function(){ localStorage.setItem("ds_url",   apiUrlEl.value.trim()); });

// ---------------- 小工具 ----------------
function escapeHtml(s){
  return String(s == null ? "" : s).replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

let toastEl = null, toastTimer = null;
function toast(text){
  if (!toastEl){
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove("on"); }, 1600);
}

function addBubble(role, html){
  const d = document.createElement("div");
  d.className = "msg " + role;
  const b = document.createElement("div");
  b.className = "bubble";
  b.innerHTML = html;
  d.appendChild(b);
  chatEl.appendChild(d);
  chatEl.scrollTop = chatEl.scrollHeight;
  return b;
}

function removeLastBot(){
  const bots = chatEl.querySelectorAll(".msg.bot");
  if (bots.length) bots[bots.length - 1].remove();
}

// ---------------- 判级 / 线索 ----------------
function setVerdict(verdict, conflictCount){
  const badge = document.getElementById("badge");
  const txt   = document.getElementById("verdictText");
  const conf  = document.getElementById("confBadge");
  const map = {
    clear:      ["clear",      "案情清晰 · 无矛盾,可以出发"],
    tension:    ["tension",    "存疑 · 有矛盾,但可取舍"],
    impossible: ["impossible", "不可能 · 按你说的这案子破不了"]
  };
  const info = map[verdict];
  if (!info) return;
  badge.className = "badge " + info[0];
  badge.textContent = verdict === "clear" ? "案情清晰"
                    : verdict === "tension" ? "存疑" : "不可能";
  txt.textContent = info[1];
  if (conflictCount > 0){
    conf.textContent = "查出 " + conflictCount + " 处疑点";
    conf.hidden = false;
  } else {
    conf.hidden = true;
  }
  verdictBar.style.display = "flex";
}

// 线索清单:已确认与待补充,附完整度墨条
function renderClues(plan){
  const clues = Array.isArray(plan.clues) ? plan.clues : [];
  if (!clues.length){ cluePanel.hidden = true; return; }

  const known = clues.filter(function(c){ return c.status === "known" && c.value; });
  const total = clues.length;
  const pct = total ? Math.round(known.length / total * 100) : 0;

  document.getElementById("clueMeterFill").style.width = pct + "%";
  document.getElementById("clueMeterText").textContent =
    "信息完整度 " + pct + "%(" + known.length + "/" + total + ")";

  let h = "";
  clues.forEach(function(c){
    const isKnown = c.status === "known" && c.value;
    h += '<span class="chip ' + (isKnown ? "known" : "unknown") + '">' +
         '<span class="k">' + escapeHtml(c.key || "线索") + '</span>' +
         '<span class="v">' + escapeHtml(isKnown ? c.value : "待补充") + '</span>' +
         '</span>';
  });
  document.getElementById("clueChips").innerHTML = h;
  cluePanel.hidden = false;
}

function hideClues(){ cluePanel.hidden = true; }

// ---------------- 矛盾与方案对照 ----------------
function metaChips(c){
  let h = '<div class="meta-row">';
  if (c.severity)   h += '<span class="meta sev-' + escapeHtml(c.severity) + '">严重度 ' + escapeHtml(c.severity) + '</span>';
  if (c.impact)     h += '<span class="meta">影响 ' + escapeHtml(c.impact) + '</span>';
  if (c.confidence) h += '<span class="meta">把握 ' + escapeHtml(c.confidence) + '</span>';
  h += '</div>';
  return h;
}

// 两个取舍方案并排对照(无 options 时退回按钮组)
function renderOptions(options){
  if (!options || !options.length) return "";
  const hasDetail = options.some(function(o){ return o.save || o.give_up || o.fit; });
  if (!hasDetail){
    let h = '<div class="opts">';
    options.forEach(function(o){
      h += '<button class="opt" data-choose="' + escapeHtml(o.choose || "") + '">' +
           '<span class="oc">' + escapeHtml(o.choose || "") + '</span>' +
           (o.cost ? '<span class="ok">代价:' + escapeHtml(o.cost) + '</span>' : '') +
           '</button>';
    });
    return h + '</div>';
  }

  // 对照表:每个方案一列
  function cell(o, field){
    const v = o[field];
    return v ? escapeHtml(v) : "—";
  }
  let h = '<table class="compare"><thead><tr><th></th>';
  options.forEach(function(o){
    h += '<th class="pick"><button type="button" class="opt-pick" data-choose="' +
         escapeHtml(o.choose || "") + '">' + escapeHtml(o.choose || "方案") + '</button></th>';
  });
  h += '</tr></thead><tbody>';
  const rows = [["代价", "cost"], ["收益", "save"], ["放弃", "give_up"], ["适合", "fit"]];
  rows.forEach(function(r){
    const anyVal = options.some(function(o){ return o[r[1]]; });
    if (!anyVal) return;
    h += '<tr><th>' + r[0] + '</th>';
    options.forEach(function(o){ h += '<td>' + cell(o, r[1]) + '</td>'; });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

function renderConflicts(conflicts){
  if (!conflicts || !conflicts.length) return;
  let h = "";
  conflicts.forEach(function(c){
    h += '<div class="alert"><div class="hd">矛盾警报 · ' + escapeHtml(c.type || "疑点") + '</div>';
    h += metaChips(c);
    if (c.evidence && c.evidence.length){
      h += '<div class="ev">';
      c.evidence.forEach(function(e){ h += '<i>「' + escapeHtml(e) + '」</i>'; });
      h += '</div>';
    }
    if (c.explain) h += '<div class="ex">' + escapeHtml(c.explain) + '</div>';
    h += renderOptions(c.options);
    h += '</div>';
  });
  const b = addBubble("bot", h);
  b.querySelectorAll("[data-choose]").forEach(function(btn){
    btn.addEventListener("click", function(){
      inputEl.value = "我选:" + btn.getAttribute("data-choose");
      doSend();
    });
  });
}

// ---------------- 预算账本 ----------------
function renderLedger(plan){
  const led = plan.budget_ledger;
  if (!led || !Array.isArray(led.items) || !led.items.length) return "";
  const cur = led.currency || "元";
  let sum = 0;
  let rows = "";
  led.items.forEach(function(it){
    const amt = Number(it.amount);
    const ok = isFinite(amt);
    if (ok) sum += amt;
    rows += '<tr><td class="label">' + escapeHtml(it.label || "项目") +
            (it.note ? '<span class="note">' + escapeHtml(it.note) + '</span>' : '') +
            '</td><td class="amt">' + (ok ? escapeHtml(String(amt)) + " " + escapeHtml(cur) : "—") + '</td></tr>';
  });

  const limit = Number(led.limit);
  let totalHtml = '<div class="ledger-total">' +
    '<span class="sum">' + escapeHtml(String(sum)) + " " + escapeHtml(cur) + '</span>';
  if (isFinite(limit) && limit > 0){
    totalHtml += '<span class="limit">预算 ' + escapeHtml(String(limit)) + " " + escapeHtml(cur) + '</span>';
    const diff = sum - limit;
    if (diff > 0){
      totalHtml += '<span class="diff over">超出 ' + escapeHtml(String(diff)) + " " + escapeHtml(cur) + '</span>';
    } else {
      totalHtml += '<span class="diff ok">余 ' + escapeHtml(String(-diff)) + " " + escapeHtml(cur) + '</span>';
    }
  }
  totalHtml += '</div>';

  // 账目存疑:明细之和与 limit 差距过大(>15%)时提示
  let warn = "";
  if (isFinite(limit) && limit > 0 && Math.abs(sum - limit) / limit > 0.15){
    warn = '<div class="ledger-warn">账目存疑:明细合计 ' + sum + " " + cur +
           ' 与预算 ' + limit + " " + cur + ' 相差较多,请向侦探追问。</div>';
  }

  return '<div class="ledger"><h4>预算账本</h4>' +
         '<table class="ledger-rows">' + rows + '</table>' +
         totalHtml + warn + '</div>';
}

// ---------------- 每日强度 ----------------
const LOAD_SEGMENTS = {
  "轻松":   [["play", 55], ["rest", 25], ["travel", 20]],
  "适中":   [["play", 65], ["rest", 10], ["travel", 25]],
  "特种兵": [["play", 78], ["rest", 4],  ["travel", 18]]
};
function loadBar(load){
  const segs = LOAD_SEGMENTS[load] || LOAD_SEGMENTS["适中"];
  let h = '<div class="load-bar">';
  segs.forEach(function(s){
    h += '<span class="seg-' + s[0] + '" style="width:' + s[1] + '%"></span>';
  });
  return h + '</div>';
}

function renderDay(day, idx){
  const load = day.load || "适中";
  let head = '<div class="day-head">' +
    '<h4>Day ' + escapeHtml(String(day.day || idx + 1)) + ' · ' + escapeHtml(day.title || "") + '</h4>' +
    '<span class="load-badge ' + escapeHtml(load) + '">' + escapeHtml(load) + '</span>';
  if (day.start || day.end){
    head += '<span class="day-time">' + escapeHtml(day.start || "?") + " – " + escapeHtml(day.end || "?") + '</span>';
  }
  head += '</div>';

  let body = loadBar(load);
  (day.items || []).forEach(function(it){
    body += '<div class="item">';
    if (it.time)  body += '<span class="t">' + escapeHtml(it.time) + '</span>';
    if (it.place) body += '<div class="p">' + escapeHtml(it.place) + '</div>';
    if (it.detail) body += '<div class="d">' + escapeHtml(it.detail) + '</div>';
    const metas = [];
    if (it.duration) metas.push('<span class="dur">游玩 ' + escapeHtml(it.duration) + '</span>');
    if (it.travel)   metas.push('<span class="trv">通勤 ' + escapeHtml(it.travel) + '</span>');
    if (it.cost)     metas.push('<span class="cst">约 ' + escapeHtml(it.cost) + '</span>');
    if (metas.length) body += '<div class="meta-line">' + metas.join("") + '</div>';
    body += '</div>';
  });
  if (day.notes) body += '<div class="day-notes">提醒:' + escapeHtml(day.notes) + '</div>';
  return '<div class="card">' + head + body + '</div>';
}

// ---------------- Markdown 导出 ----------------
function buildMarkdown(plan){
  const L = [];
  L.push("# " + (plan.title || "行程方案"));
  if (plan.verdict) L.push("");
  const vmap = { clear: "案情清晰", tension: "存疑", impossible: "不可能" };
  L.push("> 裁决:" + (vmap[plan.verdict] || plan.verdict) +
         (plan.confidence ? "(把握 " + plan.confidence + ")" : ""));
  if (plan.budget) L.push("> 预算:" + plan.budget);

  if (Array.isArray(plan.clues) && plan.clues.length){
    L.push("", "## 线索清单");
    plan.clues.forEach(function(c){
      const known = c.status === "known" && c.value;
      L.push("- " + (c.key || "") + ":" + (known ? c.value : "待补充"));
    });
  }

  if (Array.isArray(plan.conflicts) && plan.conflicts.length){
    L.push("", "## 矛盾与取舍");
    plan.conflicts.forEach(function(c){
      L.push("", "### " + (c.type || "疑点") +
             (c.severity ? " · " + c.severity : "") +
             (c.impact ? " · 影响" + c.impact : ""));
      (c.evidence || []).forEach(function(e){ L.push("- 线索:「" + e + "」"); });
      if (c.explain) L.push(c.explain);
      (c.options || []).forEach(function(o){
        L.push("- **" + (o.choose || "方案") + "**");
        if (o.cost)    L.push("  - 代价:" + o.cost);
        if (o.save)    L.push("  - 收益:" + o.save);
        if (o.give_up) L.push("  - 放弃:" + o.give_up);
        if (o.fit)     L.push("  - 适合:" + o.fit);
      });
    });
  }

  const led = plan.budget_ledger;
  if (led && Array.isArray(led.items) && led.items.length){
    const cur = led.currency || "元";
    let sum = 0;
    L.push("", "## 预算账本", "", "| 项目 | 金额 |", "|---|---:|");
    led.items.forEach(function(it){
      const amt = Number(it.amount);
      if (isFinite(amt)) sum += amt;
      L.push("| " + (it.label || "") + (it.note ? "(" + it.note + ")" : "") + " | " +
             (isFinite(amt) ? amt + " " + cur : "—") + " |");
    });
    L.push("| **合计** | **" + sum + " " + cur + "** |");
    if (isFinite(Number(led.limit)) && Number(led.limit) > 0){
      const diff = sum - Number(led.limit);
      L.push("| 预算 | " + led.limit + " " + cur + " |");
      L.push("| 差额 | " + (diff > 0 ? "超出 " + diff : "余 " + (-diff)) + " " + cur + " |");
    }
  }

  if (Array.isArray(plan.days) && plan.days.length){
    L.push("", "## 每日行程");
    plan.days.forEach(function(d){
      L.push("", "### Day " + (d.day || "") + " · " + (d.title || "") +
             (d.load ? "(" + d.load + ")" : ""));
      if (d.start || d.end) L.push("时间:" + (d.start || "?") + " – " + (d.end || "?"));
      (d.items || []).forEach(function(it){
        let line = "- " + (it.time ? "**" + it.time + "** " : "") + (it.place || "");
        if (it.detail) line += ":" + it.detail;
        const metas = [];
        if (it.duration) metas.push("游玩 " + it.duration);
        if (it.travel)   metas.push("通勤 " + it.travel);
        if (it.cost)     metas.push("约 " + it.cost);
        if (metas.length) line += "(" + metas.join(",") + ")";
        L.push(line);
      });
      if (d.notes) L.push("> 提醒:" + d.notes);
    });
  }

  L.push("", "---", "由「行程大侦探」生成");
  return L.join("\n");
}

function copyText(text){
  if (navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function(resolve, reject){
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    }catch(e){ reject(e); }
  });
}

function downloadText(filename, text){
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

function attachExport(cardEl, plan){
  const foot = document.createElement("div");
  foot.className = "card-foot";
  foot.innerHTML =
    '<button type="button" class="line-btn" data-act="copy">复制 Markdown</button>' +
    '<button type="button" class="line-btn quiet" data-act="download">下载 .md</button>';
  cardEl.appendChild(foot);
  foot.querySelector('[data-act="copy"]').addEventListener("click", function(){
    copyText(buildMarkdown(plan)).then(
      function(){ toast("已复制到剪贴板"); },
      function(){ toast("复制失败,请手动选择"); }
    );
  });
  foot.querySelector('[data-act="download"]').addEventListener("click", function(){
    const name = (plan.title || "行程方案").replace(/[\\/:*?"<>|]/g, "_") + ".md";
    downloadText(name, buildMarkdown(plan));
    toast("已开始下载");
  });
}

// ---------------- 行程渲染 ----------------
function renderPlan(plan){
  lastPlan = plan;
  const conflicts = plan.conflicts || [];
  setVerdict(plan.verdict || "clear", conflicts.length);
  renderClues(plan);
  renderConflicts(conflicts);

  if (plan.verdict === "impossible" && (!plan.days || !plan.days.length)){
    addBubble("bot", '<div class="verdict-banner">本案不予立案 · 请先选定方向</div>');
    return;
  }

  let h = "";
  let head = "";
  if (plan.title)  head += '<h4>' + escapeHtml(plan.title) + '</h4>';
  if (plan.budget) head += '<p class="budget-line">预算估算:' + escapeHtml(plan.budget) + '</p>';
  if (head) h += head;
  h += renderLedger(plan);

  let daysHtml = "";
  (plan.days || []).forEach(function(day, i){ daysHtml += renderDay(day, i); });

  const b = addBubble("bot", h + daysHtml);
  attachExport(b, plan);
}

function renderReply(raw){
  const m = raw.match(/```json\s*([\s\S]*?)```/);
  if (m){
    const block = m[0];
    const parts = raw.split(block);
    const others = parts.map(function(p){return p.trim();}).filter(Boolean);
    if (others.length){
      addBubble("bot", '<div class="narrator">' + escapeHtml(others.join("\n\n")) + '</div>');
    }
    try {
      const plan = JSON.parse(m[1]);
      renderPlan(plan);
      return;
    } catch(e){ /* JSON 解析失败就按普通文本显示 */ }
  }
  addBubble("bot", escapeHtml(raw));
}

// ---------------- 加载 ----------------
let loadingTimer = null;
const LOADING_STEPS = [
  "排查关键信息", "核对预算", "审查路线距离", "汇总裁定"
];
function setLoading(on){
  const el = document.getElementById("loading");
  el.style.display = on ? "block" : "none";
  sendBtn.disabled = on;
  retryBtn.disabled = on || !lastUserTurn;
  if (on){
    let i = 0; el.textContent = LOADING_STEPS[0];
    loadingTimer = setInterval(function(){
      i = Math.min(i + 1, LOADING_STEPS.length - 1);
      el.textContent = LOADING_STEPS[i];
    }, 2200);
  } else if (loadingTimer){
    clearInterval(loadingTimer); loadingTimer = null;
  }
}

// ---------------- 请求 ----------------
// 浏览器直连 OpenAI 兼容接口;错误映射为友好中文,不暴露服务商细节。
function friendlyHttpError(status, bodyText){
  if (status === 401) return "API Key 无效或已过期,请检查后重试";
  if (status === 402) return "账户余额不足,请先充值";
  if (status === 429) return "请求过于频繁或配额已用尽,请稍后再试";
  if (status === 400) return "请求被接口拒绝,请检查 API 地址与模型名是否正确";
  if (status === 404) return "API 地址不存在,请确认地址以 /chat/completions 结尾";
  if (status === 403) return "接口拒绝访问(403):可能是该地址不允许浏览器直连,请换用支持跨域的接口";
  if (status >= 500)  return "服务商暂时不可用,请稍后重试";
  let detail = (bodyText || "").slice(0, 200);
  return "接口返回错误(HTTP " + status + ")" + (detail ? ":" + detail : "");
}

async function callApi(payloadMessages){
  const key    = keyEl.value.trim();
  const model  = modelEl.value.trim() || DEFAULT_MODEL;
  const apiUrl = apiUrlEl.value.trim() || DEFAULT_API_URL;
  if (!key){ alert("请先在配置里填写你的 API Key"); return; }

  setLoading(true);
  try{
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({ model: model, messages: payloadMessages, temperature: 0.7 })
    });

    if (!res.ok){
      const bodyText = await res.text().catch(function(){ return ""; });
      throw new Error(friendlyHttpError(res.status, bodyText));
    }

    const data = await res.json();
    const reply = data && data.choices && data.choices[0] &&
                  data.choices[0].message && data.choices[0].message.content;
    if (!reply) throw new Error("接口未返回有效内容,请检查模型名是否正确");

    messages = payloadMessages.slice();
    messages.push({ role: "assistant", content: reply });
    lastUserTurn = payloadMessages.slice();   // 供"重新侦查"
    renderReply(reply);
  }catch(err){
    let msg = err && err.message ? err.message : String(err);
    if (err instanceof TypeError){
      // fetch 网络层失败:多为跨域被拦或地址不可达
      msg = "无法连接该接口(跨域被拦截或地址不可达),请检查地址是否正确、是否允许浏览器直连";
    }
    addBubble("bot", "出错了:" + escapeHtml(msg));
  }finally{
    setLoading(false);
    retryBtn.disabled = !lastUserTurn;
    inputEl.focus();
  }
}

async function doSend(){
  const text = inputEl.value.trim();
  if (!text) return;
  if (!keyEl.value.trim()){ alert("请先在配置里填写你的 API Key"); return; }

  inputEl.value = "";
  hideClues();
  if (messages.length === 0) messages.push({ role: "system", content: SYSTEM_PROMPT });
  messages.push({ role: "user", content: text });
  addBubble("user", escapeHtml(text));
  await callApi(messages.slice());
}

// 重新侦查:丢掉上一次回答,用同样的问题再跑一遍
async function doRetry(){
  if (!lastUserTurn) return;
  removeLastBot();
  hideClues();
  await callApi(lastUserTurn.slice());
}

// 新建案件:清空现场,只保留 system
function newCase(){
  messages = [];
  lastUserTurn = null;
  lastPlan = null;
  chatEl.innerHTML = "";
  verdictBar.style.display = "none";
  hideClues();
  retryBtn.disabled = true;
  greeting();
  inputEl.focus();
}

// ---------------- 事件绑定 ----------------
sendBtn.addEventListener("click", function(){ doSend(); });
retryBtn.addEventListener("click", function(){ doRetry(); });
newCaseBtn.addEventListener("click", function(){ newCase(); });
toggleCfgBtn.addEventListener("click", function(){
  const show = configPanel.hidden;
  configPanel.hidden = !show;
  toggleCfgBtn.textContent = show ? "收起配置" : "配置";
  if (show) (savedKey ? modelEl : keyEl).focus();
});
inputEl.addEventListener("keydown", function(e){
  if (e.key === "Enter" && !e.isComposing) doSend();
});

// ---------------- 开场 ----------------
function greeting(){
  addBubble("bot", "你好,我是行程大侦探。先说明:我不负责把你想去的地方都塞进去——" +
    "我负责把它们的矛盾找出来。\n说说你的旅行想法吧,比如:" +
    "「这周末想去西安玩2天,预算1000,一个人,喜欢历史,还想吃遍网红店」。");
}
greeting();
