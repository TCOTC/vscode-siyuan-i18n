/**
 * 测试助手函数 - 用于简化和复用通用的测试逻辑
 */
import * as vscode from "vscode";
import * as assert from "assert";

/**
 * 打开文件并显示在编辑器中
 */
export async function openAndShowDocument(filePath: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
  await new Promise((resolve) => setTimeout(resolve, 500)); // 等待扩展处理
  return doc;
}

/**
 * 获取并验证悬停信息，返回悬停文本
 */
export async function getAndVerifyHover(
  doc: vscode.TextDocument,
  position: vscode.Position,
  expectedTexts?: string | string[],
): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    doc.uri,
    position,
  );

  assert.ok(hovers && hovers.length > 0, "应该有悬停内容");
  const hoverText = (hovers[0].contents[0] as vscode.MarkdownString).value;

  if (expectedTexts) {
    const textsArray = Array.isArray(expectedTexts) ? expectedTexts : [expectedTexts];
    const hasExpected = textsArray.some((text) => hoverText.includes(text));
    assert.ok(hasExpected, `悬停应该包含以下内容之一: ${textsArray.join(" 或 ")}`);
  }

  return hoverText;
}

/**
 * 获取并验证定义位置
 */
export async function getAndVerifyDefinition(
  doc: vscode.TextDocument,
  position: vscode.Position,
  expectedPath?: string,
): Promise<vscode.Location[]> {
  const locations = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeDefinitionProvider",
    doc.uri,
    position,
  );

  assert.ok(locations && locations.length > 0, "应该找到定义位置");

  if (expectedPath) {
    assert.ok(
      locations.some((loc) => loc.uri.path.includes(expectedPath)),
      `应该包含 ${expectedPath} 位置`,
    );
  }

  return locations;
}

/**
 * 设置工作区文件夹（添加新文件夹，移除不在参数中的文件夹）
 */
export async function setWorkspaceFolders(
  ...folders: { path: string; name: string }[]
): Promise<void> {
  const currentFolders = vscode.workspace.workspaceFolders || [];
  const targetPaths = new Set(folders.map((f) => vscode.Uri.file(f.path).fsPath.toLowerCase()));
  const currentPaths = new Map(currentFolders.map((f) => [f.uri.fsPath.toLowerCase(), f]));

  // 找出需要删除的文件夹索引
  const toDelete: number[] = [];
  currentFolders.forEach((folder, index) => {
    if (!targetPaths.has(folder.uri.fsPath.toLowerCase())) {
      toDelete.push(index);
    }
  });

  // 找出需要添加的文件夹
  const toAdd = folders.filter(
    (f) => !currentPaths.has(vscode.Uri.file(f.path).fsPath.toLowerCase()),
  );

  // 如果没有变化，直接返回
  if (toDelete.length === 0 && toAdd.length === 0) {
    return;
  }

  // 先删除，从后往前删除避免索引混乱
  for (let i = toDelete.length - 1; i >= 0; i--) {
    const index = toDelete[i];
    vscode.workspace.updateWorkspaceFolders(index, 1);
  }

  // 再添加新文件夹
  if (toAdd.length > 0) {
    const uris = toAdd.map((f) => ({ uri: vscode.Uri.file(f.path), name: f.name }));
    const insertIndex = currentFolders.length - toDelete.length;
    vscode.workspace.updateWorkspaceFolders(insertIndex, 0, ...uris);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * 验证悬停不包含特定文本
 */
export async function verifyHoverNotContains(
  doc: vscode.TextDocument,
  position: vscode.Position,
  excludedTexts: string | string[],
): Promise<void> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    doc.uri,
    position,
  );

  if (hovers && hovers.length > 0) {
    const hoverText = (hovers[0].contents[0] as vscode.MarkdownString)?.value || "";
    const textsArray = Array.isArray(excludedTexts) ? excludedTexts : [excludedTexts];
    textsArray.forEach((text) => {
      assert.ok(!hoverText.includes(text), `悬停不应该包含: ${text}`);
    });
  }
}

/**
 * 从多个 hovers 中查找包含指定文本的
 */
export function findHoverWithText(hovers: vscode.Hover[], searchText: string): string | null {
  for (const hover of hovers) {
    for (const content of hover.contents) {
      if (content instanceof vscode.MarkdownString && content.value.includes(searchText)) {
        return content.value;
      }
    }
  }
  return null;
}
