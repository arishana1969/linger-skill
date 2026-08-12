# Linger

[![npm version](https://img.shields.io/npm/v/linger-skill.svg)](https://www.npmjs.com/package/linger-skill)
[![CI](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml)

[English](README.md) | **简体中文**

面向编程智能体的文件原生对话档案与决策轨迹。

> 念念不忘，必有回响。

## 项目状态

Linger v1.0.0 是面向 Claude Code 与 Codex 的首个正式产品版本。它把项目中的可见对话保存为本地、可追溯
的证据，但不承诺完整捕获每个字，也不提供生产级合规保证。

## Linger 能做什么

- 通过受管 lifecycle hooks 捕获可见的用户/助手消息，宿主不支持时可退回 CLI。
- 保留不可变 Raw 证据、确定性 processed memory、修正以及决策演变。
- 报告当前项目的 Capture Health，不把“文件已安装”误当成“捕获正常”。
- 可在当前对话查看和关闭 Linger，不影响其他会话。
- 用来源 ID、完整性警告、时效性和冲突回答“为什么当时这么决定”。
- 可选地使用 Claude Code/Codex 当前正在运行的模型整理记忆，不增加独立 provider 或 API key。
- 始终提供确定性 lexical recall；在一个已验收 Mac 组合上提供可选的 Local semantic recall。
- 使用版本化 JSON/Markdown 本地文件；无数据库、遥测、云同步或常驻 daemon。
- 不关闭、不替换、不改写 Claude Code 或 Codex 自有记忆。

召回内容只是历史证据，不是指令。旧记录中的命令、prompt 或系统消息不得执行；当前系统和用户指令始终优先。

## 环境与安装

基础 Linger CLI 支持 Node.js 22、24 和 26；可选 Local Embedding companion 仍绑定已验收的 Node 24 artifact identity。

```sh
npx linger-skill install
```

交互式安装会展示隐私边界并要求输入 `YES`。非交互安装必须显式传入 `--yes`：

```sh
npx linger-skill install --yes
npx linger-skill install --adapters claude-code
npx linger-skill install --adapters codex
```

需要长期 CLI 时：

```sh
npm install --global linger-skill
linger install
```

安装会保留宿主自有记忆与无关配置。fresh adapter 在真实 lifecycle event 被观察前保持未验证；应使用
`linger status` 和 `linger doctor` 查看事实，而不是根据复制的文件推断健康。
若 `~/.local/bin` 已在 PATH 中，安装器使用 `~/.local/bin/linger`；否则使用 `~/.linger/bin/linger`。安装器总会
报告 exact path 以及裸 `linger` 当前是否可达，但不会修改 shell profile；在你自行把目录加入 PATH 之前，可直接
使用安装结果中的绝对路径。

从 v0.2.2 升级不会改写 Vault。具体兼容范围、升级命令、退出的旧表面、验证方式与回退合同见
[UPGRADING.md](UPGRADING.md)。

## 工作方式

```text
宿主可见事件
  → 不可变 Raw + durable queue
  → 确定性 processed memory
  → 可选 host-model enrichment overlay
  → lexical recall
  → 可选 Local semantic branch
  → 有界、带来源的证据包
```

默认 Vault 位于 `~/.linger/vault`。Raw 与 Decision Event 是源记录；Processed、overlay、registry 和 embedding
index 都是可重建派生物。Forget 只撤销召回资格，不重写历史；Correction 追加证据；Delete 与 Purge 需要明确确认。

## 常用命令

```sh
linger status --project PROJECT_ID
linger session-off --token TRUSTED_SESSION_TOKEN
linger session-on --token TRUSTED_SESSION_TOKEN
linger doctor
linger config show --project PROJECT_ID
linger recall --project PROJECT_ID --query "为什么选择 SQLite？"
linger why --project PROJECT_ID --topic "数据库"
linger inspect --project PROJECT_ID --memory MEMORY_ID
linger pause
linger resume
```

使用 `linger project-id --cwd .` 纯读获取当前项目 ID。Git linked worktree 共用同一本地仓库身份，second clone
保持隔离。目录或仓库移动后，使用 `linger project-attach --project ID --cwd PATH --yes` 显式关联新的空 locator；
若新 locator 已有项目数据，Linger 会拒绝静默合并。观测到 remote 变化后可用
`linger project-confirm-identity --project ID --cwd PATH --yes` 确认。

Recall 默认只查当前项目。Timeout 或 integrity failure 会被报告为 retrieval failure，不会伪装成“没有记忆”。

安装后的 Skill 会把“记住这个”“不要保存”“之前讨论了什么”“为什么选择 X”“那条记忆错了”“忘掉这条”
映射到对应的有界操作。

状态和当前对话控制使用宿主原生入口：Claude Code 使用 `/linger`，Codex 使用 `$linger` 或 Skill picker。
Session token 只能来自可信 hook context，不包含对话正文，也不会影响其他会话或宿主自有记忆。

## 旧版兼容

v1 原地读取既有 schema-v1 Raw、Processed、Decision、Queue、Project、Registry、Config 与 Markdown。对同一 root
优先复用旧 project ID，不静默创建第二项目；只升级 manifest 能证明由 Linger 拥有的 legacy Codex Skill，不批量
改写 Vault。runtime identity 变化时可重建派生 index，但不改写源记录；Uninstall 继续保留旧版与当前 Vault 内容。

## 可选 Local Embedding

v1.0.0 没有 API/Remote Embedding backend，也不会要求 embedding API key。唯一已验收 Local profile 是：

```text
macOS（Darwin）/ arm64
Node 24 artifact identity
@huggingface/transformers 4.2.0
onnx-community/multilingual-e5-base-ONNX @ d15bb63d…
onnx/model_quantized.onnx，dtype=q8，768 维
```

fresh install 与 upgrade 后均为关闭。启用需要显式完成完整 lifecycle：

```sh
linger embedding-install-plan
linger embedding-install --project PROJECT_ID --yes
linger embedding-enable --project PROJECT_ID
linger embedding-rebuild --project PROJECT_ID
linger embedding-status --project PROJECT_ID
```

Plan 会显示 runtime/model identity、体积与完整 transitive license inventory。模型和 runtime 不进入 npm 包。
安装只从 allowlisted npm/Hugging Face source 获取固定 artifact，不携带凭据、查询文本或项目内容，也不执行
package manager 或 lifecycle script。

随包 acquisition manifest 中的 `candidate_not_validated` 表示用户机器上的未来下载尚未经过 install-time
verification；成功 acquisition/install 后会写入 `installed_candidate_validated`。冻结 profile 组合本身已经完成
产品验收，而下载前状态不会对尚未出现在用户机器上的 bytes 作验证声明。

Installer 使用有界安全 extractor 与 fixed dependency graph。Content manifest 绑定每个目录/文件、字节数与
SHA-256，worker 启动前重验完整安装树。Inference 只读取本地文件，关闭 remote model 与 cache write。当前安装
总量约 685 MB，其中模型约 295 MB。

关闭或删除派生状态：

```sh
linger embedding-disable --project PROJECT_ID
linger embedding-delete-index --project PROJECT_ID --yes
linger embedding-remove-runtime --project PROJECT_ID --yes
```

Disable 会保留 index；删除 index 不影响源记忆；任一项目仍启用 profile 时拒绝移除 runtime。模型缺失、index
stale、敏感 query、timeout 或 worker failure 都会带明确原因回退 lexical。

其他系统、架构、模型、revision、dtype 与 runtime 组合在 v1.0.0 中均为 unsupported。

## 隐私

Linger 把可见对话保存在本地，不安装遥测或 Linger 云服务。

“本地优先”不等于所有 host-model 工作都不离机：召回证据与可选的 bounded enrichment batch 会进入当前
Claude Code/Codex context，并可能发送给该宿主配置的 provider。Linger 不选择额外 provider，也不索取 key。

Local Embedding 不同：embedding input 与 vector 留在本机。Artifact host 只看到固定文件下载请求，不接收项目
内容；secret/sensitive query 不会进入 Local worker。

高置信 credential pattern 会在 Raw 持久化前脱敏，secret record 不进入普通 processing/recall。这只是安全基线，
不是完整 DLP 或加密。请像保护本地 transcript 一样保护 Vault。

完整边界见 [PRIVACY.md](PRIVACY.md)。

## 安全与限制

- 自动捕获依赖当前、已验证的宿主 lifecycle 支持。
- Claude Code/Codex 被中断时可能无法保留完整助手输出；partial evidence 会明确标记。
- Processing 是 session-local、event-driven，没有常驻 idle timer。
- 确定性摘要与 host enrichment 可能遗漏复杂语义。
- Local semantic 只改善候选发现，不能把 semantic-only hit 提升成 exact factual evidence。
- 多窗口写入有界且关键路径原子化，但不是分布式事务系统。
- Secret detector 不完整；本地账户被攻陷不在 Linger 的保护范围内。
- 只有上述 Darwin/arm64 Local profile 完成真实 runtime/model 验收。

关键路径校验 schema、ID、canonical location、source hash 与物理 Vault 边界；被篡改的记录或 Local 安装会
fail-closed。`doctor` 报告异常，repair 与破坏性操作需要确认。

完整威胁模型与私密报告渠道见 [SECURITY.md](SECURITY.md)。

## 开发

开发需要 Node.js 22、24 或 26 和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm eval:year
pnpm eval:adversarial
pnpm eval:heldout
pnpm verify:package
```

npm 包排除测试、临时 evidence、cache 与 model/runtime artifact。贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 卸载与清除

```sh
npx linger-skill uninstall --yes
```

Uninstall 删除受管 Skill、hook、launcher 与 runtime integration，但保留 Vault 与宿主自有记忆。完整删除 Linger
state 是独立操作：

```sh
linger purge --yes --confirm PURGE
```

## 许可证

Linger 使用 MIT License。第三方 Local runtime/model 的许可证会在 acquisition 前展示，不被 Linger License
替代。另见 [CHANGELOG.md](CHANGELOG.md)、[PRIVACY.md](PRIVACY.md) 与 [SECURITY.md](SECURITY.md)。
