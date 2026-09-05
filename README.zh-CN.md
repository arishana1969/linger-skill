# Linger

[![npm version](https://img.shields.io/npm/v/linger-skill.svg)](https://www.npmjs.com/package/linger-skill)
[![CI](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml)

[English](README.md) | **简体中文**

面向编程智能体的文件原生对话档案与决策轨迹。

> 念念不忘，必有回响。

## 项目状态

当前工作区是 **v1.1.0 开发候选**，以已发布的 v1.0.0 为比较基线，等待独立消融与发布审查。
下文 npm 安装命令安装的是已发布版本，不是这个尚未发布的候选。

## v1.1.0 更新内容

- **CLI 安装修复：** POSIX 启动器位置固定，升级保留旧启动器路径，受管 runtime 补齐所需包文件。
  原始包或缓存删除后仍可查询版本、重装、查看 Local 安装计划；没有待整理记忆时 hook 也会提供可信 CLI 路径。
- **Tag 语义候选：** 按需复用已有 Local E5 模型寻找项目内相近 Tag；向量仅驻留内存，不增加第二套索引或向量库。
- **类型化关系：** 明确登记同义、别名、缩写、上下文等价、相关或歧义关系，保留置信度、项目范围和证据。
  相似度不会决定关系类型，也不会自动写入同义关系。
- **受控查询扩展：** 高置信等价关系只扩展一跳；相关与歧义不扩展；上下文关系需要显式查询上下文。
  保留原始词法精确命中的优先级和置信度保护。
- **兼容旧内容：** 继续读取 v1.0.0 与旧版 Vault、配置、记录、Registry；保留文档级 hybrid 检索和原 Local profile。
  无新增依赖、设置、服务或迁移。

完整变更与兼容边界见 [CHANGELOG.md](CHANGELOG.md) 和 [UPGRADING.md](UPGRADING.md)。

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
POSIX 受管入口固定为 `~/.local/bin/linger`；Windows 为 `~/.linger/bin/linger.cmd`。安装器会报告绝对路径，
以及该目录是否在安装进程的 PATH 中；不会修改 shell 配置或父进程环境。POSIX 如有需要，可执行：

```sh
export PATH="$HOME/.local/bin:$PATH"
linger --version
```

要让后续会话可用，将同一目录加入自己的 shell 配置，或直接使用安装器报告的绝对路径。全局 npm 安装会在
npm bin 目录暴露 `linger` 与 `linger-skill`；`npx linger-skill install` 本身不是全局 npm 安装。
升级会刷新此前受管的 `~/.linger/bin/linger`。Hook 直接调用记录的 Node/CLI 路径，不依赖 shell PATH；
替换或移除该 Node 安装后，应重跑安装器。

从 v0.2.2 或 v1.0.0 升级不会改写 Vault，见 [UPGRADING.md](UPGRADING.md)。

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

v1.1.0 没有 API/Remote Embedding backend，也不会要求 embedding API key。唯一已验收 Local profile 是：

```text
macOS（Darwin）/ arm64
Node 24 artifact identity
@huggingface/transformers 4.2.0
onnx-community/multilingual-e5-base-ONNX @ d15bb63d…
onnx/model_quantized.onnx，dtype=q8，768 维
```

Local Embedding 默认关闭；升级保留已有项目启用意图与 profile。启用需要显式完成 lifecycle：

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

其他系统、架构、模型、revision、dtype 与 runtime 组合在 v1.1.0 中均为 unsupported。

## Tag 候选与关系

```sh
linger tags list --project PROJECT_ID
linger tags rebuild --project PROJECT_ID
linger tags suggest --project PROJECT_ID --term "db" --limit 8
# 查看证据并确认缩写含义后：
linger tags relate --project PROJECT_ID --from db --to database --type abbreviation --confidence 0.95 --evidence EVENT_ID
linger tags relations --project PROJECT_ID
linger recall --project PROJECT_ID --query "db" --context backend
```

`list` 读取现有 Tag Registry；processing/enrichment 已会自动重建它。`suggest` 只读，复用文档检索的 Local
runtime/profile，不要求文档索引。每次最多考虑 128 个当前合格 Tag（标准化名称精确匹配优先，其后按使用次数），
默认返回 8 个、最多 20 个，用 `considered_tags` / `total_tags` 报告覆盖范围。只有来自完整、校验通过、普通敏感级别
有效文档的 Tag 才进入 worker；推理预算为 30 秒。向量随后丢弃，不写进 Tag Registry 或 Term Graph。

`semantic_similarity` 是余弦排序值，不是同义置信度，也没有经过 Tag 效果阈值校准。相近候选可能是上下位词、
反义词，或在本项目中无关。先查看候选证据 ID，再执行 `relate`；命令校验证据完整性与项目范围，关系含义由整理者
判断。同一标准化词对与 context 会在现有 schema-v1 Term Graph 中更新，保留类型、置信度、证据与时间戳。

| 关系类型 | 置信度 ≥ 0.6 时的查询扩展 |
| --- | --- |
| `synonym`、`alias`、`abbreviation` | 双向一跳 |
| `contextual_equivalent` | 必须有非空 context，且显式 `--context` 至少匹配一项 |
| `related`、`ambiguous` | 不扩展；同一适用上下文中，还会否决相同词对的冲突等价关系 |
| 旧版 `location_mapping`、`product_name` | 保留显式整理的双向映射，不自动推断为同义 |

任何带 context 的关系都要求查询至少匹配一项。扩展使用较低词法权重，仅靠扩展命中的结果仍为 `possible_match`。
Embedding 分数不能创建或增强关系。原 Tag Registry 的 `related_terms` 和 `aliases` 保持原格式；类型化图负责语义关系。

Embedding 关闭或不可用时，`suggest` 返回标准化名称精确匹配及明确状态，词法搜索和已整理的关系扩展继续工作。
文档级 hybrid 检索保持原样；图中的非等价关系不会屏蔽模型认为相近的所有文档，semantic-only 结果仍只是候选。

## 配置

用 `linger config show --project PROJECT_ID` 查看有效值及来源。v1.1.0 不增加设置：

| 现有配置 | 范围与作用 |
| --- | --- |
| `embedding.desired_enabled` | 项目；授权本地文档检索与显式 Tag 候选发现，默认 `false` |
| `embedding.profile_id` | 项目；两者复用同一已校验 Local runtime/model |
| `embedding.semantic_weight` | 全局/项目；文档 hybrid 权重，默认 `0.7`，不决定 Tag 关系或控制 Tag 候选 |
| `recall.*` | 保持现有词法检索时间、文件数与输出上限 |

`embedding-disable --project PROJECT_ID` 会停止两种本地语义用途，已登记关系仍可服务词法召回。
查询上下文通过 `--context` 显式传入，不新增全局上下文状态。

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
