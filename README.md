# VS Code 拓展：思源笔记 i18n

## 功能特性

打开思源笔记源代码 TypeScript 文件，将光标放在文案 `window.siyuan.languages.xxx` 的最后一部分 `xxx` 上：

- **悬停提示**（鼠标悬停）：展示该 key 对应的文案。
- **定义跳转**（Ctrl+点击 / 执行命令 `SiYuan i18n: Open i18n line`）：列出类型定义 + 各语种 JSON 的对应行。

打开思源笔记 i18n 文案 JSON 文件，将光标放在文案的键名上：

- **引用查找**（Ctrl+点击 / 执行命令 `SiYuan i18n: Find references to key`）：列出 TypeScript 代码中引用该文案的位置。

  备注：该功能依赖 VS Code 内置的 [ripgrep](https://github.com/microsoft/vscode-ripgrep)，预期其可执行文件位于 VS Code 程序安装目录的 `/node_modules/@vscode/ripgrep/bin/` 文件夹中。可以执行命令 `SiYuan i18n: Check if ripgrep is available` 来确认可用性。

## 支持的写法

- `window.siyuan.languages.text`
- `window.siyuan.languages['text']`
- `window.siyuan.languages["text-with-hyphen"]`
- `window.siyuan.languages["text"][number]`
- `window.siyuan.languages["text"]["number"]`

## 拓展设置

在设置中搜索 **SiYuan i18n** 可配置：

- **SiYuan i18n: Hover Languages**（`vscode-siyuan-i18n.hoverLanguages`）：配置悬停时显示的语言列表（默认为 `zh_CN`、`en_US`）并按填写顺序排序，留空则使用全部语种并按文件名排序。
- **SiYuan i18n: Definition Languages**（`vscode-siyuan-i18n.definitionLanguages`）：配置「转到定义」时显示的语言列表（默认为 `zh_CN`、`en_US`），留空则使用全部语种，不支持配置排序。

示例（在 `.vscode/settings.json` 或用户设置中）：

```json
{
  "vscode-siyuan-i18n.hoverLanguages": ["zh_CN", "zh_CHT", "en_US"],
  "vscode-siyuan-i18n.definitionLanguages": ["zh_CN", "en_US", "ja_JP"]
}
```

未配置语言列表时，会扫描 `app/appearance/langs/` 下全部 `.json` 文件，按文件名排序。
