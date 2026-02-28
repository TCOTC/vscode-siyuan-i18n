import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promises as fsp } from "fs";
import ts from "typescript";
import ignore from "ignore";

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
const gitignoreMatcherCache = new Map<string, ((fsPath: string) => boolean) | null>();

function normalizeFsPath(fsPath: string): string {
  return fsPath.replace(/\\/g, "/");
}

function normalizeGitignorePattern(pattern: string, relBase: string): string | null {
  let raw = pattern.trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("#") && !raw.startsWith("\\#")) {
    return null;
  }
  let negate = false;
  if (raw.startsWith("!")) {
    negate = true;
    raw = raw.slice(1);
  }
  if (!raw) {
    return null;
  }
  if (raw.startsWith("/")) {
    raw = raw.slice(1);
  }
  if (relBase) {
    raw = `${relBase}/${raw}`;
  }
  return negate ? `!${raw}` : raw;
}

async function getGitignoreMatcher(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<((fsPath: string) => boolean) | null> {
  const key = workspaceFolder.uri.fsPath;
  if (gitignoreMatcherCache.has(key)) {
    return gitignoreMatcherCache.get(key)!;
  }
  const gitignoreUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder.uri, "**/.gitignore"),
  );
  if (gitignoreUris.length === 0) {
    gitignoreMatcherCache.set(key, null);
    return null;
  }
  const ig = ignore();
  for (const uri of gitignoreUris) {
    let content = "";
    try {
      content = await fsp.readFile(uri.fsPath, "utf8");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
      continue;
    }
    const baseDir = path.dirname(uri.fsPath);
    const relBase = normalizeFsPath(path.relative(workspaceFolder.uri.fsPath, baseDir));
    for (const line of content.split(/\r?\n/)) {
      const normalized = normalizeGitignorePattern(line, relBase);
      if (normalized) {
        ig.add(normalized);
      }
    }
  }
  const matcher = (fsPath: string) => {
    const rel = normalizeFsPath(path.relative(workspaceFolder.uri.fsPath, fsPath));
    if (!rel || rel.startsWith("..")) {
      return false;
    }
    return ig.ignores(rel);
  };
  gitignoreMatcherCache.set(key, matcher);
  return matcher;
}
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
  const matcher = await getGitignoreMatcher(workspaceFolder);
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder.uri, "**/appearance/langs/*.json"),
  );
  const filtered = matcher ? uris.filter((uri) => !matcher(uri.fsPath)) : uris;
  filtered.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  const result = filtered.length > 0 ? path.dirname(filtered[0].fsPath) : null;
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
      // 数字 key 可能的引用方式：["106"]、['106']、[106]
      options.push('\\["' + escaped + '"\\]');
      options.push("\\['" + escaped + "'\\]");
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
