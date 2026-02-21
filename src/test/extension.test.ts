import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import {
  openAndShowDocument,
  getAndVerifyHover,
  getAndVerifyDefinition,
  setWorkspaceFolders,
  verifyHoverNotContains,
  findHoverWithText,
} from "./test-helpers";

// 全局路径变量
let extensionPath: string;
let Project1Path: string;
let Project2Path: string;

suite("单项目工作区测试套件", () => {
  let simpleDoc: vscode.TextDocument;
  let nestedDoc: vscode.TextDocument;

  suiteSetup(async () => {
    // 关闭辅助侧边栏
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");

    // 初始化路径（只运行一次）
    const ext = vscode.extensions.getExtension("siyuan-note.vscode-siyuan-i18n");
    if (!ext) {
      throw new Error("找不到扩展");
    }
    extensionPath = ext.extensionPath;
    Project1Path = path.join(extensionPath, "src", "test", "Project1");
    Project2Path = path.join(extensionPath, "src", "test", "Project2");

    // 确保工作区中只有 Project1 文件夹
    await setWorkspaceFolders({ path: Project1Path, name: "Project1" });
    // 验证工作区文件夹数量
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1, "应该只有一个工作区文件夹");

    // 打开两个测试文件
    simpleDoc = await vscode.workspace.openTextDocument(path.join(Project1Path, "test-simple.ts"));
    await vscode.window.showTextDocument(simpleDoc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });

    nestedDoc = await vscode.workspace.openTextDocument(path.join(Project1Path, "test-nested.ts"));
    await vscode.window.showTextDocument(nestedDoc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
  });

  suite("test-simple.ts 测试组 - 悬停", () => {
    // TODO 测试括号和引号的悬停
    test("简单属性悬停显示翻译", async () => {
      // 第2行：const msg1 = window.siyuan.languages.cloudIntro1;
      await getAndVerifyHover(simpleDoc, new vscode.Position(2, 42), [
        "测试文案1",
        "Test message 1",
      ]);
    });

    test("简单属性括号使用双引号", async () => {
      // 第3行：const msg2 = window.siyuan.languages["cloudIntro1"];
      await getAndVerifyHover(simpleDoc, new vscode.Position(3, 43), [
        "测试文案1",
        "Test message 1",
      ]);
    });

    test("简单属性括号使用单引号", async () => {
      // 第4行：const msg3 = window.siyuan.languages['cloudIntro2'];
      await getAndVerifyHover(simpleDoc, new vscode.Position(4, 43), [
        "测试文案2",
        "Test message 2",
      ]);
    });
  });

  suite("test-nested.ts 测试组 - 定义跳转", () => {
    // TODO 每一行都要测试跳转、括号和引号也要测试
    test("简单属性定义跳转功能正常", async () => {
      // 第2行：const msg1 = window.siyuan.languages.cloudIntro1;
      // 在 cloudIntro1 上触发定义跳转
      await getAndVerifyDefinition(simpleDoc, new vscode.Position(2, 42), "zh_CN.json");
    });
  });

  suite("test-nested.ts 测试组 - 悬停", () => {
    test("嵌套括号属性悬停显示翻译", async () => {
      // 第2行：const msg1 = window.siyuan.languages["_kernel"][214];
      // 在 [214] 上触发悬停
      await getAndVerifyHover(nestedDoc, new vscode.Position(2, 52), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });

    test("非最后一部分不显示悬停", async () => {
      // 第2行：const msg1 = window.siyuan.languages["_kernel"][214];
      // 在 _kernel 上触发悬停（不是最后一部分）
      await verifyHoverNotContains(nestedDoc, new vscode.Position(2, 42), "内核提示");
    });

    test("括号表示法使用单引号", async () => {
      // 第3行：const msg2 = window.siyuan.languages['_kernel'][214];
      await getAndVerifyHover(nestedDoc, new vscode.Position(3, 52), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });

    test("混合表示法：点号后接数字括号", async () => {
      // 第4行：const msg3 = window.siyuan.languages._kernel[214];
      await getAndVerifyHover(nestedDoc, new vscode.Position(4, 47), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });

    test("全部字符串键使用双引号", async () => {
      // 第5行：const msg4 = window.siyuan.languages["_kernel"]["214"];
      await getAndVerifyHover(nestedDoc, new vscode.Position(5, 52), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });

    test("全部字符串键使用单引号", async () => {
      // 第6行：const msg5 = window.siyuan.languages['_kernel']['214'];
      await getAndVerifyHover(nestedDoc, new vscode.Position(6, 52), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });

    test("混合引号表示法", async () => {
      // 第7行：const msg6 = window.siyuan.languages['_kernel']["122"];
      await getAndVerifyHover(nestedDoc, new vscode.Position(7, 52), [
        "内核提示122",
        "Kernel message 122",
      ]);
    });

    test("括号 token 悬停（单引号）", async () => {
      // 第3行：const msg2 = window.siyuan.languages['_kernel'][214];
      // 在右括号 ] 上触发悬停
      await getAndVerifyHover(nestedDoc, new vscode.Position(3, 52), [
        "内核提示214",
        "Kernel message 214",
      ]);
    });
  });

  suite("test-nested.ts 测试组 - 定义跳转", () => {
    // TODO 每一行都要测试跳转、括号和引号也要测试
    test("嵌套属性定义跳转功能正常", async () => {
      // 第7行：const msg6 = window.siyuan.languages['_kernel']["122"];
      // 在 [122] 上触发定义跳转
      await getAndVerifyDefinition(nestedDoc, new vscode.Position(7, 52));
    });
  });
});

suite("多项目工作区测试套件", () => {
  suiteSetup(async () => {
    // 添加两个工作区文件夹
    await setWorkspaceFolders(
      { path: Project1Path, name: "Project1" },
      { path: Project2Path, name: "Project2" },
    );
    // 验证工作区文件夹数量
    assert.strictEqual(vscode.workspace.workspaceFolders?.length, 2, "应该有两个工作区文件夹");
    // 验证两个文件夹的路径
    const folders = vscode.workspace.workspaceFolders!;
    assert.ok(folders[0].uri.fsPath.includes("Project1"), "第一个文件夹应该是 Project1");
    assert.ok(folders[1].uri.fsPath.includes("Project2"), "第二个文件夹应该是 Project2");
  });

  test("第一个项目能正常工作", async function () {
    this.timeout(5000);
    // 打开测试文件并触发悬停
    const testFile = path.join(Project1Path, "test-simple.ts");
    const doc = await openAndShowDocument(testFile);

    await getAndVerifyHover(doc, new vscode.Position(2, 42), ["测试文案1", "Test message 1"]);
  });

  test("第二个项目能正常工作", async function () {
    this.timeout(10000);
    // 在不同的编辑器列打开第二个项目文件，避免覆盖第一个
    const testFile2 = path.join(Project2Path, "test-project2.ts");
    const doc2 = await vscode.workspace.openTextDocument(testFile2);
    await vscode.window.showTextDocument(doc2, {
      preview: false,
      viewColumn: vscode.ViewColumn.Two,
    });

    // 验证文件属于第二个工作区
    const folder2 = vscode.workspace.getWorkspaceFolder(doc2.uri);
    console.log("第二个文件所属工作区:", folder2?.name);
    console.log("第二个文件路径:", doc2.uri.fsPath);

    // 位置：const msg = window.siyuan.languages.projectTwo;
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc2.uri,
      new vscode.Position(2, 37),
    );

    assert.ok(hovers && hovers.length > 0, "第二个项目应该能找到语言文件");

    // 查找包含翻译内容的 hover
    const hoverText = findHoverWithText(hovers, "Project Two");
    assert.ok(hoverText, "应该在 hover 中找到第二个项目的翻译");
  });

  test("手动测试（点击按钮关闭窗口）", async function () {
    this.timeout(600000); // 10 分钟超时
    // 显示非模态消息，持续显示直到点击按钮
    let userClicked = false;
    const showMessage = async () => {
      const messageText = "所有自动测试执行完毕！\n\n手动测试完毕后，点击下方按钮关闭窗口";
      const buttonText = "完成测试，关闭窗口";
      const result = await vscode.window.showInformationMessage(messageText, buttonText);
      if (result === buttonText) {
        userClicked = true;
      }
    };
    showMessage(); // 立即显示一次
    // 后台定时器：持续显示消息
    const showMessageTimer = setInterval(showMessage, 10000);
    // 等待点击按钮
    while (!userClicked) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    clearInterval(showMessageTimer);
    assert.ok(true, "手动测试已完成");
  });
});
