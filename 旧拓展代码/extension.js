"use strict";

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const { spawn } = require("child_process");

/** 扩展安装目录，在 activate 中赋值，用于解析内置 ripgrep 路径 */
let extensionPath = "";

/**
 * 从链式访问字符串中解析出 key 路径数组，如 ._kernel["142"] => ["_kernel","142"]。
 * chain 为 languages 之后的整段，如 ._kernel["142"] 或 ["_kernel"]["142"]。
 */
function parseLanguagesChain(chain) {
  const keys = [];
  const partRe = /\.\s*([a-zA-Z_][a-zA-Z0-9_]*)|\[\s*["']([^"']+)["']\s*\]/g;
  let p;
  while ((p = partRe.exec(chain)) !== null) {
    const k = p[1] !== undefined ? p[1] : p[2];
    if (k) keys.push(k);
  }
  return keys.length > 0 ? keys : null;
}

/**
 * 返回链式字符串中「最后一段 key」在 chain 内的起止偏移（仅 key 本身，不含 . 或 []）。
 * 用于判断光标是否在最后一段上，以便仅在该处显示悬停。
 */
function getLastKeyRangeInChain(chain) {
  const partRe = /\.\s*([a-zA-Z_][a-zA-Z0-9_]*)|\[\s*["']([^"']+)["']\s*\]/g;
  let last = null;
  let p;
  while ((p = partRe.exec(chain)) !== null) {
    const k = p[1] !== undefined ? p[1] : p[2];
    if (k) last = { start: p.index + p[0].indexOf(k), end: p.index + p[0].indexOf(k) + k.length };
  }
  return last;
}

const fullExprRe = /\bwindow\s*\.\s*siyuan\s*\.\s*languages\s*((?:\s*\.\s*[a-zA-Z_][a-zA-Z0-9_]*|\s*\[\s*["'][^"']*["']\s*\])+)/g;

/**
 * 从当前行解析出 window.siyuan.languages 的 key（支持链式）。
 * 仅当光标落在「最后一段」key 上（如 math、["142"] 里的 142）时才返回，避免整段悬停都弹文案。
 */
function getLangKeyAtPosition(document, position) {
  const lineText = document.lineAt(position.line).text;
  const lineStartOffset = document.offsetAt(new vscode.Position(position.line, 0));
  const cursorOffset = document.offsetAt(position);

  fullExprRe.lastIndex = 0;
  let m;
  while ((m = fullExprRe.exec(lineText)) !== null) {
    const chainStart = lineStartOffset + m.index + m[0].indexOf(m[1]);
    const keyRange = getLastKeyRangeInChain(m[1]);
    if (!keyRange) continue;
    const lastKeyStart = chainStart + keyRange.start;
    const lastKeyEnd = chainStart + keyRange.end;
    if (cursorOffset < lastKeyStart || cursorOffset > lastKeyEnd) continue;
    const keys = parseLanguagesChain(m[1]);
    if (keys) return keys.join(".");
  }
  return null;
}

/**
 * 在已读入的 content 中查找 key 所在行。key 可为 "a" 或 "a.b.c"（嵌套时用叶子键查找 "c": ）。
 */
function findKeyLineInContent(content, key) {
  const leafKey = key.includes(".") ? key.split(".").pop() : key;
  const lines = content.split(/\r?\n/);
  const escapedKey = leafKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp('^\\s*"' + escapedKey + '"\\s*:');
  for (let i = 0; i < lines.length; i++) {
    if (keyPattern.test(lines[i])) return i;
  }
  return -1;
}

/**
 * 从 JSON 内容前若干行推断当前行的“父路径”（如 ["_kernel"]），用于嵌套 key。
 * 通过简单扫描：见到 "key": { 则 push key，见到仅含 } 或 }, 则 pop。
 */
