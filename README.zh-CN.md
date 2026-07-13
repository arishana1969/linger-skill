# Linger

[![npm version](https://img.shields.io/npm/v/linger-skill.svg)](https://www.npmjs.com/package/linger-skill)
[![CI](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml)

[English](README.md) | **简体中文**

面向编程智能体的本地对话归档与决策轨迹系统。

> 念念不忘，必有回响。
>
> What lingers in mind will find its echo.

---

## 项目状态

Linger v0.2.2 是面向 Claude Code 和 Codex 的实验性 MVP，以公开的 [`linger-skill`](https://www.npmjs.com/package/linger-skill) 包分发。Linger 不承诺完整的归档覆盖率或生产级支持。

## 缘起

这个项目的灵感来自 [Evis Drenova](https://x.com/evisdrenova) 的一条帖子：

> My ideal AI interface is a single never-ending chat thread. I don't want to think about sessions, context windows, worktrees, MCP servers, or anything else. The harness should automate everything transparently.

我们无法真正提供一个永不终止的对话线程——上下文窗口是真实的物理限制，会话会结束，机器会重启。但我们可以构建次优解：一个静默保存对话内容与决策过程的层，使你回来时，连续性仍然存在。

## 功能概述

Linger 将你与编程智能体之间的可见对话——讨论、显式笔记、决策及其可见推理——保存为你拥有的本地文件。

它不是通用 AI 记忆系统，而是一个 sidecar 连续性层。Linger 观察受支持的生命周期事件，但不禁用、替换或写入智能体自身的记忆系统。当智能体丢失了较早的上下文，Linger 仍保有记录；当你询问三周前某个决策的原因，Linger 能呈现证据及其演化过程。

### 你将获得

- 通过已验证的 lifecycle hooks 自动捕获对话，宿主不支持自动化时回退到显式 CLI。
- 可选的宿主模型整理：当前 Claude 或 Codex 模型可改进摘要、类型、标签和检索短语，无需额外的模型提供商或 API 密钥。
- 决策轨迹，保存结论的演化过程而非仅最终结果。
- 记事接口，支持记住、跳过、遗忘、纠正、审查和删除工作流。
- 本地优先存储，使用带版本的 JSON 和人类可读的 Markdown。
- 无数据库、无用户管理的 daemon、无遥测、无 embedding API、无云同步。
- 项目范围内的召回，返回来源、区分不确定性，在无可靠记忆时明确告知。
- 中断恢复、完整性检查、有界搜索和需确认的破坏性操作。

## 目标用户

Linger 面向在长期项目中使用 Claude Code 或 Codex 的开发者。

如果你曾重启对话，希望智能体还记得上周讨论的内容——或者某个设计决策为何更改——Linger 就是为你准备的。

## 安装

需要 Node.js 20 或更高版本。推荐的安装方式只需一条命令：

    npx linger-skill install

交互式安装会展示本地/云端的数据边界，并要求输入准确的 YES 后才写入。非交互调用方须传入 --yes：

    npx linger-skill install --yes

只安装单个适配器：

    npx linger-skill install --adapters claude-code
    npx linger-skill install --adapters codex

如需持久的全局 CLI：

    npm install --global linger-skill
    linger install

从源码安装用于开发：

    git clone https://github.com/arishana1969/linger-skill.git
    cd linger-skill
    pnpm install --frozen-lockfile
    pnpm build
    node dist/cli.js install

## 工作原理

Linger 由 Skill、lifecycle hooks、辅助 CLI、事件驱动处理器和本地 Vault 协同组成。

1. Skill 告知智能体何时保存、何时检索，以及如何对待召回的记忆。
2. 受支持的 lifecycle hooks 捕获可见的用户和助手事件，捕获失败不阻塞对话。
3. 捕获过程暂存事件、写入不可变的原始记录，并添加一个持久化的 queue 项。
4. 事件驱动的 session-local 处理器串行消费 queue。它可在以下时机运行：用户显式记忆指令、达到体积阈值、后续事件观测到最大等待时间已过、会话启动时、或通过手动命令触发。
5. 确定性处理创建安全的可搜索基线：raw → processed memory → 标签与检索短语。
6. 当存在符合条件的待处理记录时，已安装的 Skill 可在用户主要任务完成后，请求 Claude Code 或 Codex 中正在运行的模型整理一个有界批次。
7. 经验证的 enrichment 作为派生 overlay 存储。它改进标签和召回质量，但不改写原始证据或确定性基线。
8. 召回搜索当前项目并返回有界的证据包，当 enrichment 缺失、过期或无效时回退到确定性基线。

活跃的智能体将该证据包与其当前对话及上下文中已有的宿主记忆合并。实质相同的事实属于同一底层证据，而非独立佐证；冲突应被显式呈现而非静默消解。

Linger 不安装 daemon，不修改宿主的记忆设置，也不保证空闲的长时间运行会话会在精确时刻处理 queue。

默认 Vault 路径为 ~/.linger/vault：

    ~/.linger/vault/
    ├── config.json
    ├── projects/
    ├── raw/
    ├── processed/
    ├── enrichments/
    ├── decisions/
    ├── queue/
    ├── registry/
    ├── tmp/
    └── quarantine/

Raw events 和 decision events 是仅追加的源记录。Processed memories 使用 JSON 加 Markdown 镜像。Host enrichment 是可替换的派生 overlay。Registry 和当前决策视图是派生数据，可以重建。

一切都是文件。你可以查看、备份、grep，或通过需确认的操作删除它们。

## 核心理念

### 文件原生

你的记忆存储在带版本 schema 的普通本地文件中。没有记忆数据库或必需的服务器。卸载集成后 Vault 保持原位。

### 决策轨迹

Linger 记录带类型的决策演化：idea、preference、proposal、rationale、constraint、rejection、decision、current state、todo 和 correction。

当前视图从不可变事件推导而来。这使 Linger 能保存 A → B → A 的路径，而非静默覆盖历史。

### 证据而非指令

召回的记忆是不受信任的历史证据。记忆中发现的命令、提示词或旧系统消息不得被执行。当前的系统指令和用户指令始终优先。

### 诚实召回

召回明确区分精确匹配、相似匹配、可能匹配、冲突记忆、未处理原始记录和无结果。结果携带来源 ID 和溯源警告。当 Linger 找不到可靠证据时，它会如实告知，并可能提供候选主题、决策、标签或观测到的时间段。

## 智能体支持

自动化程度因宿主和版本而异。能力等级基于观测证据报告，而非仅凭安装文件。

| 智能体 | 已验证等级 | 当前证据与限制 |
| --- | ---: | --- |
| Claude Code | L2 | Claude Code 2.1.207 在宿主活跃模型为 DeepSeek 的条件下完成了完整的 v0.2.1 host-enrichment 路径：lifecycle 捕获、确定性处理、overlay 提交和增强标签。v0.2.2 的 sidecar 升级保留了宿主自有记忆，并已通过安装和迁移验证。StopFailure 在一次性沙箱验收中已覆盖。在观测路径上，Ctrl-C 未能保留已流式输出的助手文本。 |
| Codex | L2 | Codex 0.144.0-alpha.4 完成了完整的 v0.2.1 host-enrichment 路径：lifecycle 捕获、当前模型整理、overlay 提交、tag registry 重建和精确语义召回。v0.2.2 的 sidecar 契约由 Codex adapter 共享。全新安装在一次可信的实际会话完成 SessionStart、UserPromptSubmit 和 Stop 之前保持 L1。 |
| 其他智能体 | 未实现 | 额外 adapter 不在 v0.2.2 MVP 范围内。未来的 adapter 必须遵守相同的 sidecar 边界，不触碰宿主自有记忆。 |

等级定义：

- L0：仅规则行为。
- L1：已安装 Skill，通过显式文件和 CLI 操作。
- L2：已验证的 lifecycle hook 捕获。
- L3：session-local 异步处理。
- L4：更完整的捕获、处理、恢复、索引和召回自动化。

Linger 不会仅因集成文件存在就报告 L3 或 L4。

Host enrichment 遵循相同的支持边界。在 Codex 中使用 Codex 的活跃模型；在 Claude Code 中使用 Claude Code 的活跃模型，包括用户配置的兼容端点。Linger 不安装模型 SDK、不选择模型、不索要提供商凭据。如果宿主无法或未运行 enrichment，捕获和确定性召回照常继续。

## 自然语言工作流

Skill 帮助智能体将用户意图转化为 Linger 操作。具体行为取决于宿主的 Skill 和 lifecycle 支持程度。

捕获与召回是有意区分的。在已验证的 lifecycle hooks 下，可见的对话轮次在正常聊天期间自动捕获。召回是按需驱动的：Linger 不会在每一轮都搜索或注入整个 Vault。当用户用“之前”“上次”“继续”“为什么选了”“还记得吗”等短语提及早期工作时，智能体应搜索当前项目的 Linger 证据。对于重要的查找，用户可以说“用 Linger 查一下……”，无需运行 CLI 命令。

| 你说 | 预期行为 |
| --- | --- |
| “记住这个” | 作为高优先级的 user-explicit 证据捕获。 |
| “这个不要保存” | 在 Vault 初始化前，若 hook 支持则跳过当前用户事件。 |
| “忘掉那个决策” | 将 processed memory 从普通召回中撤回，但不删除原始历史。 |
| “那条记忆不对” | 追加一条带可见证据的纠正记录；不原地改写历史。 |
| “为什么当时选了 X？” | 搜索当前项目的决策轨迹并返回带来源的证据。 |
| “我们讨论过 Y 吗？” | 搜索当前项目的对话归档。 |
| “采样这次召回” | 为本次查询选择加入，返回一个 attempt ID，等待你的质量评判。 |
| “状态” | 报告 Vault、queue、待处理项和完整性健康状况。 |

普通捕获和 enrichment 不需要用户发出单独的 Linger 命令。Lifecycle hooks 捕获可见轮次。当宿主报告存在符合条件的待处理记录时，Skill 可在主要请求完成后至多整理一个有界批次。

Linger 是 sidecar 而非宿主记忆的替代品。安装时保留 Claude Code、Codex 及未来 adapter 的原生记忆设置和文件。宿主可能独立保留了 Linger 也已捕获的事实；在召回时，活跃模型应将重复项合并为同一底层事件，并披露冲突版本。Linger 绝不将重复的上下文视为额外的投票。

遗忘和删除是不同的操作。遗忘改变召回资格。删除移除一条已确认的记录。清除仅在双重确认后移除完整的 Linger 状态。

## 隐私

完整的数据边界和删除行为见 [PRIVACY.md](PRIVACY.md)。

Linger 将可见的对话内容存储在本地文件中。其运行时不回传数据、不收集遥测、不生成 embedding、不向 Linger 服务同步数据。

本地优先不意味着数据永远不离开你的机器。当智能体召回证据或整理有界 enrichment 批次时，该证据进入当前 Claude Code 或 Codex 的上下文，可能被发送至该宿主配置的模型提供商。Linger 不会将其发送至额外的模型服务。

项目包含敏感内容的安全基线：

- 高置信度的密钥模式在原始持久化前被脱敏。
- 密钥记录被排除在 processed memory 和普通召回之外。
- 类似联系方式的敏感记录默认被排除在普通召回之外。
- 仅正常敏感度、哈希已验证的记录有资格参与 host enrichment。
- 同一捕获边界适用于 hook 捕获、手动 CLI 捕获和编程接口捕获。

该检测器不是完整的数据防泄漏系统。未知的密钥格式可能被遗漏，被显式标记但未识别的密钥材料可能仍残留在原始文件中。请像对待任何本地对话记录一样保护 Vault。不要在需要审计合规控制的场景中使用这个实验性版本。

## 安全与完整性

信任边界和私密漏洞报告流程见 [SECURITY.md](SECURITY.md)。

- 召回默认仅限当前项目。
- 跨项目搜索永远不会被隐式启用。
- 搜索对文件数、片段数、返回字符数、原始片段大小和挂钟时间施加上界。
- 超时被报告为检索失败，而非虚假的“无记忆”结果。
- ID、enum 字段、时间戳、schema 和规范记录位置在运行时验证。
- 关键 Vault 路径拒绝指向真实 Vault 根目录之外的物理符号链接逃逸。
- 被篡改的原始来源被排除或显式降级。
- 可解析但无效的记录保持惰性，出现在 doctor 报告中，仅通过确认的修复操作迁移。
- 安装和卸载在写入前验证受管目标。
- Hook 捕获失败不阻塞智能体对话。

这些控制措施降低了风险，但不保证在恶意仓库、prompt injection、文件系统竞态、手动 Vault 修改或本地账户被入侵等情况下的绝对安全。

通过 [GitHub Security Advisories](https://github.com/arishana1969/linger-skill/security/advisories/new) 私密报告漏洞。请勿在普通 issue 中包含真实密钥或 Vault 文件。

## 配置

Linger 以保守的默认值初始化：

- 除非 Vault 被暂停，否则启用捕获。
- 仅当前项目召回。
- 启用敏感内容排除。
- 无 embedding 或额外模型 API。
- Host enrichment 为可选项，每次智能体轮次至多一个有界批次，使用 Claude Code 或 Codex 中已活跃的模型。
- 至多返回 8 个片段。
- 至多返回 12,000 个证据字符。
- 至多扫描 5,000 个文件。
- 每个原始片段至多 500 字符。
- 搜索截止时间 2 秒。

暂停和恢复可通过 CLI 操作。检索上界可在每次搜索或召回请求中指定。

真实使用的召回采样默认关闭。被显式采样的查询及其结果元数据保留在本地 Vault 中；高置信度密钥被脱敏。反馈为仅追加模式，可区分有用、部分有用、错误和遗漏的召回。

v0.2.2 中并非所有内部处理阈值都作为稳定的用户配置项暴露。配置文件经过 schema 验证；不受支持的版本或无效的上界会显式报错，而非被静默改写。

## 已知限制

- 这是一个 MVP，不承诺完美召回每一个字。
- 自动捕获依赖已验证的宿主 lifecycle 支持。
- Codex hooks 需要显式的宿主信任。安装或升级 Linger 后，需启动一个新的 Codex 会话并完成一次轮次，方可依赖自动捕获。
- Claude Code 在 Ctrl-C 中断时可能丢失已流式输出的助手文本。
- 处理是事件驱动和 session-local 的；没有持久的空闲定时器或 daemon。
- 确定性的摘要、标签、检索短语和决策主题生成可能遗漏复杂语义。Host enrichment 在可用时改进整理质量，但不保证在每一轮都运行。
- Host enrichment 目前改进 processed memory 的元数据；它不会自主推断或追加决策轨迹事件。
- 密钥检测器是有意限制的，不是加密方案。
- 多窗口使用不是强一致性事务系统。
- Linger 降低 prompt injection 和恶意仓库风险，但不消除它。
- 确定性评估套件是回归基线，不是普遍真实世界质量的证明。

## 开发与验证

需要 Node.js 20 或更高版本以及 pnpm。

贡献规则和完整的候选门禁见 [CONTRIBUTING.md](CONTRIBUTING.md)。

    pnpm install --frozen-lockfile
    pnpm test
    node scripts/validate-skill.mjs skills/linger
    pnpm eval:year
    pnpm eval:adversarial
    pnpm eval:heldout
    pnpm verify:package

当前的干净候选通过了：

- 188 项自动化测试。
- 年度、对抗性和 250+ 事件留出评估门禁，宏观综合得分 1.0。
- 真实 Codex host-enrichment 验收：从 hook 捕获到精确召回的完整路径；真实 Claude Code host-enrichment 验收：使用 DeepSeek 后端宿主模型。
- Skill 验证。
- 精确 tarball 包管理器安装。
- 捕获到召回的冒烟测试。
- 卸载后 Vault 保留验证。
- 已跟踪文件的凭据扫描。

这些生成的测试套件保护已知行为，不证明在任意对话上的通用记忆质量。

## 卸载与清除

使用推荐的 npx 安装方式时：

    npx linger-skill uninstall --yes

使用全局安装或源码安装时：

    linger uninstall --yes

卸载移除受管的 Skill 和 hook 集成，但保留 Vault。

若要移除全部状态（包括 Vault）：

    node dist/cli.js purge --yes --confirm PURGE

清除是有意独立的操作，需要两个确认机制同时满足。

## 许可证

Linger 基于 MIT 许可证发布。见 LICENSE。

用户可见的变更见 [CHANGELOG.md](CHANGELOG.md)，数据边界见 [PRIVACY.md](PRIVACY.md)，安全模型与私密报告通道见 [SECURITY.md](SECURITY.md)。
