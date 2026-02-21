import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import ts from "typescript";
import { spawn } from "child_process";

export interface CachedFile {
  content: string;
  parsed: any;
  mtime: number;
}

/** 扩展安装目录 */
export let extensionPath = "";

export function setExtensionPath(path: string): void {
  extensionPath = path;
}

/**
 * 使用 TypeScript AST 解析 window.siyuan.languages 的 key。
 * 仅当光标在最后一部分（如 [214] 或 .cloudIntro）时才返回。
 */
export function getLangKeyAtPosition(
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

    if (ts.isStringLiteral(leafNode) || ts.isNumericLiteral(leafNode)) {
      let p = leafNode.parent;
      if (p && ts.isElementAccessExpression(p)) {
        outermostExpr = p;
      }
    } else if (
      leafNode.kind === ts.SyntaxKind.OpenBracketToken ||
      leafNode.kind === ts.SyntaxKind.CloseBracketToken
    ) {
      let p = leafNode.parent;
      if (p && p.parent && ts.isElementAccessExpression(p.parent)) {
        outermostExpr = p.parent;
      }
    } else if (ts.isIdentifier(leafNode)) {
      let p = leafNode.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.name === leafNode) {
        outermostExpr = p;
      }
    }

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

    return getAccessPath(outermostExpr);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    return null;
  }
}

/**
 * 从节点构建访问路径，如 "_kernel.214"。
 */
export function getAccessPath(node: ts.Node): string | null {
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
        return null;
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
 * 在已读入的 content 中查找 key 所在行。
 */
export function findKeyLineInContent(content: string, key: string): number {
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
 * 按配置或默认顺序得到要使用的语言文件列表。
 */
export function getOrderedLangFiles(langsDir: string, configKey: string): string[] {
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

/**
 * 获取语言文件内容并缓存。
 */
export async function getCachedFile(
  jsonPath: string,
  cache: Map<string, CachedFile>,
): Promise<CachedFile | null> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(jsonPath);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    return null;
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // 解析失败时仅保留 content，用于行号查找
  }
  const entry: CachedFile = { content, parsed, mtime };
  cache.set(jsonPath, entry);
  return entry;
}

const langsDirCache = new Map<string, string | null>();
/**
 * 解析工作区文件夹下的 langs 目录。
 */
export async function getLangsDirForFolder(
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

/**
 * 正则转义。
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 为链式 key 路径生成 ripgrep 可用的正则列表。
 */
export function buildChainRipgrepPatterns(keyPath: string): string[] {
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
      options.push("\\['" + escaped.replace(/'/g, "\\'") + "'\\]");
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
 * 返回用于执行 ripgrep 的命令路径。
 */
export function getRipgrepPath(): string {
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
 * 使用 ripgrep (rg) 在工作区中搜索 i18n key 的引用。
 */
export function findReferencesToKeyWithRipgrep(
  workspaceFolder: vscode.WorkspaceFolder,
  key: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[] | null> {
  return new Promise((resolve, _reject) => {
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
 * 检查当前环境是否可用 ripgrep (rg)。
 */
export function checkRipgrepAvailable(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const rgPath = getRipgrepPath();
    const proc = spawn(rgPath, ["--version"], {
      shell: false,
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => chunks.push(c));
    proc.on("error", (_err) => {
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