function getJsonKeyPathStackUpToLine(content, upToLineIndex) {
  const lines = content.split(/\r?\n/);
  const stack = [];
  const keyLineRe = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(\{)?/;
  const closeBraceRe = /^\s*\}\s*,?\s*$/;
  for (let i = 0; i <= upToLineIndex && i < lines.length; i++) {
    const line = lines[i];
    const keyM = line.match(keyLineRe);
    if (keyM) {
      if (keyM[2] === "{") stack.push(keyM[1]);
    } else if (closeBraceRe.test(line)) {
      stack.pop();
    }
  }
  return stack;
}

/**
 * 在语言文件（JSON）中，从当前行解析光标所在的键名（"key": 中的 key 部分）。
 * 支持嵌套：若该行在某个对象内，返回完整路径如 "_kernel.142"。仅当路径含 appearance/langs 且为 .json 时有效。
 */
function getJsonKeyAtPosition(document, position) {
  const uriPath = document.uri.fsPath || document.uri.path || "";
  const normalizedPath = uriPath.replace(/\\/g, "/");
  if (!normalizedPath.includes("appearance/langs") || !normalizedPath.endsWith(".json"))
    return null;
  const lineText = document.lineAt(position.line).text;
  const offset = document.offsetAt(position);
  const lineStartOffset = document.offsetAt(new vscode.Position(position.line, 0));
  const re = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/;
  const m = lineText.match(re);
  if (!m) return null;
  const openQuoteIdx = m[0].indexOf('"');
  const closeQuoteIdx = m[0].indexOf('"', openQuoteIdx + 1);
  const keyStart = lineStartOffset + m.index + openQuoteIdx;
  const keyEnd = lineStartOffset + m.index + closeQuoteIdx;
  if (offset < keyStart || offset > keyEnd) return null;
  const parentStack = getJsonKeyPathStackUpToLine(document.getText(), position.line);
  const key = m[1];
  return parentStack.length > 0 ? parentStack.join(".") + "." + key : key;
}

/**
 * 按配置或默认顺序得到要使用的语言文件列表（如 ["zh_CN.json", "en_US.json"]）。
 * 仅处理配置的 hoverLanguages / definitionLanguages，不扫描整个 langs 目录。
 */
