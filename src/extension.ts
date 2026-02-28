import * as vscode from "vscode";
import { setExtensionPath, CachedFile } from "./util";
import { createDefinitionProvider } from "./definition";
import { createHoverProvider } from "./hover";
import {
  createReferenceProvider,
  createJsonDefinitionProvider,
  checkRipgrepAvailable,
} from "./reference";

export function activate(context: vscode.ExtensionContext) {
  setExtensionPath(context.extensionPath);

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

  // 命令：检查 ripgrep 是否可用（用于排查"查找键引用"无结果）
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.checkRipgrep", async () => {
      const { ok, message } = await checkRipgrepAvailable();
      if (ok) {
        vscode.window.showInformationMessage(`ripgrep 可用：${message ? message : "未知版本"}`);
      } else {
        vscode.window.showWarningMessage(`ripgrep 不可用：${message}`);
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
        const line = doc.lineAt(lineIndex).text;

        // 从行内容中找到 JSON key 的范围并选中
        // 正则匹配 "key" 的位置
        const match = line.match(/^\s*"([^"]*)"\s*:/);
        let selection: vscode.Range;

        if (match) {
          const openQuote = line.indexOf('"');
          const closeQuote = openQuote + match[1].length + 1;
          selection = new vscode.Range(
            new vscode.Position(lineIndex, openQuote),
            new vscode.Position(lineIndex, closeQuote + 1),
          );
        } else {
          // 找不到 key 时光标在行首
          selection = new vscode.Range(
            new vscode.Position(lineIndex, 0),
            new vscode.Position(lineIndex, 0),
          );
        }

        await vscode.window.showTextDocument(doc, {
          selection,
          preview: false,
        });
      },
    ),
  );

  const selector = [{ language: "javascript" }, { language: "typescript" }];

  // 注册定义提供程序（用于 TypeScript/JavaScript 中的 i18n key）
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, createDefinitionProvider(langFileCache)),
  );

  // 注册悬停提供程序
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, createHoverProvider(langFileCache)),
  );

  // 语言文件（JSON）中的引用和定义提供程序
  const jsonLangSelector = [{ scheme: "file", pattern: "**/appearance/langs/*.json" }];
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(
      jsonLangSelector,
      createReferenceProvider(langFileCache),
    ),
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      jsonLangSelector,
      createJsonDefinitionProvider(langFileCache),
    ),
  );

  // 命令：在语言文件键名上执行"查找引用"，便于从命令面板或右键触发
  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-siyuan-i18n.findReferencesToKey", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      // 动态导入以支持 node16 模块解析
      const refModule = await import("./reference.js");
      const key = refModule.getJsonKeyAtPosition(editor.document, editor.selection.active);
      if (!key) {
        vscode.window.showWarningMessage('请将光标放在语言文件的键名上（如 "staff" 的 staff）。');
        return;
      }
      const locations = await refModule.findReferencesToKey(
        vscode.workspace.getWorkspaceFolder(editor.document.uri),
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
