# 欢迎使用您的 VS Code 扩展

## 文件夹内容

* 此文件夹包含您的扩展所需的所有文件。
* `package.json` - 这是清单文件，您可以在其中声明您的扩展和命令。
  * 示例插件注册了一个命令，并定义了其标题和命令名称。通过此信息，VS Code 可以在命令面板中显示该命令。它尚不需要加载插件。
* `src/extension.ts` - 这是您提供命令实现的主要文件。
  * 该文件导出一个函数 `activate`，该函数在您的扩展首次激活时被调用（在本例中通过执行命令）。在 `activate` 函数中，我们调用 `registerCommand`。
  * 我们将包含命令实现的函数作为第二个参数传递给 `registerCommand`。

## 立即开始运行

* 按 `F5` 打开一个加载了您的扩展的新窗口。
* 通过按 (`Ctrl+Shift+P` 或在 Mac 上 `Cmd+Shift+P`) 并键入 `Hello World` 从命令面板运行您的命令。
* 在 `src/extension.ts` 中的代码内设置断点以调试您的扩展。
* 在调试控制台中查找您的扩展的输出。

## 进行更改

* 在 `src/extension.ts` 中更改代码后，您可以从调试工具栏重新启动扩展。
* 您也可以重新加载 (`Ctrl+R` 或在 Mac 上 `Cmd+R`) 带有您的扩展的 VS Code 窗口以加载您的更改。

## 探索 API

* 当您打开文件 `node_modules/@types/vscode/index.d.ts` 时，您可以打开我们完整的 API 集。

## 运行测试

* 安装 [Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
* 通过 **Tasks: Run Task** 命令运行 "watch" 任务。确保此任务正在运行，否则可能无法发现测试。
* 从活动栏打开测试视图，然后单击 "Run Test" 按钮，或使用快捷键 `Ctrl/Cmd + ; A`
* 在测试结果视图中查看测试结果的输出。
* 对 `src/test/extension.test.ts` 进行更改或在 `test` 文件夹内创建新的测试文件。
  * 提供的测试运行器将仅考虑匹配名称模式 `**.test.ts` 的文件。
  * 您可以在 `test` 文件夹内创建文件夹，以任何方式构建您的测试。

## 进一步探索

* [遵循 UX 指南](https://code.visualstudio.com/api/ux-guidelines/overview) 创建与 VS Code 本机界面和模式无缝集成的扩展。
* 通过 [捆绑您的扩展](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) 减少扩展大小并改善启动时间。
* 在 VS Code 扩展市场 [发布您的扩展](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
* 通过设置 [持续集成](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) 自动化构建。
* 集成到 [报告问题](https://code.visualstudio.com/api/get-started/wrapping-up#issue-reporting) 流程，以获取用户报告的问题和功能请求。