function getOrderedLangFiles(langsDir, configKey) {
  const cfg = vscode.workspace.getConfiguration("vscode-siyuan-i18n").get(configKey);
  if (Array.isArray(cfg) && cfg.length > 0) {
    return cfg
      .map((l) => (typeof l === "string" && l.endsWith(".json") ? l : `${l}.json`))
      .filter((f) => fs.existsSync(path.join(langsDir, f)));
  }
  const files = fs.readdirSync(langsDir).filter((f) => f.endsWith(".json"));
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/**
 * 获取语言文件内容并缓存（按 mtime 失效）。返回 { content, parsed }。
 * 使用异步 I/O，不阻塞扩展宿主。
 */
async function getCachedFile(jsonPath, cache) {
  let stat;
  try {
    stat = await fsp.stat(jsonPath);
  } catch (e) {
    return null;
  }
  const mtime = stat.mtimeMs;
  const cached = cache.get(jsonPath);
  if (cached && cached.mtime === mtime) {
    return cached;
  }
  let content;
  try {
    content = await fsp.readFile(jsonPath, "utf8");
  } catch (e) {
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // 解析失败时仅保留 content，用于行号查找
  }
  const entry = { content, parsed, mtime };
  cache.set(jsonPath, entry);
  return entry;
}

/**
 * 一次读文件（或命中缓存）得到 key 的 value 与行号。key 支持嵌套 "a.b.c"（按路径取 parsed[a][b][c]）。
 */
async function getKeyInfoInJson(jsonPath, key, cache) {
  const file = await getCachedFile(jsonPath, cache);
  if (!file) return { value: null, lineIndex: -1 };
  let value = null;
  if (file.parsed != null) {
    let obj = file.parsed;
    const parts = key.split(".");
    for (const p of parts) {
      if (obj == null || typeof obj !== "object") break;
      obj = obj[p];
    }
    if (typeof obj === "string") value = obj;
  }
  const lineIndex = findKeyLineInContent(file.content, key);
  return { value, lineIndex };
}

/**
 * 解析工作区文件夹下的 langs 目录（支持 app 不在根目录，如多根工作区或子目录）。
 * 使用缓存，避免重复 findFiles。
 */
const langsDirCache = new Map();
async function getLangsDirForFolder(workspaceFolder) {
  if (!workspaceFolder) return null;
  const key = workspaceFolder.uri.fsPath;
  if (langsDirCache.has(key)) return langsDirCache.get(key);
  const uris = await vscode.workspace.findFiles(
    { base: workspaceFolder.uri, pattern: "**/appearance/langs/*.json" },
    null,
    1
  );
  const result = uris.length > 0 ? path.dirname(uris[0].fsPath) : null;
  langsDirCache.set(key, result);
  return result;
}

/** 收集该 key 在配置语种中的文案与行号（一次读每文件），用于悬停一次性展示 */
async function collectAllLangValues(langsDir, key, cache) {
  const entries = [];
  if (!langsDir || !fs.existsSync(langsDir)) return entries;
  const files = getOrderedLangFiles(langsDir, "hoverLanguages");
  for (const file of files) {
    const jsonPath = path.join(langsDir, file);
    const { value, lineIndex } = await getKeyInfoInJson(jsonPath, key, cache);
    if (value != null) {
      const langName = file.replace(/\.json$/, "");
      entries.push({ lang: langName, value, lineIndex });
    }
  }
  return entries;
}

/** 收集配置语种文件中该 key 的位置（使用缓存，不重复读盘） */
async function collectDefinitionLocations(langsDir, key, cache) {
  const locations = [];
  if (!langsDir || !fs.existsSync(langsDir)) return locations;
  const files = getOrderedLangFiles(langsDir, "definitionLanguages");
  for (const file of files) {
    const jsonPath = path.join(langsDir, file);
    const fileData = await getCachedFile(jsonPath, cache);
    if (!fileData) continue;
    const lineIndex = findKeyLineInContent(fileData.content, key);
    if (lineIndex >= 0) {
      locations.push(
        new vscode.Location(
          vscode.Uri.file(jsonPath),
          new vscode.Position(lineIndex, 0)
        )
      );
    }
  }
  return locations;
}

/** 正则转义，用于在正则中匹配字面量 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 为链式 key 路径（如 "_kernel.142"）生成 ripgrep 可用的正则列表，覆盖 .a["b"]、["a"]["b"] 等写法。
 */
function buildChainRipgrepPatterns(keyPath) {
  const segments = keyPath.split(".");
  const suffixList = [];
  for (const seg of segments) {
    const escaped = escapeRegex(seg);
    const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg);
    const options = [
      "\\[\"" + escaped + "\"\\]",
      "\\[\'" + escaped.replace(/'/g, "\\'") + "\'\\]",
    ];
    if (ident) options.unshift("\\.\\s*" + escaped + "\\b");
    suffixList.push(options);
  }
  const patterns = [];
  function build(prefix, idx) {
    if (idx === segments.length) {
      patterns.push(prefix);
      return;
    }
    for (const part of suffixList[idx]) build(prefix + part, idx + 1);
  }
  build("window\\.siyuan\\.languages", 0);
  return patterns;
}

/**
 * 从工作区根目录读取 .gitignore，将规则转为 findFiles 可用的 exclude 用 glob 列表。
 * 简化规则：空行与 # 注释跳过，! 取反跳过；其余每行转为「任意路径/pattern/」或「任意路径/pattern」形式。
 */
const gitignoreExcludeCache = new Map();
function getGitignoreExcludeGlobs(workspaceFolder) {
  if (!workspaceFolder) return [];
  const key = workspaceFolder.uri.fsPath;
  if (gitignoreExcludeCache.has(key)) return gitignoreExcludeCache.get(key);
  const gitignorePath = path.join(key, ".gitignore");
  let lines = [];
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    lines = content.split(/\r?\n/);
  } catch (e) {
    gitignoreExcludeCache.set(key, []);
    return [];
  }
  const globs = new Set();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) continue;
    if (t.includes("*") && !t.includes("/")) {
      globs.add("**/" + t);
    } else if (t.endsWith("/")) {
      globs.add("**/" + t.slice(0, -1) + "/**");
    } else if (t.startsWith("/")) {
      globs.add("**/" + t.slice(1) + "/**");
    } else {
      globs.add("**/" + t + "/**");
    }
  }
  globs.add("**/node_modules/**");
  const result = Array.from(globs);
  gitignoreExcludeCache.set(key, result);
  return result;
}

