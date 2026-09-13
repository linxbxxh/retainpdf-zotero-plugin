/* RetainPDF Translate — Zotero 7/9 bootstrap plugin
 *
 * 依赖本机安装的 RetainPDF 桌面版（其内置本地 API：http://127.0.0.1:41000）。
 * 流程：抓取条目 PDF → POST /api/v1/uploads → POST /api/v1/jobs (workflow=book)
 *       → 轮询 /api/v1/jobs/{id} → 下载 /pdf → 作为附件挂到条目下。
 *
 * 注意：插件运行在 Zotero 的沙箱 scope 中，没有 Components/nsIProcess 等
 * chrome 全局，只能使用 scope 注入的 Zotero / Services / IOUtils / PathUtils
 * 与白名单全局（XMLHttpRequest、fetch、TextEncoder 等）。
 */

var Zotero;

const PLUGIN_ID = "retainpdf-translate@zcode.local";
const PREF = "extensions.retainpdf.";
const ICON = "chrome://zotero/skin/treeitem-attachment-pdf.png";

/* ---------- state ---------- */

var notifierID = null;
var wmListener = null;
var injectedNodes = new Map(); // window -> [elements]
var queue = [];
var queuedParents = new Set();
var processingParents = new Set();
var pumpingCount = 0;
var shuttingDown = false;
var desktopConfigCache = null;
var desktopConfigCachedAt = 0;

/* ---------- prefs ---------- */

function prefBool(name, def) {
  try { return Services.prefs.getBoolPref(PREF + name); } catch (e) { return def; }
}
function prefChar(name, def) {
  try {
    const v = Services.prefs.getStringPref(PREF + name);
    return v && v.length ? v : def;
  } catch (e) { return def; }
}
function prefInt(name, def) {
  try { return Services.prefs.getIntPref(PREF + name); } catch (e) { return def; }
}

/* ---------- small utils ---------- */

function asciiBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 临时诊断：把插件内部决策写到文件，便于排查（正式版可移除） */
var dbgFile = null;
var dbgBuf = [];
function dbg(msg) {
  try {
    Zotero.debug("[retainpdf] " + msg);
    dbgBuf.push(new Date().toISOString() + "  " + msg);
    if (!dbgFile) {
      dbgFile = PathUtils.join(Zotero.DataDirectory.dir, "retainpdf-debug.log");
    }
    // 用普通写（覆盖），避免 append 模式兼容性问题
    IOUtils.writeUTF8(dbgFile, dbgBuf.join("\n") + "\n").catch((e) => {
      Zotero.debug("[retainpdf] dbg write failed: " + e);
    });
  } catch (e) { /* ignore */ }
}

function unwrapEnvelope(json) {
  if (json && typeof json === "object" && "code" in json && "data" in json) {
    if (json.code !== 0) throw new Error(json.message || ("API 返回 code=" + json.code));
    return json.data;
  }
  return json;
}

function apiRequest({ method = "GET", url, headers = {}, body = null, responseType = "text", timeoutMs = 120000 }) {
  return Zotero.HTTP.request(method, url, {
    headers,
    body,
    responseType,
    timeout: timeoutMs,
  });
}

function authHeaders(key) {
  return { "X-API-Key": key };
}

/* ---------- RetainPDF local API ---------- */

async function checkHealth(base) {
  try {
    const xhr = await apiRequest({ url: base + "/health", timeoutMs: 3000 });
    const d = unwrapEnvelope(JSON.parse(xhr.responseText));
    return !!(d && d.status === "up");
  } catch (e) {
    return false;
  }
}

async function waitForHealth(base, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline && !shuttingDown) {
    if (await checkHealth(base)) return true;
    await sleep(1500);
  }
  return false;
}

function envPath(name) {
  try { return Services.env.get(name) || ""; } catch (e) { return ""; }
}

async function getDesktopConfig() {
  const now = Date.now();
  if (desktopConfigCache && now - desktopConfigCachedAt < 60000) return desktopConfigCache;
  try {
    let dir;
    if (Zotero.isWin) {
      dir = envPath("APPDATA");
    } else if (Zotero.isMac) {
      dir = envPath("HOME") + "/Library/Application Support";
    } else {
      dir = envPath("XDG_CONFIG_HOME") || (envPath("HOME") + "/.config");
    }
    if (!dir) return null;
    const path = PathUtils.join(dir, "retain-pdf-desktop", "desktop-config.json");
    if (!(await IOUtils.exists(path))) return null;
    const text = await Zotero.File.getContentsAsync(path);
    desktopConfigCache = JSON.parse(text);
    desktopConfigCachedAt = now;
    return desktopConfigCache;
  } catch (e) {
    Zotero.logError(e);
    return null;
  }
}

