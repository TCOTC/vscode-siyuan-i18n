// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as ts from "typescript";
import { spawn } from "child_process";

/** 扩展安装目录，在 activate 中赋值，用于解析内置 ripgrep 路径 */
let extensionPath = "";

/**
 * 使用 TypeScript AST 解析 window.siyuan.languages 的 key。
 * 仅当光标在最后一部分（如 [214] 或 .cloudIntro）时才返回。
 */
function getLangKeyAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | null {
  try {
    const sourceFile = ts.createSourceFile(
      document.uri.fsPath,
      document.getText(),
      ts.ScriptTarget.Latest,
      true,
    );

    const offset = document.offsetAt(position);

    function findNode(node: ts.Node): ts.Node | null {
      if (node.getStart(sourceFile) <= offset && offset <= node.getEnd()) {
        for (const child of node.getChildren(sourceFile)) {
          const found = findNode(child);
          if (found) {
            return found;
          }
        }
        return node;
      }
      return null;
    }

    const leafNode = findNode(sourceFile);
    if (!leafNode) {
      return null;
    }

    let outermostExpr: ts.Node | null = null;

    // 对于括号和字符串字面量或数字字面量，找到父级的 ElementAccessExpression
    if (ts.isStringLiteral(leafNode) || ts.isNumericLiteral(leafNode)) {
      let p = leafNode.parent;
      if (p && ts.isElementAccessExpression(p)) {
        outermostExpr = p;
      }
    } else if (
      leafNode.kind === ts.SyntaxKind.OpenBracketToken ||
      leafNode.kind === ts.SyntaxKind.CloseBracketToken
    ) {
      // 括号，直接找祖父的 ElementAccessExpression
      let p = leafNode.parent;
      if (p && p.parent && ts.isElementAccessExpression(p.parent)) {
        outermostExpr = p.parent;
      }
    } else if (ts.isIdentifier(leafNode)) {
      // 对于标识符，检查是否是 PropertyAccessExpression 的 name
      let p = leafNode.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.name === leafNode) {
        outermostExpr = p;
      }
    }

    // 如果还没找到，向上遍历查找最外层的访问表达式
    if (!outermostExpr) {
      let current: ts.Node | undefined = leafNode;
      let best: ts.Node | null = null;
      while (current) {
        if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
          best = current;
        }
        current = current.parent;
      }
      outermostExpr = best;
    }

    if (!outermostExpr) {
      return null;
    }

    // 获取访问路径
    return getAccessPath(outermostExpr);
  } catch (e) {
    return null;
  }
}

/**
 * 从节点构建访问路径，如 "_kernel.214"。
 */
function getAccessPath(node: ts.Node): string | null {
  const parts: string[] = [];
  let current: ts.Node | undefined = node;
  let sawWindow = false;
  while (current) {
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      const arg = current.argumentExpression;
      if (ts.isStringLiteral(arg)) {
        parts.unshift(arg.text);
      } else if (ts.isNumericLiteral(arg)) {
        parts.unshift(arg.text);
      } else {
        return null; // 不支持复杂表达式
      }
      current = current.expression;
      continue;
    }
    if (ts.isIdentifier(current) && current.text === "window") {
      sawWindow = true;
    }
    break;
  }
  if (!sawWindow) {
    return null;
  }
  if (parts.length < 2 || parts[0] !== "siyuan" || parts[1] !== "languages") {
    return null;
  }
  return parts.slice(2).join(".");
}

/**
 * 在已读入的 content 中查找 key 所在行。key 可为 "a" 或 "a.b.c"（嵌套时用叶子键查找 "c": ）。
 */