/**
 * 将 glob 数组合并为 findFiles exclude 参数（使用 {a,b,c} 形式）。
 */
function mergeExcludeGlobs(globs) {
  if (globs.length === 0) return "**/node_modules/**";
  if (globs.length === 1) return globs[0];
  return "{" + globs.join(",") + "}";
}

/**
 * 返回用于执行 ripgrep 的命令路径：优先使用扩展 bin 目录下的 rg（内置），否则为 "rg"（依赖系统 PATH）。
 * 内置时无需用户安装；可将 GitHub 发布的 rg.exe 放入扩展目录的 bin 文件夹。
 */
function getRipgrepPath() {
  if (extensionPath) {
    const isWin = process.platform === "win32";
    const binName = isWin ? "rg.exe" : "rg";
    const bundled = path.join(extensionPath, "bin", binName);
    if (fs.existsSync(bundled)) return bundled;
  }
  return "rg";
}

/**
 * 使用 ripgrep (rg) 在工作区中搜索 i18n key 的引用，速度快且默认遵守 .gitignore。
 * 优先使用扩展内置的 bin/rg，否则使用系统 PATH 中的 rg。若均不可用则返回 null。
 */
function findReferencesToKeyWithRipgrep(workspaceFolder, key, token) {
  return new Promise((resolve, reject) => {
    const root = workspaceFolder.uri.fsPath;
    const isChain = key.includes(".");
    const patterns = isChain
      ? buildChainRipgrepPatterns(key)
      : (() => {
          const escapedKey = escapeRegex(key);
          const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
          const list = [
            "window\\.siyuan\\.languages\\[\"" + escapedKey + "\"\\]",
            "window\\.siyuan\\.languages\\['" + escapedKey.replace(/'/g, "\\'") + "'\\]",
          ];
          if (ident) list.unshift("window\\.siyuan\\.languages\\." + escapedKey + "\\b");
          return list;
        })();
    const args = ["-n", "--column", "-o", "--glob", "*.ts", "--glob", "*.js", "--glob", "*.tsx", "--glob", "*.jsx"];
    for (const p of patterns) args.push("-e", p);
    args.push("--", root);

    const rgPath = getRipgrepPath();
    const proc = spawn(rgPath, args, {
      cwd: root,
      shell: false,
    });
    const chunks = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", () => {});
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (token.isCancellationRequested) {
        resolve([]);
        return;
      }
      if (code === 1) {
        resolve([]);
        return;
      }
      if (code !== 0) {
        resolve(null);
        return;
      }
      const out = Buffer.concat(chunks).toString("utf8");
      const locations = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const parts = line.split(":");
        if (parts.length < 4) continue;
        const matchText = parts.pop();
        const col = parseInt(parts.pop(), 10);
        const lineNum = parseInt(parts.pop(), 10);
        const filePath = parts.join(":");
        if (!filePath || isNaN(lineNum) || isNaN(col)) continue;
        const uri = vscode.Uri.file(filePath);
        const start = new vscode.Position(lineNum - 1, col - 1);
        const end = new vscode.Position(lineNum - 1, col - 1 + matchText.length);
        locations.push(new vscode.Location(uri, new vscode.Range(start, end)));
      }
      resolve(locations);
    });
  });
}