async function findRetainPDFExe() {
  const custom = prefChar("exePath", "");
  if (custom && await IOUtils.exists(custom)) return custom;

  const pf = envPath("ProgramFiles");
  const pf86 = envPath("ProgramFiles(x86)");
  const localAppData = envPath("LocalAppData");
  const programData = envPath("ProgramData");
  const candidates = [];
  for (const root of [pf, pf86, localAppData, programData]) {
    if (!root) continue;
    candidates.push(PathUtils.join(root, "RetainPDF", "RetainPDF.exe"));
    candidates.push(PathUtils.join(root, "Programs", "RetainPDF", "RetainPDF.exe"));
  }
  // 盘符扫描覆盖绿色安装（如 D:\retainPDF\RetainPDF.exe；NTFS 不区分大小写）
  for (let i = 67; i <= 90; i++) { // C..Z
    candidates.push(String.fromCharCode(i) + ":\\RetainPDF\\RetainPDF.exe");
  }
  for (const c of candidates) {
    try {
      if (await IOUtils.exists(c)) return c;
    } catch (e) { /* ignore */ }
  }
  return "";
}

/* RetainPDF 桌面版是 Electron 应用，带单实例锁：已经在运行时再启动一次，
 * 进程会立刻退出并弹系统对话框「Another instance of the application is already running.」。
 * 因此并发翻译（或用户自己已开着窗口）时绝不能再拉一次进程。
 *
 * 另一个关键点：Zotero.Utilities.Internal.exec 的 Promise 要等被启动进程“退出”才
 * resolve（utilities_internal.js 里 runwAsync + process-finished）。RetainPDF 是常驻
 * GUI 应用，await 它等于挂起整个翻译任务直到 RetainPDF 关闭。所以这里绝对不能
 * await exec —— 发射后不管，就绪与否交给 waitForHealth 轮询判断。 */
var lastLaunchAt = 0;

// 返回 true 表示“本次调用真的去启动了进程”，冷却期内的调用方返回 false
async function tryLaunchRetainPDF() {
  // 同步检查并占位，防止并发任务在同一瞬间各自通过检查
  if (Date.now() - lastLaunchAt < 120000) return false;
  lastLaunchAt = Date.now();
  const exe = await findRetainPDFExe();
  if (!exe) {
    lastLaunchAt = 0; // 没找到可执行文件时不占冷却期，便于用户修好路径后重试
    return false;
  }
  try {
    Zotero.Utilities.Internal.exec(exe, []).catch((e) => {
      // 单实例锁撞车 / 启动失败等都会以非 0 退出码走到这里，仅记录
      Zotero.debug("[retainpdf] launch process exited: " + (e.message || e));
    });
    return true;
  } catch (e) {
    Zotero.logError(e);
    return false;
  }
}

/* importFromFile 内部走 Zotero.DB.executeTransaction（DB 事务锁 + 建 storage 目录）。
 * 并发翻译时多个任务同时挂附件会争同一把事务锁，一旦抛错，译文虽然已在后端生成，
 * 附件却会永久丢失（旧代码只在 catch 里弹窗，不重试）。
 * 这里把“挂附件”串行化，并对瞬时错误重试。 */
var attachChain = Promise.resolve();
var attachFailCount = 0;

async function attachFileSerialized(file, parentItemID, title) {
  const prev = attachChain;
  let release;
  attachChain = new Promise((r) => { release = r; });
  await prev;
  try {
    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await Zotero.Attachments.importFromFile({
          file, parentItemID, title, contentType: "application/pdf",
        });
      } catch (e) {
        lastErr = e;
        Zotero.debug("[retainpdf] attach attempt " + attempt + "/" + maxAttempts
          + " failed for " + title + ": " + (e && e.message ? e.message : e));
        if (attempt < maxAttempts) await sleep(1500 * attempt);
      }
    }
    attachFailCount++;
    throw lastErr || new Error("挂附件失败: " + title);
  } finally {
    release();
  }
}

