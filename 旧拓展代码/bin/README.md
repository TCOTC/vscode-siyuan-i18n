# 内置 ripgrep（可选）

本扩展的「查找键引用」功能依赖 ripgrep 搜索代码。若本机未安装 ripgrep，可将 ripgrep 的可执行文件放在此目录，扩展会优先使用，无需配置系统 PATH。

## Windows

1. 打开 [ripgrep 发布页](https://github.com/BurntSushi/ripgrep/releases)，下载 **ripgrep-xxx-x86_64-pc-windows-msvc.zip**（或 -gnu.zip）。
2. 解压后将 **rg.exe** 放入本目录（即 `vscode-siyuan-i18n/bin/rg.exe`）。
3. 重新加载窗口后执行「SiYuan i18n: 检查 ripgrep 是否可用」确认。

## macOS / Linux

将对应平台的 **rg** 可执行文件放入本目录即可（无 .exe 后缀）。
