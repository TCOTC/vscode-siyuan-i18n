import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import {
  buildChainRipgrepPatterns,
  escapeRegex,
  CachedFile,
} from "./util";

/**
 * 从 JSON 内容前若干行推断当前行的"父路径"，用于嵌套 key。
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
 * 在语言文件（JSON）中，从当前行解析光标所在的键名。
 */
export function getJsonKeyAtPosition(
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
 * 在工作区中搜索使用该 i18n key 的代码位置。
 */
export function findReferencesToKey(
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  key: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
  return new Promise((resolve, _reject) => {
    if (!workspaceFolder || !key) {
      resolve([]);
      return;
    }

    const { rgPath } = getRipgrepPath();
    if (!rgPath) {
      resolve([]);
      return;
    }

    const root = workspaceFolder.uri.fsPath;
    const isChain = key.includes(".");
    const patterns = isChain
      ? buildChainRipgrepPatterns(key)
      : (() => {
          const escapedKey = escapeRegex(key);
          const ident = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
          const isNumber = /^\d+$/.test(key);
          const list = [
            'window\\.siyuan\\.languages\\["' + escapedKey + '"\\]',
            "window\\.siyuan\\.languages\\['" + escapedKey + "'\\]",
          ];
          if (isNumber) {
            // 数字 key 可能的直接数字引用方式
            list.push("window\\.siyuan\\.languages\\[" + escapedKey + "\\]");
          }
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
    const proc = spawn(rgPath, args, {
      cwd: root,
      shell: false,
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", () => {});
    proc.on("error", () => resolve([]));
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
        resolve([]);
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
 * 提供在语言文件中查找引用的功能。
 */
export function createReferenceProvider(_cache: Map<string, CachedFile>) {
  return {
    async provideReferences(
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.ReferenceContext,
      token: vscode.CancellationToken,
    ): Promise<vscode.Location[]> {
      const key = getJsonKeyAtPosition(document, position);
      if (!key) {
        return [];
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      return findReferencesToKey(folder, key, token);
    },
  };
}

/**
 * 提供在语言文件中跳转到引用的功能（作为定义提供程序）。
 */
export function createJsonDefinitionProvider(_cache: Map<string, CachedFile>) {
  return {
    async provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ): Promise<vscode.Location[] | null> {
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
}

/**
 * 返回 ripgrep 可执行文件的路径。
 * 来自 VS Code 内置的 `@vscode/ripgrep`。
 */
export function getRipgrepPath(): { rgPath: string | null; errMsg: string | null } {
  try {
    const appRoot = vscode.env.appRoot;
    if (!appRoot) {
      return {
        rgPath: null,
        errMsg: `无法获取 ${vscode.env.appName || "VS Code"} 的安装路径 (vscode.env.appRoot)`,
      };
    }
    const binName = process.platform === "win32" ? "rg.exe" : "rg";
    
    // 尝试多个可能的路径
    // 参考了 todo-tree 拓展的 ripgrepPath 函数 https://github.com/Gruntfuggly/todo-tree/blob/a6f60e0ce830c4649ac34fc05e5a1799ec91d151/src/config.js#L82-L113
    // 以及 https://news.ycombinator.com/item?id=20363986 (2019-07-05)
    const possiblePaths = [
      path.join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", binName), // 开发时使用的 1.109 版本，Windows 和 macOS 都能在该路径找到
      path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", binName),
      path.join(appRoot, "node_modules", "vscode-ripgrep", "bin", binName),
      path.join(appRoot, "node_modules.asar.unpacked", "vscode-ripgrep", "bin", binName),
    ];
    
    for (const rgPath of possiblePaths) {
      if (fs.existsSync(rgPath)) {
        return { rgPath, errMsg: null };
      }
    }
    
    return {
      rgPath: null,
      errMsg: `无法从以下路径找到 ripgrep 可执行文件:\n[${possiblePaths.join("]\n[")}]`,
    };
  } catch (e) {
    return {
      rgPath: null,
      errMsg: `获取 ripgrep 路径时发生异常: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 检查当前环境是否可用 ripgrep (rg)。
 */
export function checkRipgrepAvailable(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const { rgPath, errMsg } = getRipgrepPath();
    if (!rgPath) {
      resolve({
        ok: false,
        message: errMsg || "未知错误",
      });
      return;
    }
    const proc = spawn(rgPath, ["--version"], {
      shell: false,
    });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => chunks.push(c));
    proc.on("error", (err) => {
      resolve({
        ok: false,
        message: `ripgrep 执行失败，错误信息: ${err.name} - ${err.message}`,
      });
    });
    proc.on("close", (code, signal) => {
      const out = Buffer.concat(chunks).toString("utf8").trim();
      if (code === 0 || code === 1) {
        resolve({ ok: true, message: out || "" });
      } else {
        resolve({
          ok: false,
          message: `ripgrep 退出码 ${code}${signal ? `，signal: ${signal}` : ""}`,
        });
      }
    });
  });
}