async function uploadPdf(base, key, filePath, fileName) {
  const data = await IOUtils.read(filePath);
  const name = fileName || filePath.split(/[\\/]/).pop();
  // multipart 头部里的 filename 只保留安全字符，防止引号/换行破坏报文结构
  const safeName = (name || "document.pdf").replace(/[\r\n"\\]/g, "_");
  const boundary = "----retainpdfzotero" + Date.now();
  const head = "--" + boundary
    + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + safeName + "\""
    + "\r\nContent-Type: application/pdf\r\n\r\n";
  const tail = "\r\n--" + boundary + "--\r\n";
  const headBytes = asciiBytes(head);
  const tailBytes = asciiBytes(tail);
  // Blob 按段引用、零拷贝拼接，避免大 PDF 在内存里再复制一份
  const body = (typeof Blob === "function")
    ? new Blob([headBytes, data, tailBytes])
    : concatBytes([headBytes, data, tailBytes]);
  const xhr = await apiRequest({
    method: "POST",
    url: base + "/api/v1/uploads",
    headers: { "X-API-Key": key, "Content-Type": "multipart/form-data; boundary=" + boundary },
    body,
    timeoutMs: 300000,
  });
  if (xhr.status !== 200) throw new Error("上传失败: HTTP " + xhr.status + " " + String(xhr.responseText).slice(0, 200));
  const d = unwrapEnvelope(JSON.parse(xhr.responseText));
  if (!d.upload_id) throw new Error("上传响应缺少 upload_id");
  return d.upload_id;
}

async function resolveCredentials() {
  const prefModel = prefChar("model", "");
  const prefBaseUrl = prefChar("baseUrl", "");
  const prefApiKey = prefChar("modelApiKey", "");
  const prefProvider = prefChar("ocrProvider", "");

  // 模型三件套已在插件偏好里配齐时，不再依赖桌面配置（桌面配置损坏也能翻）
  let cfg = {};
  if (!(prefModel && prefBaseUrl && prefApiKey)) {
    cfg = (await getDesktopConfig()) || {};
  }
  const dev = cfg.developerConfig || {};

  const model = prefModel || dev.model || cfg.model || "deepseek-v4-flash";
  const baseUrl = prefBaseUrl || dev.baseUrl || cfg.baseUrl || "https://api.deepseek.com/v1";
  const modelApiKey = prefApiKey || cfg.modelApiKey || "";

  const provider = (prefProvider || cfg.ocrProvider || "paddle").toLowerCase();
  let token = "";
  let tokenField = "paddle_token";
  if (provider === "mineru") {
    tokenField = "mineru_token";
    token = cfg.mineruToken || "";
  } else if (provider === "vision") {
    tokenField = "vision_api_key";
    token = cfg.visionOcrApiKey || "";
  } else {
    token = cfg.paddleToken || "";
  }
  token = token || "";

  return {
    model, baseUrl, modelApiKey,
    provider, tokenField, token,
    visionBaseUrl: cfg.visionOcrBaseUrl || "",
    visionModel: cfg.visionOcrModel || "",
  };
}

async function submitJob(base, key, uploadId, creds, timeoutSeconds) {
  const pageRanges = prefChar("pageRanges", "");
  const language = "ch";

  const ocr = {
    provider: creds.provider,
    [creds.tokenField]: creds.token,
    model_version: "vlm",
    language,
    page_ranges: pageRanges,
  };
  if (creds.provider === "paddle") {
    ocr.paddle_api_url = "https://paddleocr.aistudio-app.com";
  }
  if (creds.provider === "vision") {
    ocr.options = { base_url: creds.visionBaseUrl, model: creds.visionModel, raw_provider: "generic_flat_ocr" };
  }

  const payload = {
    workflow: "book",
    source: { upload_id: uploadId },
    ocr,
    translation: {
      mode: "sci",
      math_mode: "direct_typst",
      model: creds.model,
      base_url: creds.baseUrl,
      api_key: creds.modelApiKey,
      workers: 100,
      batch_size: 1,
      classify_batch_size: 12,
      rule_profile_name: "general_sci",
      custom_rules_text: "",
      glossary_id: "",
      glossary_entries: [],
      skip_title_translation: false,
    },
    render: {
      render_mode: "auto",
      compile_workers: 8,
      typst_font_family: "Source Han Serif SC",
      pdf_compress_dpi: 0,
      translated_pdf_name: "",
      body_font_size_factor: 0.95,
      body_leading_factor: 1.08,
      inner_bbox_shrink_x: 0,
      inner_bbox_shrink_y: 0,
      inner_bbox_dense_shrink_x: 0,
      inner_bbox_dense_shrink_y: 0,
      font_unify_mode: "role_min",
    },
    runtime: { job_id: "", timeout_seconds: timeoutSeconds },
  };

  const xhr = await apiRequest({
    method: "POST",
    url: base + "/api/v1/jobs",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 120000,
  });
  if (xhr.status !== 200) {
    throw new Error("提交任务失败: HTTP " + xhr.status + " " + String(xhr.responseText).slice(0, 300));
  }
  const d = unwrapEnvelope(JSON.parse(xhr.responseText));
  if (!d.job_id) throw new Error("提交任务响应缺少 job_id");
  return d.job_id;
}

function stageText(jobData, elapsed) {
  const stage = (jobData.display_stage || jobData.user_stage || jobData.stage || "").toLowerCase();
  let label = "处理中";
  if (stage.includes("ocr") || stage.includes("paddle") || stage.includes("normal")) label = "OCR 识别中";
  else if (stage.includes("translat")) label = "全文翻译中";
  else if (stage.includes("render") || stage.includes("typst") || stage.includes("compile")) label = "渲染排版中";
  else if (jobData.status === "queued") label = "排队中";
  const prog = jobData.progress || {};
  const detail = (prog.total ? " " + (prog.current ?? "?") + "/" + prog.total : "");
  return label + detail + " (" + elapsed + "s)";
}

async function downloadTranslatedPdf(base, key, jobId) {
  try {
    const m = unwrapEnvelope(JSON.parse(
      (await apiRequest({ url: base + "/api/v1/jobs/" + jobId + "/artifacts-manifest", headers: authHeaders(key) })).responseText
    ));
    const items = Array.isArray(m.items) ? m.items : [];
    const item = items.find((i) => i.ready
      && ["translated_pdf", "pdf", "output_pdf", "result_pdf"].includes(i.artifact_key));
    if (item) {
      const raw = item.resource_url || item.resource_path || "";
      const abs = /^https?:/i.test(raw) ? raw : base + (raw.startsWith("/") ? raw : "/" + raw);
      const xhr = await apiRequest({
        url: abs, headers: authHeaders(key), responseType: "arraybuffer", timeoutMs: 600000,
      });
      if (xhr.status === 200 && xhr.response && xhr.response.byteLength > 0) {
        return new Uint8Array(xhr.response);
      }
    }
  } catch (e) {
    Zotero.logError(e);
  }
  const xhr2 = await apiRequest({
    url: base + "/api/v1/jobs/" + jobId + "/pdf",
    headers: authHeaders(key), responseType: "arraybuffer", timeoutMs: 600000,
  });
  if (xhr2.status !== 200) throw new Error("下载译文 PDF 失败: HTTP " + xhr2.status);
  return new Uint8Array(xhr2.response);
}

async function downloadSideBySidePdf(base, key, jobId) {
  const xhr = await apiRequest({
    url: base + "/api/v1/jobs/" + jobId + "/pdf/side-by-side",
    headers: authHeaders(key), responseType: "arraybuffer", timeoutMs: 600000,
  });
  if (xhr.status !== 200 || !xhr.response || xhr.response.byteLength === 0) {
    throw new Error("下载中英对照 PDF 失败: HTTP " + xhr.status);
  }
  return new Uint8Array(xhr.response);
}

/* ---------- core translation flow ---------- */

function sanitizeFilename(s) {
  return (s || "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "pdf";
}

function popup(headline, description, closeMs) {
  const pw = new Zotero.ProgressWindow({ closeOnClick: true });
  pw.changeHeadline(headline);
  if (description) pw.addDescription(description);
  pw.show();
  if (closeMs) pw.startCloseTimer(closeMs);
  return pw;
}

function hasTranslatedAttachment(parent, title) {
  try {
    const ids = parent.getAttachments();
    for (const id of ids) {
      const att = Zotero.Items.get(id);
      if (att && !att.deleted && att.isAttachment() && att.getField("title") === title) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

async function translateItem(job) {
  const base = prefChar("apiBase", "http://127.0.0.1:41000").replace(/\/+$/, "");
  const key = prefChar("apiKey", "retain-pdf-desktop");
  const attachTitle = prefChar("attachTitle", "中文翻译 (RetainPDF)");
  const timeoutSeconds = prefInt("jobTimeout", 1800);

  const parent = await Zotero.Items.getAsync(job.parentItemID);
  const att = await Zotero.Items.getAsync(job.attachmentID);
  if (!parent || !att || parent.deleted || att.deleted) return;

  if (prefBool("skipExisting", true) && hasTranslatedAttachment(parent, attachTitle)) {
    return; // silent skip
  }

  const pdfPath = await att.getFilePathAsync();
  if (!pdfPath) {
    popup("RetainPDF 翻译跳过", "条目「" + (parent.getField("title") || "") + "」的 PDF 不是本地文件（可能只是链接），已跳过。", 8000);
    return;
  }
  const pw = new Zotero.ProgressWindow({ closeOnClick: false });
  pw.changeHeadline("RetainPDF 翻译" + (queue.length > 0 ? "（队列中还有 " + queue.length + " 篇）" : ""));
  pw.show();
  const prog = new pw.ItemProgress(ICON, att.attachmentFilename || "PDF");
  prog.setProgress(1);
  prog.setText("连接本地服务…");

  try {
    if (!(await checkHealth(base))) {
      // 只在这次调用真的拉起了进程时提示“正在启动”，已有实例的并发任务直接等它
      const launched = await tryLaunchRetainPDF();
      prog.setText(launched ? "正在启动 RetainPDF…" : "等待 RetainPDF 服务就绪…");
      if (!(await waitForHealth(base, 120))) {
        const hasExe = !!(await findRetainPDFExe());
        throw new Error(
          "无法连接 RetainPDF 本地服务 (" + base + ")。"
          + (hasExe
            // 进程在、端口不通：多为实例卡死或单实例锁残留，需重开应用
            ? "RetainPDF 似乎已在运行但本地服务无响应（可能上次退出不干净）。"
              + "请手动完全退出并重新打开 RetainPDF 桌面版；"
              + "若反复出现，可在任务管理器结束所有 RetainPDF.exe 后重开。"
            : "未找到 RetainPDF.exe，请在插件设置中填写程序路径。")
        );
      }
    }

    const filename = att.attachmentFilename || "document.pdf";
    const stem = sanitizeFilename(filename.replace(/\.pdf$/i, ""));
    const outName = "zh_" + stem + ".pdf";

    prog.setText("上传 PDF…");
    prog.setProgress(5);
    let uploadId;
    try {
      uploadId = await uploadPdf(base, key, pdfPath, filename);
    } catch (e) {
      // 网络抖动等瞬时错误重试一次（413 等永久错误重试也只是多花几秒）
      Zotero.debug("[retainpdf] upload failed once, retrying: " + (e.message || e));
      dbg("translateItem: upload failed once parent=" + parent.id + " err=" + (e.message || e));
      prog.setText("上传失败，3 秒后重试…");
      await sleep(3000);
      if (shuttingDown) return;
      uploadId = await uploadPdf(base, key, pdfPath, filename);
    }

    prog.setText("提交翻译任务…");
    prog.setProgress(10);
    const creds = await resolveCredentials();
    if (!creds.modelApiKey) {
      throw new Error("未找到翻译模型 API Key：请先在 RetainPDF 桌面版里完成接口设置，或在插件设置中手动填写。");
    }
    if (!creds.token) {
      throw new Error("未找到 OCR 凭证（provider=" + creds.provider + "）：请先在 RetainPDF 桌面版完成 OCR 设置，或在插件设置中指定 OCR Provider。");
    }
    const jobId = await submitJob(base, key, uploadId, creds, timeoutSeconds);

    const startedAt = Date.now();
    const deadline = startedAt + timeoutSeconds * 1000;
    const POLL_MAX_FAILS = 10;
    let pollFails = 0;
    let jobData = null;
    let status = "queued";
    while (Date.now() < deadline && !shuttingDown) {
      // 长任务轮询退避：1 分钟内用基础间隔，10 分钟内 ≥6 秒，之后 ≥12 秒
      const baseInterval = Math.max(1, prefInt("pollInterval", 3));
      const soFar = Math.round((Date.now() - startedAt) / 1000);
      const interval = soFar < 60 ? baseInterval : soFar < 600 ? Math.max(baseInterval, 6) : Math.max(baseInterval, 12);
      await sleep(interval * 1000);
      if (shuttingDown) return;
      try {
        const xhr = await apiRequest({
          url: base + "/api/v1/jobs/" + jobId, headers: authHeaders(key), timeoutMs: 30000,
        });
        jobData = unwrapEnvelope(JSON.parse(xhr.responseText));
        pollFails = 0;
      } catch (e) {
        // 后端瞬时抖动（500/超时等）不应判死整个翻译任务
        pollFails++;
        Zotero.debug("[retainpdf] poll failed " + pollFails + "/" + POLL_MAX_FAILS + ": " + (e.message || e));
        if (pollFails >= POLL_MAX_FAILS) {
          throw new Error("轮询任务状态连续失败 " + pollFails + " 次，放弃监控 (job_id=" + jobId + ")");
        }
        prog.setText("轮询暂时失败，正在重试 (" + pollFails + "/" + POLL_MAX_FAILS + ")…");
        continue;
      }
      status = jobData.status || "unknown";
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      prog.setText(stageText(jobData, elapsed));
      prog.setProgress(Math.min(94, 10 + Math.round(elapsed / 3)));
      if (["succeeded", "failed", "canceled"].includes(status)) break;
    }

    if (status !== "succeeded") {
      let detail = "任务状态: " + status + " (job_id=" + jobId + ")";
      try {
        const dxhr = await apiRequest({
          url: base + "/api/v1/jobs/" + jobId + "/diagnostics", headers: authHeaders(key), timeoutMs: 30000,
        });
        const d = unwrapEnvelope(JSON.parse(dxhr.responseText));
        if (d && (d.summary || d.detail)) detail = (d.summary || "") + (d.detail ? "\n" + d.detail : "") + "\n(job_id=" + jobId + ")";
      } catch (e) { /* optional */ }
      throw new Error("翻译未成功。\n" + detail);
    }

    prog.setText("下载译文…");
    prog.setProgress(95);
    const bytes = await downloadTranslatedPdf(base, key, jobId);

    const tmpDir = PathUtils.join(Zotero.getTempDirectory().path, "retainpdf-" + Date.now());
    await IOUtils.makeDirectory(tmpDir);
    const tmpPath = PathUtils.join(tmpDir, outName);
    await IOUtils.write(tmpPath, bytes);

    prog.setText("挂到条目下…");
    prog.setProgress(98);
    await attachFileSerialized(tmpPath, parent.id, attachTitle);
    IOUtils.remove(tmpPath, { ignoreMissing: true }).catch(() => {});

    // 中英对照版（A3 横版，左原文右译文）；去重跟随 skipExisting 语义
    const dualTitle = prefChar("dualTitle", "中英对照 (RetainPDF)");
    const dualDeduped = prefBool("skipExisting", true) && hasTranslatedAttachment(parent, dualTitle);
    if (prefBool("attachDual", true) && !dualDeduped) {
      prog.setText("下载中英对照…");
      try {
        const dualBytes = await downloadSideBySidePdf(base, key, jobId);
        const dualPath = PathUtils.join(tmpDir, "zh.dual_" + stem + ".pdf");
        await IOUtils.write(dualPath, dualBytes);
        await attachFileSerialized(dualPath, parent.id, dualTitle);
        IOUtils.remove(dualPath, { ignoreMissing: true }).catch(() => {});
      } catch (e) {
        // 对照版失败不影响主译文
        Zotero.logError(e);
      }
    }
    IOUtils.remove(tmpDir, { recursive: true, ignoreMissing: true }).catch(() => {});

    prog.setProgress(100);
    prog.setText("完成");
    pw.startCloseTimer(3000);
  } catch (e) {
    Zotero.logError(e);
    dbg("translateItem: ERROR parent=" + job.parentItemID + " msg=" + (e && e.message ? e.message : String(e))
      + " stack=" + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""));
    try { pw.close(); } catch (e2) {} // ProgressWindow 没有 cancel()，只有 close()
    // 带上条目标题，便于在批量翻译时定位是哪一篇失败
    let who = "";
    try { who = "「" + (parent.getField("title") || "").slice(0, 40) + "」"; } catch (e2) {}
    popup("RetainPDF 翻译失败" + who, e.message || String(e), 12000);
  }
}

/* ---------- queue ---------- */

const CONCURRENCY_CAP = 6;

function concurrencyLimit() {
  return Math.min(CONCURRENCY_CAP, Math.max(1, prefInt("concurrency", 2)));
}

async function pump() {
  if (shuttingDown) return;
  while (pumpingCount < concurrencyLimit() && queue.length && !shuttingDown) {
    const job = queue.shift();
    // 出队即释放去重标记：任务失败后允许再次右键重试，
    // 处理中的并发去重由 processingParents 负责
    queuedParents.delete(job.parentItemID);
    if (processingParents.has(job.parentItemID)) continue;
    processingParents.add(job.parentItemID);
    pumpingCount++;
    translateItem(job)
      .catch((e) => Zotero.logError(e))
      .finally(() => {
        pumpingCount--;
        processingParents.delete(job.parentItemID);
        pump();
      });
  }
}

function outputTitles() {
  const titles = new Set();
  titles.add(prefChar("attachTitle", "中文翻译 (RetainPDF)"));
  titles.add(prefChar("dualTitle", "中英对照 (RetainPDF)"));
  return titles;
}

async function enqueueItem(item, { force = false } = {}) {
  try {
    let parent = null;
    let attachment = null;
    const ownTitles = outputTitles();
    if (item.isAttachment()) {
      // 自己生成的译文/对照附件不作为翻译源，避免自我触发死循环
      if (ownTitles.has(item.getField("title"))) return;
      attachment = item;
      const pid = item.parentItemID;
      if (!pid) return;
      parent = await Zotero.Items.getAsync(pid);
    } else if (item.isRegularItem()) {
      parent = item;
    } else {
      return;
    }
    if (!parent || parent.deleted) return;

    const attachTitle = prefChar("attachTitle", "中文翻译 (RetainPDF)");
    if (!force && prefBool("skipExisting", true) && hasTranslatedAttachment(parent, attachTitle)) {
      return;
    }
    if (queuedParents.has(parent.id) || processingParents.has(parent.id)) {
      return;
    }

    if (!attachment) {
      let best = null;
      try { best = await parent.getBestAttachment(); } catch (e) { best = null; }
      const pickable = (a) => a && a.isAttachment()
        && a.attachmentContentType === "application/pdf"
        && !a.deleted
        && !ownTitles.has(a.getField("title"));
      if (pickable(best)) {
        attachment = best;
      } else {
        const ids = parent.getAttachments();
        for (const id of ids) {
          const a = Zotero.Items.get(id);
          if (pickable(a)) {
            attachment = a;
            break;
          }
        }
      }
    }
    if (!attachment || attachment.attachmentContentType !== "application/pdf") {
      return; // 该条目没有本地 PDF 附件
    }
    queuedParents.add(parent.id);
    queue.push({ parentItemID: parent.id, attachmentID: attachment.id });
    pump();
  } catch (e) {
    Zotero.logError(e);
  }
}

/* ---------- notifier ---------- */

var notifierCallback = {
  notify: async function (event, type, ids, extraData) {
    if (shuttingDown || !prefBool("auto", true)) return;
    if (type !== "item" || (event !== "add" && event !== "modify")) return;
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      if (item.isAttachment() && item.attachmentContentType === "application/pdf" && item.parentItemID) {
        await enqueueItem(item);
      }
    }
  },
};

/* ---------- menus ---------- */

function addMenusForWindow(win) {
  try {
    const doc = win.document;
    if (doc.getElementById("retainpdf-itemmenu-translate")) return;
    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (!itemMenu) return;
    const nodes = [];
    const sep = doc.createXULElement("menuseparator");
    sep.id = "retainpdf-itemmenu-sep";
    const mi = doc.createXULElement("menuitem");
    mi.id = "retainpdf-itemmenu-translate";
    mi.label = "RetainPDF 翻译全文并挂到条目";
    mi.addEventListener("command", () => translateSelected(win, false));
    const miRe = doc.createXULElement("menuitem");
    miRe.id = "retainpdf-itemmenu-retranslate";
    miRe.label = "RetainPDF 重新翻译（删除旧译文后重翻）";
    miRe.addEventListener("command", () => translateSelected(win, true));
    itemMenu.appendChild(sep);
    itemMenu.appendChild(mi);
    itemMenu.appendChild(miRe);
    nodes.push(sep, mi, miRe);
    injectedNodes.set(win, nodes);
  } catch (e) {
    Zotero.logError(e);
  }
}

// 重新翻译前，把本插件此前生成的译文附件移入回收站（可恢复）。
// Zotero 9 的 Item 没有 deleteTx；官方 UI（itemTree.js 等）删除条目用的就是
// Zotero.Items.trashTx(ids)——入回收站、同步安全、发 'trash' 通知。
async function removeRetainPdfAttachments(parent) {
  const ownTitles = outputTitles();
  const ids = [];
  for (const id of parent.getAttachments()) {
    const att = Zotero.Items.get(id);
    if (att && att.isAttachment() && ownTitles.has(att.getField("title")) && !att.deleted) {
      ids.push(id);
    }
  }
  if (ids.length) {
    await Zotero.Items.trashTx(ids);
  }
  return ids.length;
}

function translateSelected(win, force) {
  try {
    const zp = Zotero.getActiveZoteroPane();
    if (!zp) return;
    const items = zp.getSelectedItems() || [];
    if (!items.length) return;
    (async () => {
      let cleaned = 0;
      for (const item of items) {
        if (force) {
          let parent = null;
          if (item.isAttachment()) {
            if (item.parentItemID) parent = await Zotero.Items.getAsync(item.parentItemID);
          } else if (item.isRegularItem()) {
            parent = item;
          }
          if (parent) {
            cleaned += await removeRetainPdfAttachments(parent);
          }
        }
        enqueueItem(item, { force: !!force });
      }
      popup(
        "RetainPDF 翻译",
        force
          ? "已把 " + cleaned + " 个旧译文移入回收站，重新翻译已开始。"
          : "已加入翻译队列（" + items.length + " 个条目），完成后译文会自动挂到条目下。",
        4000,
      );
    })().catch((e) => {
      Zotero.logError(e);
      popup("RetainPDF 翻译失败", e.message || String(e), 8000);
    });
  } catch (e) {
    Zotero.logError(e);
    popup("RetainPDF 翻译失败", e.message || String(e), 8000);
  }
}

var windowMediatorListener = {
  onOpenWindow: function (aWindow) {
    try {
      const domWindow = aWindow;
      domWindow.addEventListener("load", function () {
        if (domWindow.ZoteroPane) addMenusForWindow(domWindow);
      }, { once: true });
    } catch (e) {
      Zotero.logError(e);
    }
  },
  onCloseWindow: function () {},
  onWindowTitleChange: function () {},
};

/* ---------- bootstrap ---------- */

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  try {
    Zotero.debug("[retainpdf] startup begin, reason=" + reason);
    await Zotero.initializationPromise;
    Zotero.debug("[retainpdf] initialization done");

    Zotero.PreferencePanes.register({
      pluginID: PLUGIN_ID,
      label: "RetainPDF 翻译",
      image: "data:image/svg+xml," + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
        '<rect x="1" y="1" width="30" height="30" rx="6" fill="#c0392b"/>' +
        '<text x="16" y="21" font-size="13" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">R译</text></svg>'
      ),
      src: rootURI + "prefs.xhtml",
    });

    notifierID = Zotero.Notifier.registerObserver(notifierCallback, ["item"], "retainpdf", 50);

    Services.wm.addListener(windowMediatorListener);
    const windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      if (win.ZoteroPane && win.document.readyState === "complete") {
        addMenusForWindow(win);
      }
    }
    Zotero.debug("[retainpdf] startup complete");
  } catch (e) {
    try { Zotero.debug("[retainpdf] STARTUP ERROR: " + (e && e.stack ? e.stack : e)); } catch (e2) {}
    Zotero.logError(e);
  }
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  shuttingDown = true;
  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
  }
  try { Services.wm.removeListener(windowMediatorListener); } catch (e) {}
  for (const [win, nodes] of injectedNodes) {
    try {
      for (const node of nodes) node.remove();
    } catch (e) {}
  }
  injectedNodes.clear();
  queue.length = 0;
  queuedParents.clear();
  desktopConfigCache = null;
}

function uninstall(data, reason) {}
