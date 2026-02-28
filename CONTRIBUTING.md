# 贡献指南

## 😊 开始前请阅读

在提交任何拉取请求之前，**请先创建一个 issue** 讨论你的想法。这样可以：

- 避免重复工作
- 确保修改与项目方向一致
- 提高 PR 被接受的概率

## 开发环境设置

### 前置要求

- Node.js 16+
- pnpm（推荐）或 npm

### 安装依赖

```bash
pnpm install
```

## 立即开始运行

1. **启动开发模式**
   - 按 `F5` 打开加载了扩展的新 VS Code 窗口
   - 或手动运行：`pnpm run watch`

2. **测试你的修改**
   - 在 VS Code 中编辑代码
   - 按 `Ctrl+R`（Mac：`Cmd+R`）重新加载扩展
   - 在调试控制台查看输出

## 项目结构

- `package.json` - 扩展清单和配置
- `src/extension.ts` - 扩展主入口文件
- `src/` - TypeScript 源代码目录
- `tsconfig.json` - TypeScript 编译配置
- `.vscode/` - VS Code 调试和任务配置

## 运行测试

### 自动化测试

```bash
pnpm run test
```

或在 VS Code 中：
- 确保 **watch** 任务正在运行
- 在活动栏打开测试视图
- 点击 "Run Test" 按钮或按 `Ctrl+;` `A`

### 代码检查

```bash
pnpm run lint      # 检查代码质量
pnpm run format    # 自动格式化代码
```

## 编写代码

### 代码风格

- 使用 oxlint 进行代码检查
- 使用 oxfmt 进行代码格式化
- 遵循 TypeScript 严格模式

### 提交建议

1. 创建一个新分支：`git checkout -b feature/your-feature`
2. 编写测试用例
3. 确保所有测试通过：`pnpm run pretest`
4. 提交代码并推送分支
5. 创建拉取请求，关联相关 issue

### 提交信息建议

- 用英文或中文清晰描述变更
- 格式：`type: description` 例如 `feat: add new command` 或 `fix: handle edge case`

## 拉取请求流程

1. 确保 PR 描述清晰
2. 链接相关的 issue（如 `Closes #123`）
3. 至少一个维护者需要批准
4. 所有检查都需通过

## 许可证

通过提交代码，你同意在项目的许可证下发布你的贡献。

---

感谢你的贡献！如有任何问题，欢迎提出 issue 讨论。