function findKeyLineInContent(content: string, key: string): number {
  const leafKey = key.includes(".") ? key.split(".").pop()! : key;
  const lines = content.split(/\r?\n/);
  const escapedKey = leafKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp('^\\s*"' + escapedKey + '"\\s*:');
  for (let i = 0; i < lines.length; i++) {
    if (keyPattern.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * 从 JSON 内容前若干行推断当前行的“父路径”（如 ["_kernel"]），用于嵌套 key。
 * 通过简单扫描：见到 "key": { 则 push key，见到仅含 } 或 }, 则 pop。
 */
function getJsonKeyPathStackUpToLine(content: string, upToLineIndex: number): string[] {
  const lines = content.split(/\r?\n/);
  const stack: string[] = [];
  const keyLineRe = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(\{)?/;
  const closeBraceRe = /^\s*\}\s*,?\s*$/;
  for (let i = 0; i <= upToLineIndex && i < lines.length; i++) {
    const line = lines[i];
    const keyM = line.match(keyLineRe);
    if (keyM) {
      if (keyM[2] === "{") {
        stack.push(keyM[1]);
      }
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
function getJsonKeyAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): string | null {
  const uriPath = document.uri.fsPath || document.uri.path || "";
  const normalizedPath = uriPath.replace(/\\/g, "/");
  if (!normalizedPath.includes("appearance/langs") || !normalizedPath.endsWith(".json")) {
    return null;
  }
  const lineText = document.lineAt(position.line).text;
  const offset = document.offsetAt(position);
  const lineStartOffset = document.offsetAt(new vscode.Position(position.line, 0));
  const re = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/;
  const m = lineText.match(re);
  if (!m || m.index === undefined) {
    return null;
  }
  const openQuoteIdx = m[0].indexOf('"');
  const closeQuoteIdx = m[0].indexOf('"', openQuoteIdx + 1);
  const keyStart = lineStartOffset + m.index + openQuoteIdx;
  const keyEnd = lineStartOffset + m.index + closeQuoteIdx;
  if (offset < keyStart || offset > keyEnd) {
    return null;
  }
  const parentStack = getJsonKeyPathStackUpToLine(document.getText(), position.line);
  const key = m[1];
  return parentStack.length > 0 ? parentStack.join(".") + "." + key : key;
}

/**
 * 按配置或默认顺序得到要使用的语言文件列表（如 ["zh_CN.json", "en_US.json"]）。
 * 仅处理配置的 hoverLanguages / definitionLanguages，不扫描整个 langs 目录。
 */
function getOrderedLangFiles(langsDir: string, configKey: string): string[] {
  const cfg = vscode.workspace.getConfiguration("vscode-siyuan-i18n").get(configKey);
  if (Array.isArray(cfg) && cfg.length > 0) {
    return cfg
      .map((l: any) => (typeof l === "string" && l.endsWith(".json") ? l : `${l}.json`))
      .filter((f: string) => fs.existsSync(path.join(langsDir, f)));
  }
  const files = fs.readdirSync(langsDir).filter((f: string) => f.endsWith(".json"));
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

interface CachedFile {
  content: string;
  parsed: any;
  mtime: number;
}

/**
 * 获取语言文件内容并缓存（按 mtime 失效）。返回 { content, parsed }。
 * 使用异步 I/O，不阻塞扩展宿主。
 */
async function getCachedFile(
  jsonPath: string,
  cache: Map<string, CachedFile>,
): Promise<CachedFile | null> {
  let stat: fs.Stats;
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
  let content: string;
  try {
    content = await fsp.readFile(jsonPath, "utf8");
  } catch (e) {
    return null;
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // 解析失败时仅保留 content，用于行号查找
  }
  const entry: CachedFile = { content, parsed, mtime };
  cache.set(jsonPath, entry);
  return entry;
}

/**
 * 一次读文件（或命中缓存）得到 key 的 value 与行号。key 支持嵌套 "a.b.c"（按路径取 parsed[a][b][c]）。
 */
async function getKeyInfoInJson(
  jsonPath: string,
  key: string,
  cache: Map<string, CachedFile>,
): Promise<{ value: string | null; lineIndex: number }> {
  const file = await getCachedFile(jsonPath, cache);
  if (!file) {
    return { value: null, lineIndex: -1 };
  }
  let value: string | null = null;
  if (file.parsed !== null) {
    let obj = file.parsed;
    const parts = key.split(".");
    for (const p of parts) {
      if (obj === null || typeof obj !== "object") {
        break;
      }
      obj = obj[p];
    }
    if (typeof obj === "string") {
      value = obj;
    }
  }
  const lineIndex = findKeyLineInContent(file.content, key);
  return { value, lineIndex };
}

/**
 * 解析工作区文件夹下的 langs 目录（支持 app 不在根目录，如多根工作区或子目录）。
 * 使用缓存，避免重复 findFiles。
 */
const langsDirCache = new Map<string, string | null>();
async function getLangsDirForFolder(
  workspaceFolder: vscode.WorkspaceFolder | undefined,
): Promise<string | null> {
  if (!workspaceFolder) {
    return null;
  }
  const key = workspaceFolder.uri.fsPath;
  if (langsDirCache.has(key)) {
    return langsDirCache.get(key)!;
  }
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder.uri, "**/appearance/langs/*.json"),
    null,
    1,
  );
  const result = uris.length > 0 ? path.dirname(uris[0].fsPath) : null;
  langsDirCache.set(key, result);
  return result;
}

/** 收集该 key 在配置语种中的文案与行号（一次读每文件），用于悬停一次性展示 */
async function collectAllLangValues(
  langsDir: string,
  key: string,
  cache: Map<string, CachedFile>,
): Promise<{ lang: string; value: string; lineIndex: number }[]> {
  const entries: { lang: string; value: string; lineIndex: number }[] = [];
  if (!langsDir || !fs.existsSync(langsDir)) {
    return entries;
  }
  const files = getOrderedLangFiles(langsDir, "hoverLanguages");
  for (const file of files) {
    const jsonPath = path.join(langsDir, file);
    const { value, lineIndex } = await getKeyInfoInJson(jsonPath, key, cache);
    if (value !== null) {
      const langName = file.replace(/\.json$/, "");
      entries.push({ lang: langName, value, lineIndex });
    }
  }
  return entries;
}

/** 收集配置语种文件中该 key 的位置（使用缓存，不重复读盘） */
async function collectDefinitionLocations(
  langsDir: string,
  key: string,
  cache: Map<string, CachedFile>,
): Promise<vscode.Location[]> {
  const locations: vscode.Location[] = [];
  if (!langsDir || !fs.existsSync(langsDir)) {
    return locations;
  }
  const files = getOrderedLangFiles(langsDir, "definitionLanguages");
  for (const file of files) {
    const jsonPath = path.join(langsDir, file);
    const fileData = await getCachedFile(jsonPath, cache);
    if (!fileData) {
      continue;
    }
    const lineIndex = findKeyLineInContent(fileData.content, key);
    if (lineIndex >= 0) {
      locations.push(
        new vscode.Location(vscode.Uri.file(jsonPath), new vscode.Position(lineIndex, 0)),
      );
    }
  }
  return locations;
}

/** 正则转义，用于在正则中匹配字面量 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 为链式 key 路径（如 "_kernel.142"）生成 ripgrep 可用的正则列表，覆盖 .a["b"]、["a"]["b"]、.a[123] 等写法。
 */
function buildChainRipgrepPatterns(keyPath: string): string[] {
  const segments = keyPath.split(".");
  const suffixList: string[][] = [];
  for (const seg of segments) {
    const escaped = escapeRegex(seg);
    const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg);
    const isNumber = /^\d+$/.test(seg);
    const options: string[] = [];
    if (isNumber) {
      options.push("\\[" + escaped + "\\]");
    } else {
      options.push('\\["' + escaped + '"\\]');
      options.push("\\[\'" + escaped.replace(/'/g, "\\'") + "\'\\]");
    }
    if (ident) {
      options.unshift("\\.\\s*" + escaped + "\\b");
    }
    suffixList.push(options);
  }
  const patterns: string[] = [];
  function build(prefix: string, idx: number) {
    if (idx === segments.length) {
      patterns.push(prefix);
      return;
    }
    for (const part of suffixList[idx]) {
      build(prefix + part, idx + 1);
    }
  }
  build("window\\.siyuan\\.languages", 0);
  return patterns;
}

/**
 * 从工作区根目录读取 .gitignore，将规则转为 findFiles 可用的 exclude 用 glob 列表。
 * 简化规则：空行与 # 注释跳过，! 取反跳过；其余每行转为「任意路径/pattern/」或「任意路径/pattern」形式。
 */
const gitignoreExcludeCache = new Map<string, string[]>();
function getGitignoreExcludeGlobs(workspaceFolder: vscode.WorkspaceFolder): string[] {
  if (!workspaceFolder) {
    return [];
  }
  const key = workspaceFolder.uri.fsPath;
  if (gitignoreExcludeCache.has(key)) {
    return gitignoreExcludeCache.get(key)!;
  }
  const gitignorePath = path.join(key, ".gitignore");
  let lines: string[] = [];
  try {
    const content = fs.readFileSync(gitignorePath, "utf8");
    lines = content.split(/\r?\n/);
  } catch (e) {
    gitignoreExcludeCache.set(key, []);
    return [];
  }
  const globs = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("!")) {
      continue;
    }
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
function mergeExcludeGlobs(globs: string[]): string {
  if (globs.length === 0) {
    return "**/node_modules/**";
  }
  if (globs.length === 1) {
    return globs[0];
  }
  return "{" + globs.join(",") + "}";
}

/**
 * 返回用于执行 ripgrep 的命令路径：优先使用扩展 bin 目录下的 rg（内置），否则为 "rg"（依赖系统 PATH）。
 * 内置时无需用户安装；可将 GitHub 发布的 rg.exe 放入扩展目录的 bin 文件夹。
 */
function getRipgrepPath(): string {
  if (extensionPath) {
    const isWin = process.platform === "win32";
    const binName = isWin ? "rg.exe" : "rg";
    const bundled = path.join(extensionPath, "bin", binName);
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return "rg";
}

/**
 * 使用 ripgrep (rg) 在工作区中搜索 i18n key 的引用，速度快且默认遵守 .gitignore。
 * 优先使用扩展内置的 bin/rg，否则使用系统 PATH 中的 rg。若均不可用则返回 null。
 */
function findReferencesToKeyWithRipgrep(
  workspaceFolder: vscode.WorkspaceFolder,
  key: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | null> {
  return new Promise((resolve, reject) => {
    const root = workspaceFolder.uri.fsPath;
    const isChain = key.includes(".");
    const patterns = isChain
      ? buildChainRipgrepPatterns(key)
      : (() => {
          const escapedKey = escapeRegex(key);
          const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
          const list = [
            'window\\.siyuan\\.languages\\["' + escapedKey + '"\\]',
            "window\\.siyuan\\.languages\\['" + escapedKey.replace(/'/g, "\\'") + "'\\]",
          ];
          if (ident) {
            list.unshift("window\\.siyuan\\.languages\\." + escapedKey + "\\b");
          }
          return list;
        })();
    const args = [
      "-n",
      "--column",
      "-o",
      "--glob",
      "*.ts",
      "--glob",
      "*.js",
      "--glob",
      "*.tsx",
      "--glob",
      "*.jsx",
    ];
    for (const p of patterns) {
      args.push("-e", p);
    }
    args.push("--", root);

    const rgPath = getRipgrepPath();
    const proc = spawn(rgPath, args, {
      cwd: root,
      shell: false,
    });
    const chunks: Buffer[] = [];
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
      const locations: vscode.Location[] = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        const parts = line.split(":");
        if (parts.length < 4) {
          continue;
        }
        const matchText = parts.pop()!;
        const col = parseInt(parts.pop()!, 10);
        const lineNum = parseInt(parts.pop()!, 10);
        const filePath = parts.join(":");
        if (!filePath || isNaN(lineNum) || isNaN(col)) {
          continue;
        }
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
function checkRipgrepAvailable(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const rgPath = getRipgrepPath();
    const proc = spawn(rgPath, ["--version"], {
      shell: false,
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => chunks.push(c));
    proc.on("error", (err) => {
      const hint =
        rgPath !== "rg"
          ? "内置 rg 执行失败，请检查扩展 bin 目录下的 rg 是否完整。"
          : "未找到 ripgrep。请安装（如 winget install BurntSushi.ripgrep）或将 rg.exe 放入本扩展目录的 bin 文件夹。";
      resolve({ ok: false, message: hint });
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
          message:
            code === 1
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
async function findReferencesToKey(
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  key: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
  if (!workspaceFolder || !key) {
    return [];
  }
  const result = await findReferencesToKeyWithRipgrep(workspaceFolder, key, token);
  return result !== null ? result : [];
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  extensionPath = context.extensionPath;
  // 语言文件缓存：jsonPath -> { content, parsed, mtime }，语言文件变更时失效
  const langFileCache = new Map<string, CachedFile>();
  const langsDirGlob = "**/appearance/langs/*.json";
  const watcher = vscode.workspace.createFileSystemWatcher(langsDirGlob);
  watcher.onDidChange((uri) => {
    const p = uri.fsPath;
    if (p) {
      langFileCache.delete(p);
    }
  });
  watcher.onDidCreate((uri) => {
    const p = uri.fsPath;
    if (p) {
      langFileCache.delete(p);
    }
  });
  watcher.onDidDelete((uri) => {
    const p = uri.fsPath;
    if (p) {
      langFileCache.delete(p);
    }
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
    }),
  );

  // 命令：打开语种文件并定位到 key 所在行（供悬停中的链接调用）
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vscode-siyuan-i18n.openAtLine",
      async (filePath: string, lineIndex: number) => {
        if (typeof filePath !== "string" || typeof lineIndex !== "number") {
          return;
        }
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const pos = new vscode.Position(lineIndex, 0);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(pos, pos),
          preview: false,
        });
      },
    ),
  );

  const provider = {
    async provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ) {
      if (token.isCancellationRequested) {
        return null;
      }
      const key = getLangKeyAtPosition(document, position);
      if (!key) {
        return null;
      }

      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const langsDir = await getLangsDirForFolder(folder);
      if (!langsDir) {
        return null;
      }

      const locations = await collectDefinitionLocations(langsDir, key, langFileCache);
      if (token.isCancellationRequested) {
        return null;
      }
      if (locations.length === 0) {
        return null;
      }
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
    async provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ) {
      if (token.isCancellationRequested) {
        return null;
      }
      const key = getLangKeyAtPosition(document, position);
      if (!key) {
        return null;
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const langsDir = await getLangsDirForFolder(folder);
      if (!langsDir) {
        return null;
      }
      const entries = await collectAllLangValues(langsDir, key, langFileCache);
      if (token.isCancellationRequested) {
        return null;
      }
      if (entries.length === 0) {
        return null;
      }
      const md = new vscode.MarkdownString();
      md.supportHtml = true;
      const escapeHtml = (s: string) =>
        s
          .replace(/\n/g, " ")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      md.appendMarkdown("<table>");
      for (const { lang, value, lineIndex } of entries) {
        const jsonPath = path.join(langsDir, `${lang}.json`);
        const cmdUri =
          lineIndex >= 0
            ? `command:vscode-siyuan-i18n.openAtLine?${encodeURIComponent(JSON.stringify([jsonPath, lineIndex]))}`
            : "#";
        md.appendMarkdown(
          `<tr><td><a href="${cmdUri}"><code>${lang}</code></a></td><td>${escapeHtml(value)}</td></tr>`,
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
    async provideReferences(
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.ReferenceContext,
      token: vscode.CancellationToken,
    ) {
      const key = getJsonKeyAtPosition(document, position);
      if (!key) {
        return [];
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      return findReferencesToKey(folder, key, token);
    },
  };
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(jsonLangSelector, refProvider),
  );
  // DefinitionProvider 返回相同引用列表，使 Ctrl+点击弹出引用菜单
  const defProviderForJson = {
    async provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ) {
      const key = getJsonKeyAtPosition(document, position);
      if (!key) {
        return null;
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const locations = await findReferencesToKey(folder, key, token);
      if (token.isCancellationRequested || locations.length === 0) {
        return null;
      }
      return locations;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(jsonLangSelector, defProviderForJson),
  );

  // 命令：在语言文件键名上执行“查找引用”，便于从命令面板或右键触发
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.findReferencesToKey", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const key = getJsonKeyAtPosition(editor.document, editor.selection.active);
      if (!key) {
        vscode.window.showWarningMessage('请将光标放在语言文件的键名上（如 "staff" 的 staff）。');
        return;
      }
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const locations = await findReferencesToKey(
        folder,
        key,
        new vscode.CancellationTokenSource().token,
      );
      if (locations.length === 0) {
        vscode.window.showInformationMessage(`未找到键「${key}」的引用。`);
        return;
      }
      await vscode.commands.executeCommand(
        "editor.action.revealReferences",
        editor.document.uri,
        editor.selection.active,
        locations,
      );
    }),
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
