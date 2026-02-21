import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  getLangKeyAtPosition,
  getLangsDirForFolder,
  getOrderedLangFiles,
  getCachedFile,
  findKeyLineInContent,
  CachedFile,
} from "./util";

/**
 * 一次读文件得到 key 的 value 与行号。
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
 * 收集该 key 在配置语种中的文案与行号。
 */
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

/**
 * 提供悬停时显示所有语种文案的功能。
 */
export function createHoverProvider(cache: Map<string, CachedFile>) {
  return {
    async provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ): Promise<vscode.Hover | null> {
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
      const entries = await collectAllLangValues(langsDir, key, cache);
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
}
