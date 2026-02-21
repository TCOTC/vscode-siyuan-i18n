import * as vscode from "vscode";
import { findReferencesToKeyWithRipgrep, CachedFile } from "./util";

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
export async function findReferencesToKey(
  workspaceFolder: vscode.WorkspaceFolder | undefined,
  key: string,
  token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
  if (!workspaceFolder || !key) {
    return [];
  }
  return findReferencesToKeyWithRipgrep(workspaceFolder, key, token);
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
