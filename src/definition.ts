import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  getLangKeyAtPosition,
  getLangsDirForFolder,
  getOrderedLangFiles,
  getCachedFile,
  findKeyLineInContent,
  CachedFile,
} from "./util";

/**
 * 收集配置语种文件中该 key 的位置。
 */
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
      const line = fileData.content.split(/\r?\n/)[lineIndex];
      // 找到 JSON key 的范围并选中
      const match = line.match(/^\s*"([^"]*)"\s*:/);
      let range: vscode.Range;
      if (match) {
        const openQuote = line.indexOf('"');
        const closeQuote = openQuote + match[1].length + 1;
        range = new vscode.Range(
          new vscode.Position(lineIndex, openQuote),
          new vscode.Position(lineIndex, closeQuote + 1),
        );
      } else {
        const pos = new vscode.Position(lineIndex, 0);
        range = new vscode.Range(pos, pos);
      }
      locations.push(new vscode.Location(vscode.Uri.file(jsonPath), range));
    }
  }
  return locations;
}

/**
 * 提供在 TypeScript/JavaScript 文件中跳转到定义的功能。
 */
export function createDefinitionProvider(cache: Map<string, CachedFile>) {
  return {
    async provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
    ): Promise<vscode.Location[] | null> {
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

      const locations = await collectDefinitionLocations(langsDir, key, cache);
      if (token.isCancellationRequested) {
        return null;
      }
      if (locations.length === 0) {
        return null;
      }
      return locations;
    },
  };
}