/**
 * 检查当前环境是否可用 ripgrep (rg)。返回 { ok, message }。
 */
function checkRipgrepAvailable() {
  return new Promise((resolve) => {
    const rgPath = getRipgrepPath();
    const proc = spawn(rgPath, ["--version"], {
      shell: false,
    });
    const chunks = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => chunks.push(c));
    proc.on("error", (err) => {
      const hint =
        rgPath !== "rg"
          ? "内置 rg 执行失败，请检查扩展 bin 目录下的 rg 是否完整。"
          : "未找到 ripgrep。请安装（如 winget install BurntSushi.ripgrep）或将 rg.exe 放入本扩展目录的 bin 文件夹。";
      resolve({ ok: false, message: hint, error: err.message });
    });
    proc.on("close", (code, signal) => {
      const out = Buffer.concat(chunks).toString("utf8").trim();
      const firstLine = out.split(/\r?\n/)[0] || "";
      const looksLikeRipgrep = /ripgrep|rg\s+\d/i.test(out);
      if (code === 0 || (code === 1 && looksLikeRipgrep)) {
        resolve({ ok: true, message: firstLine || "ripgrep" });
      } else {
        resolve({
          ok: false,
          message: code === 1
            ? "rg 退出码 1 且输出不像 ripgrep，可能 PATH 中是其他同名程序。请确认安装的是 BurntSushi/ripgrep 并优先在 PATH 中。"
            : `rg 退出码 ${code}${signal ? `，信号 ${signal}` : ""}`,
        });
      }
    });
  });
}

/**
 * 在工作区中搜索使用该 i18n key 的代码位置。仅使用 ripgrep；不可用时返回 []。
 */
async function findReferencesToKey(workspaceFolder, key, token) {
  if (!workspaceFolder || !key) return [];
  const result = await findReferencesToKeyWithRipgrep(workspaceFolder, key, token);
  return result !== null ? result : [];
}

