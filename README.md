# dsh-locale-ja

DeepSeek Harness 日语语言包插件。安装并启用后，「设置 → 常规 → 语言」会出现 **日本語**（日语界面为「設定 → 一般 → 言語」）。选中后即时切换界面文案。

使用官方 [`addLanguage()` 和按命名空间注册字典的接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/locale/README.md#registering-a-language-pack)，无需修改 Harness 源码。

## 安装

需要支持 `ctx.locale.addLanguage()` 的 Harness 版本，且运行配置包含官方 `@deepseek-ai/dsh-client-locale`。初始翻译基准为官方 `0.2.1-alpha.2` 源码提交 [`d7432673`](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c)，当前基准以 `reference/upstream.json` 为准。较早版本若缺少语言包接口，需要先升级。项目构建与测试使用 Node.js 24；插件没有运行时依赖，维护工具使用 TypeScript 解析器。

在终端执行以下命令，从 GitHub 仓库安装到 Web profile：

```sh
npx @deepseek-ai/dsh plugin --profile web add "git+https://github.com/gepeiyu/dsh-locale-ja"
```

`--profile` 放在 `add` 前。按实际部署替换 profile 名称。运行中的实例根据 HMR 状态可能需要重启或刷新页面；生效后进入「设置 → 常规 → 语言」选择「日本語」。安装命令及配置层遵循[官方插件发布与安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。

## 覆盖范围

初始版本包含 **62 个命名空间、2,773 条翻译项**，覆盖上述官方提交中全部客户端 `locale.register()` 字典，包括扩展与实验功能。升级后的准确数量由 `npm run check` 输出。

| 功能 | 命名空间 |
| --- | --- |
| 通用文案、聊天、输入、命令、引用 | `common`, `chat`, `conversation`, `command`, `slash.menu`, `reference` |
| 侧栏、工作区、浏览器、终端 | `sidebar`, `workspace`, `sidebarRight`, `sidebarFiles`, `sidebarBrowser`, `sidebarTerminal`, `directory-browser` |
| 文件与成果物预览 | `deliverables`, `sidebarDocumentPreview`, `sidebarCodePreview`, `sidebarExcel`, `sidebarImage`, `sidebarPdf`, `sidebarOffice`, `documentHtml`, `documentMarkdown`, `open-in-app` |
| 设置、账号、模型、外观、权限 | `settings`, `settings.*`, `model`, `permission.access` |
| 审批、问题、反馈、计划、目标、任务 | `approval`, `question`, `feedback`, `plan`, `goal`, `job`, `schedule.catalog`, `schedule.manager` |
| 技能、子 Agent、工作流、执行轨迹、快捷键 | `skill`, `subagent`, `workflowRun`, `trajectory`, `shortcuts`, `shortcuts.layout` |
| 插件管理与官方扩展 | `pluginManager`, `cordis`, `agent-team`, `claude-code-mods`, `cotTranslation`, `voice-input`, `inspectorPanel`, `session-inspector`, `session-log-download` |

每个命名空间对应 `src/locales/ja/<namespace>.json`，使用官方原 key，保留 `{name}`、`{count}` 等占位符的名称和出现次数。产品名、协议名、文件路径和示例 URL 保留原文。`.one` / `.other` 均保留，日语可使用相同表达。

这是界面语言包。模型回复、用户文件、后端错误原文与第三方插件自带的文案不在官方命名空间字典内；包元数据的 `LocalizedText` 由各插件自身提供。官方欢迎页插画目前只有中英文版本，日语使用上游非中文插画。

## 工作方式

- Host 入口只提供插件标记；`dsh.client` 声明客户端加载依赖，`./client` 导出浏览器加载器使用的构建产物。
- Client 注入 `locale` 服务，先通过 `ctx.effect()` 注册所有日语字典，再注册 `{ id: 'ja', label: '日本語', fallback: 'en' }`，使语言可选时字典已经就绪。
- Harness 自己处理即时切换、`ja-JP` 浏览器语言匹配、`<html lang="ja">` 与偏好保存。Loopback 页面由 Host 保存选择；非 loopback 页面的选择只在当前进程有效，这是官方行为。
- 卸载时，每次注册返回的 disposer 由 `ctx.effect()` 清理。语言会从选择器移除，活动语言交由 Harness 回退；重新加载可恢复已保存的日语选择。
- 上游新增、尚未翻译的 key 按语言回退链使用英文。

## 开发与验证

```sh
npm ci
npm run build
npm run check
npm test
npm pack
```

`check` 离线对照 `reference/en.json` 校验命名空间、完整 key 集合、字符串类型、非空译文及占位符。允许上游原本为空的分隔符。构建和打包前都会校验，不完整的字典无法生成新包。

测试使用固定提交的**官方 LocaleRuntime 源码**，验证语言目录、全部 key 解析、占位符替换、实时切换、英文与 common 回退、浏览器语言匹配、Host 偏好写入、卸载后重载，以及浏览器加载器的实际客户端构建产物。测试不启动完整 Harness GUI。

## 跟随官方版本升级

默认跟随**最新发布版本，包括预发布版**，按 GitHub 发布时间选择 `dsh-v*` release；也支持指定 tag、branch 或 commit。需要 Git，在线模式需要访问 GitHub。第一次下载可能较慢，上游对象缓存在 `.cache/upstream.git`，不进入插件包或版本控制。

以下维护命令在源码仓库中执行，并先运行 `npm ci` 安装开发依赖。安装包仅包含可加载的插件，不附带上游维护工具。

```sh
# 只检查：不修改翻译和版本基准
npm run upstream:check

# 确认要升级后，同步到最新发布版
npm run upstream:sync

# 固定到指定版本（示例）
npm run upstream:sync -- --ref dsh-v0.2.1-alpha.2
```

`upstream:check` 会输出新增、变更和删除数量，并写入 `.cache/upstream-report.json`。发现新提交时退出码为 1，便于 CI 检测；当前已是该版本时退出码为 0。指定 `--ref` 可以复现历史基准。

已有上游 Git 仓库时，可离线操作，不改动该仓库的工作区：

```sh
npm run upstream:check -- --repo /absolute/path/to/deepseek-harness --ref COMMIT
npm run upstream:sync -- --repo /absolute/path/to/deepseek-harness --ref COMMIT
```

同步工具通过 TypeScript AST 解析实际的 `locale.register()` 调用，自动发现新增命名空间、导入别名和内联字典，只读取静态数据，不执行上游应用代码。遇到无法解析的新写法或重复命名空间会报错，且不会改写翻译基准；此时先适配 `scripts/upstream-source.mjs`。

同步同时更新完整英文基准、命名空间来源、固定提交、官方运行时测试 fixture、许可证和版权声明，并生成 `reference/update-report.json`：

- **新增项**：报告中包含英文原文；日语字典不会自动填入英文，需要在对应 JSON 中补齐译文。新增命名空间会生成空 JSON。
- **英文变更项**：保留已有日语，但列入待复核清单，即使占位符未变，也会阻止检查和打包。修改译文后自动视为已复核。
- **删除项**：从活动字典移除，原英文及日语保存在升级报告中，方便追溯。

若英文变动不需要修改日语，逐项明确确认现有译文仍适用：

```sh
npm run upstream:review -- --namespace chat --key message.stepProcess.thinking
```

该命令只适用于报告中存在的变更项，仍会校验字符串和占位符。升级过程中可以反复检查；尚未完成的译文或复核会阻止再次同步，避免覆盖正在处理的报告。

完成翻译后执行：

```sh
npm run check
npm test
npm pack
```

测试会使用升级后的官方运行时，接口变动可能要求同步调整测试适配器或插件。检查通过后，更新 README 中需要变化的兼容说明、插件版本及发布记录，并提交英文基准、升级报告、日语字典和测试 fixture。不要仅删除基准中未翻译的 key 来让检查通过。

仓库提供 GitHub Actions：push / PR 自动检查、测试和打包；另有可手动触发的 **Check official Harness release** 工作流，输出可下载的差异报告。工作流不会自动修改翻译或发布 npm 包。

## ライセンス

MIT。上游源码和词典的版权声明见 `THIRD_PARTY_NOTICES.md`。
