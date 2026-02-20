# SiYuan i18n Go to Definition

- **转到定义**（Ctrl+点击）：列出类型定义 + 各语种 JSON 的对应行，可跳转。
- **悬停**（鼠标移上去）：一次性展示该 key 在**所有语种**中的文案（全部展开，无需点击）。

## 使用方式

1. 在 VS Code 中按 `Ctrl+Shift+P`（Mac：`Cmd+Shift+P`），执行 **“Developer: Install Extension from Location...”**。
2. 选择当前项目下的目录：`.vscode/vscode-siyuan-i18n`。
3. 按提示 **Reload Window** 重载窗口后即可使用。
4. 打开任意 `.ts` / `.js` 文件，将光标放在 `window.siyuan.languages.xxx` 的 `xxx` 上，按 **Ctrl+点击**（或 F12 转到定义）即可跳转到 zh_CN.json 的对应键。

## 支持的写法

- `window.siyuan.languages.staff`
- `window.siyuan.languages["inline-math"]`
- `window.siyuan.languages['key']`

## 配置

在设置中搜索 **SiYuan i18n** 可配置：

- **SiYuan i18n: Definition Languages**（`vscode-siyuan-i18n.definitionLanguages`）：Ctrl+点击「转到定义」时显示的语言列表（语种代码如 `zh_CN`、`en_US`）。留空则使用全部语种（按文件名排序）。
- **SiYuan i18n: Hover Languages**（`vscode-siyuan-i18n.hoverLanguages`）：悬停时显示的语言列表与排序。留空则使用全部语种（按文件名排序）。

示例（在 `.vscode/settings.json` 或用户设置中）：

```json
{
  "vscode-siyuan-i18n.definitionLanguages": ["zh_CN", "en_US", "ja_JP"],
  "vscode-siyuan-i18n.hoverLanguages": ["zh_CN", "zh_CHT", "en_US"]
}
```

## 说明

- 类型定义（`index.d.ts` 中的 `languages`）由编辑器自带的 TypeScript 语言服务提供，本扩展只补充各语种 JSON 的位置，不重复返回类型定义。
- 未配置语言列表时，会扫描 `app/appearance/langs/` 下全部 `.json` 文件，按文件名排序；配置后仅显示所列语种（悬停顺序按配置，转到定义列表顺序由编辑器决定）。