function activate(context) {
  extensionPath = context.extensionPath;
  // 语言文件缓存：jsonPath -> { content, parsed, mtime }，语言文件变更时失效
  const langFileCache = new Map();
  const langsDirGlob = "**/appearance/langs/*.json";
  const watcher = vscode.workspace.createFileSystemWatcher(langsDirGlob);
  watcher.onDidChange((uri) => {
    const p = uri.fsPath;
    if (p) langFileCache.delete(p);
  });
  watcher.onDidCreate((uri) => {
    const p = uri.fsPath;
    if (p) langFileCache.delete(p);
  });
  watcher.onDidDelete((uri) => {
    const p = uri.fsPath;
    if (p) langFileCache.delete(p);
  });
  context.subscriptions.push(watcher);

  // .gitignore 变更时清除排除规则缓存，使“查找键引用”按最新 gitignore 排除
  const gitignoreWatcher = vscode.workspace.createFileSystemWatcher("**/.gitignore");
  gitignoreWatcher.onDidChange(() => gitignoreExcludeCache.clear());
  gitignoreWatcher.onDidCreate(() => gitignoreExcludeCache.clear());
  gitignoreWatcher.onDidDelete(() => gitignoreExcludeCache.clear());
  context.subscriptions.push(gitignoreWatcher);

  // 命令：检查 ripgrep 是否可用（用于排查“查找键引用”无结果）
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.checkRipgrep", async () => {
      const { ok, message } = await checkRipgrepAvailable();
      if (ok) {
        vscode.window.showInformationMessage(`ripgrep 可用：${message}`);
      } else {
        vscode.window.showWarningMessage(`SiYuan i18n：${message}`);
      }
    })
  );

  // 命令：打开语种文件并定位到 key 所在行（供悬停中的链接调用）
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.openAtLine", async (filePath, lineIndex) => {
      if (typeof filePath !== "string" || typeof lineIndex !== "number") return;
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = new vscode.Position(lineIndex, 0);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        preview: false,
      });
    })
  );

  const provider = {
    async provideDefinition(document, position, token) {
      if (token.isCancellationRequested) return null;
      const key = getLangKeyAtPosition(document, position);
      if (!key) return null;

      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const langsDir = await getLangsDirForFolder(folder);
      if (!langsDir) return null;

      const locations = await collectDefinitionLocations(langsDir, key, langFileCache);
      if (token.isCancellationRequested) return null;
      if (locations.length === 0) return null;
      return locations;
    },
  };

  const selector = [
    { language: "javascript" },
    { language: "typescript" },
    { language: "javascriptreact" },
    { language: "typescriptreact" },
  ];
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, provider));

  // 悬停时一次性展示所有语种文案（全部展开），使用 collectAllLangValues 返回的 lineIndex，不再重复读文件
  const hoverProvider = {
    async provideHover(document, position, token) {
      if (token.isCancellationRequested) return null;
      const key = getLangKeyAtPosition(document, position);
      if (!key) return null;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const langsDir = await getLangsDirForFolder(folder);
      if (!langsDir) return null;
      const entries = await collectAllLangValues(langsDir, key, langFileCache);
      if (token.isCancellationRequested) return null;
      if (entries.length === 0) return null;
      const md = new vscode.MarkdownString();
      md.supportHtml = true;
      const escapeHtml = (s) =>
        s.replace(/\n/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      md.appendMarkdown("<table>");
      for (const { lang, value, lineIndex } of entries) {
        const jsonPath = path.join(langsDir, `${lang}.json`);
        const cmdUri =
          lineIndex >= 0
            ? `command:vscode-siyuan-i18n.openAtLine?${encodeURIComponent(JSON.stringify([jsonPath, lineIndex]))}`
            : "#";
        md.appendMarkdown(
          `<tr><td><a href="${cmdUri}"><code>${lang}</code></a></td><td>${escapeHtml(value)}</td></tr>`
        );
      }
      md.appendMarkdown("</table>");
      md.isTrusted = true;
      return new vscode.Hover(md);
    },
  };
  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, hoverProvider));

  // 语言文件（JSON）中 Ctrl+点击键名：显示所有使用该文案的引用（仅用 pattern 匹配，不依赖 language id）
  const jsonLangSelector = [{ scheme: "file", pattern: "**/appearance/langs/*.json" }];
  const refProvider = {
    async provideReferences(document, position, context, token) {
      const key = getJsonKeyAtPosition(document, position);
      if (!key) return [];
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      return findReferencesToKey(folder, key, token);
    },
  };
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(jsonLangSelector, refProvider)
  );
  // DefinitionProvider 返回相同引用列表，使 Ctrl+点击弹出引用菜单
  const defProviderForJson = {
    async provideDefinition(document, position, token) {
      const key = getJsonKeyAtPosition(document, position);
      if (!key) return null;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const locations = await findReferencesToKey(folder, key, token);
      if (token.isCancellationRequested || locations.length === 0) return null;
      return locations;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(jsonLangSelector, defProviderForJson)
  );

  // 命令：在语言文件键名上执行“查找引用”，便于从命令面板或右键触发
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.findReferencesToKey", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const key = getJsonKeyAtPosition(editor.document, editor.selection.active);
      if (!key) {
        vscode.window.showWarningMessage("请将光标放在语言文件的键名上（如 \"staff\" 的 staff）。");
        return;
      }
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const locations = await findReferencesToKey(folder, key, new vscode.CancellationTokenSource().token);
      if (locations.length === 0) {
        vscode.window.showInformationMessage(`未找到键「${key}」的引用。`);
        return;
      }
      await vscode.commands.executeCommand(
        "editor.action.revealReferences",
        editor.document.uri,
        editor.selection.active,
        locations
      );
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
