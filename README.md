# SiYuan i18n

## 功能特性

打开思源笔记源代码 Typescript 文件，将光标放在 `window.siyuan.languages.xxx` 的 `xxx` 上：

- **悬停**（鼠标悬停）：展示该 key 对应的文案。
- **转到定义**（Ctrl+点击）：列出类型定义 + 各语种 JSON 的对应行，可跳转。

打开思源笔记 i18n 文案 JSON 文件，将光标放在文案的键上：

- **转到引用**（Ctrl+点击）

## 支持的写法

- `window.siyuan.languages.staff`
- `window.siyuan.languages["inline-math"]`
- `window.siyuan.languages['key']`
- `window.siyuan.languages["_kernel"][214]`
- `window.siyuan.languages["_kernel"]["106"]`

## 拓展设置

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

- 未配置语言列表时，会扫描 `app/appearance/langs/` 下全部 `.json` 文件，按文件名排序；配置后仅显示所列语种。

## 查找键引用

可在语言 JSON 文件中按键名查找该文案在代码中的使用位置。

1. 将光标放在语言 JSON 文件的键名上（如 `"staff"` 的 `staff`）。
2. 按 `Ctrl+Shift+P` 执行 **"SiYuan i18n: Find references to key"**，或右键选择 **"Find All References"**。
3. 扩展会使用 ripgrep 搜索代码中的 `window.siyuan.languages.xxx` 引用。

### ripgrep 依赖

“查找键引用”功能依赖 [ripgrep](https://github.com/BurntSushi/ripgrep)（`rg` 命令）。

- **自动检测**：扩展会优先使用内置的 `bin/rg.exe`（Windows）或 `bin/rg`（Linux/macOS），无需用户安装。
- **系统安装**：若无内置版本，可安装 ripgrep：
  - Windows: `winget install BurntSushi.ripgrep`
  - macOS: `brew install ripgrep`
  - Linux: `apt install ripgrep` 或 `dnf install ripgrep`
- **检查可用性**：执行 **"SiYuan i18n: 检查 ripgrep 是否可用"** 确认。
