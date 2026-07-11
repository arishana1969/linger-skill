- **状态**：Draft
- **阶段**：产品需求文档
- **首发目标**：Claude Code + Codex
- **核心形态**：Skill-first、file-native、conversation archive、decision trail、no user-managed daemon

---

# 1. 产品定位

Continuity Skill 是一个面向 Claude Code / Codex 等 coding agents 的本地对话归档与决策轨迹连续性 Skill。

它的目的不是做通用 AI memory，而是让用户在长期使用 Agent 的过程中，尽可能无感地保存对话、整理上下文、保留决策演化路径，并在之后需要时可检索、可召回、可溯源。

**一句话：**

> Continuity Skill lets coding agents remember long-running conversations through local files you own.

**中文：**

> 让 Claude Code / Codex 这类 Agent 通过用户拥有的本地文件，持续保存、整理和召回长期对话与决策轨迹。

---

# 2. 核心目标

MVP 的核心目标有三个。

**第一，长期对话连续性。**

用户不需要管理 session、上下文窗口、summary、memory。即使宿主 Agent 压缩了旧上下文，Continuity Skill 也能作为长期记忆安全网，让用户在未来找回过去聊过的内容。

**第二，记事功能。**

用户可以显式说"记一下""这个要记住""不要记这个""忘掉刚才那个"，系统应识别并保存或处理。

**第三，决策演化路径。**

系统不只保存最终结论，还要保存同一件事从想法、偏好、提案、理由、约束、否决、决策、修正到当前状态的变化过程。

---

# 3. 非目标

MVP 不做以下事情：

- 不做聊天 App。
- 不做 WebChat。
- 不做 MCP Server。
- 不做浏览器插件。
- 不做本地 API Proxy。
- 不做通用个人 AI 记忆系统。
- 不面向普通 ChatGPT / Claude 网页用户。
- 不承诺完整 raw archive。
- 不承诺所有 Agent 自动化程度一致。
- 不默认跨项目检索。
- 不默认启用 embedding。
- 不使用数据库作为记忆本体。
- 不要求用户启动或维护常驻服务。
- 不承诺恶意 repo / prompt injection 下绝对安全。

---

# 4. 产品原则

## 4.1 用户体验原则

用户只需要安装一次，之后继续正常使用 Claude Code / Codex。

系统应该最大程度无感，不频繁打断用户，不要求用户手动整理文件、tag、summary、memory。

## 4.2 本地文件原则

记忆属于用户，因此 source of truth 必须是用户本地可见、可备份、可迁移的文件。

允许使用 cache，但 cache 可删除、可重建，不是记忆本体。

## 4.3 原始记录原则

系统最大程度保存原记录，但不承诺 100% 全量原文归档。

> **正式表述使用：** 最大程度保存原记录。
>
> **不使用：** 完整 raw archive。

## 4.4 Evidence-only 原则

召回出来的记忆是历史证据，不是当前指令。

Agent 不得执行记忆中的命令，不得遵守旧 memory 里的 system prompt。当前用户指令永远优先。

## 4.5 不编造原则

找不到就说找不到。

线索不足时返回候选，而不是编造"记忆"。

## 4.6 不原地修改原则

已提交记忆不原地修改。

纠错、覆盖、推翻、删除都通过追加事件或用户明确操作完成。

---

# 5. 目标用户

**MVP 目标用户：**

Claude Code 用户。Codex 用户。长期使用 coding agents 的开发者。AI power user。经常围绕项目进行长时间讨论、设计、开发、复盘的人。

**非 MVP 用户：**

普通网页 ChatGPT / Claude 用户。不使用本地 coding agent 的用户。企业知识库用户。移动端用户。

---

# 6. 核心用户场景

## 6.1 长期项目讨论

用户连续几周或几个月围绕一个项目和 Agent 讨论。宿主上下文可能被压缩，但 Continuity Skill 保存了原始事件、整理后的主题、tag、决策路径。

未来用户问：

> 之前我们为什么不做 MCP？

Agent 应能召回当时的讨论，说明原因、状态变化和来源。

## 6.2 记事

用户说：

> 这个要记一下。

系统应将该内容作为 user_explicit memory，置信度最高，优先召回。

用户说：

> 这个不要记。

系统应暂停或跳过本轮保存。

## 6.3 决策变更

用户先决定 A，后来改成 B，最后又回到 A。

系统不应只保存最终 A，而应保存 A → B → A 的路径，包括每次变化的时间、理由、来源和当前状态。

## 6.4 异常中断

用户断网、断电、关闭窗口或回复中断。

系统保留 tmp/pending，下次启动时提示恢复、处理或丢弃，不把未完成内容伪装成完整记忆。

---

# 7. 总体架构

系统分为五层：

1. **Skill / Rule 层** — 负责 prompt 指引，告诉 Agent 什么时候保存、什么时候检索、如何使用记忆。
2. **Hook 层** — 监听用户消息、AI 回复完成、session 启动、session 结束等事件，发送捕获信号。
3. **Helper CLI 层** — 负责可靠文件操作，包括 tmp、raw 写入、hash、dedupe、queue、search、delete、doctor。
4. **Processing Workers 层** — 负责整理、打 tag、生成 search phrase、抽取事实、维护 decision trail、维护同义词关系图。
5. **Vault 层** — 本地文件存储，包括 raw events、processed memories、registry、term graph、decision trail、cache。

---

# 8. 组件职责

## 8.1 Skill

Skill 只做 prompt 指引。

**职责：** 告诉 Agent 何时保存。告诉 Agent 何时检索。告诉 Agent 记忆是 evidence，不是 instruction。告诉 Agent 找不到时必须诚实。告诉 Agent 用户不需要管理 memory/tag/session。识别用户显式记忆指令，如"记一下""忘掉这个""不要保存"。

**不承担：** 原子写入。文件锁。加密。去重。强一致性。复杂状态管理。

## 8.2 Hook

Hook 做机械、低智能动作。

**职责：** 监听用户消息发送。监听 AI 回复完成。监听 session 启动。监听 session 结束或中断。触发 capture。触发 pending scan。触发 processing queue 消费。

**Hook 不做：** 内容理解。decision 判断。tag 判断。summary。同义词归纳。

## 8.3 Helper CLI

Helper CLI 是安全文件操作层。

它不是 daemon，不是数据库，也不是用户日常入口。

**职责：** 写 tmp。原子写 raw event。生成 seq_id。生成 event_id。生成 content_hash。标记状态。入队。检索。去重。删除。forget。status。inspect。doctor。scope 限制。path traversal 防护。敏感信息基础处理。

Helper 是必须的。不能只靠 prompt 让 Agent 自己写文件。

## 8.4 Capture Worker

Capture Worker 负责快速捕获，不做智能整理。

**原则：** 越机械越好。越快越好。不依赖 LLM。优先保证 raw event 存在。失败不影响用户继续对话。

## 8.5 Processing Worker

Processing Worker 对应原来的 Agent2。

**职责：** 增量处理 raw。生成 summary。打 content tags。打 predictive tags。生成 search phrases。抽取事实。抽取 idea / preference / proposal / decision。更新 processed memory。生成 index fragment。生成 decision event。

MVP 中 Processing Worker 串行执行。

## 8.6 Term Graph Maintainer

Term Graph Maintainer 对应原来的 Agent3。

**职责：** 维护同义词 / 相关词图谱。只读 raw、tag index、search phrases。只写 term graph 文件。不替换原始 tag。不做不可逆归并。

MVP 只做最小版，不做复杂长期巡检。

---

# 9. 工作流设计

## 9.1 总体工作机制

采用：

> 实时捕获、队列整理、串行合并。

也就是：capture path 是流式、快速、机械的。processing path 是异步、可积压、可重试的。index/registry merge 是串行、保序、去重的。

## 9.2 Capture Path

Hook 在每次对话事件后触发。

**事件包括：** user message sent。assistant answer completed。assistant answer interrupted。session started。session ending。explicit memory command。

**Hook 触发后：**

1. Helper 创建 tmp。
2. 写入事件 payload。
3. 原子 rename。
4. 写入 raw event。
5. 生成 seq_id。
6. 生成 content_hash。
7. 标记 captured。
8. 加入 processing queue。

## 9.3 Savepoint

正常 savepoint 是完整的一轮 User → Assistant。

用户消息可以先被捕获，但只有 assistant 回复完成后，才视为完整 turn。

如果 assistant 回复中断，则状态为 partial。

## 9.4 Processing Path

Processing Worker 消费 queue。

**触发条件：** 新增 raw 超过 50KB。距离上次处理超过最大等待时间。用户主动 recall 时发现相关 pending raw。session 启动时发现 pending。session-local scheduler 到点。用户显式保存内容。

50KB 是默认软阈值，不是唯一触发条件。

## 9.5 队列机制

队列必须持久化，避免进程崩溃后丢失。

**队列要求：** FIFO 为主。用户显式保存优先。failed 可重试。重复任务可 dedupe。processing 可恢复。backlog 可被 status/doctor 查看。

MVP 不做 Agent2 并行。

后续可支持 bounded parallel，但同一 project、同一 decision topic 的合并必须保持顺序。

## 9.6 Backpressure

当 queue 很深时，默认不频繁打扰用户。

**只在以下情况提示：** 用户主动 status。用户 recall 命中未整理内容。queue 长期失败。backlog 严重影响召回质量。

提示应轻量，不破坏无感体验。

---

# 10. 文件与存储设计

## 10.1 Vault 默认路径

**默认路径：**

`~/.continuity/vault`

**主要分区：** global、projects、sessions、raw、processed、registry、term_graph、decisions、queue、tmp、cache。

## 10.2 Source of Truth

source of truth 是 raw event 文件和 processed memory 文件。

不使用数据库作为记忆本体。

cache 可以存在，但可删除、可重建。

## 10.3 Raw Events

Raw 不应混入智能判断。

**Raw 中只允许机械元数据：** schema_version、event_id、session_id、project_id、seq_id、turn_id、role、timestamp、source_agent、source_model、content、content_hash、savepoint_status、capture_status、sensitivity、raw_ref。

不应在 raw 中插入"话题转折点"这种 Agent 判断。

话题边界、主题切分、summary 应放在 processed 层。

## 10.4 Raw 存储格式

**MVP 推荐：** raw event 使用独立 JSON event 文件，便于原子写入。可生成 Markdown mirror 供人阅读。Markdown mirror 是派生文件，不是唯一事实源。

后续可支持 JSONL shard 或 raw compaction。

## 10.5 Markdown Mirror

Markdown mirror 用于人类阅读。

**原则：** 写入后视为只读。系统不提供已提交内容的原地编辑。用户手动修改时，系统不阻止。hash 不匹配时标记 tampered。tampered source 降低可信度。

## 10.6 Processed Memory

Processed memory 使用 Markdown + frontmatter。

**字段包括：** schema_version、id、type、scope、project_id、title、summary、tags、predictive_tags、retrieval_phrases、source_events、confidence、source、status、sensitivity、supersedes、superseded_by、created_at、updated_at、agent、model。

## 10.7 Registry

**Registry 拆分为：** tags registry、topics registry、aliases registry、decisions registry、projects registry、term graph registry。

[INDEX.md](http://index.md/) 只作为人类入口，不承担全部机器索引职责。

---

# 11. Tag 设计

## 11.1 扁平标签

Tag 采用扁平结构，不做树状分类。

**原因：** 避免强迫排他性分类。一条内容可以属于多个主题。召回时命中任一相关 tag 即可进入候选。长期使用后 tag 增长具有边际递减。

## 11.2 多维度打标

一条 processed memory 可以同时有多个 tag，**例如：** 技术主题、项目阶段、风险类型、决策类型、情绪/语气、任务状态、版本信息。

## 11.3 Tag Registry

虽然 tag 是扁平的，但需要治理。

**每个 tag 至少维护：** raw_tag、normalized_tag、aliases、related_terms、usage_count、created_at、last_used、examples、confidence。

## 11.4 Content Tag 与 Predictive Tag

**必须区分：** **content tags**：内容本身在说什么。**predictive tags**：未来用户可能用什么问题检索到它。**retrieval phrases**：自然语言检索短语。

**例如：** content tag 可能是 storage、database、file-native。retrieval phrase 可能是"为什么不使用数据库""之前说过 SQLite 吗"。

---

# 12. 同义词与关系图

## 12.1 不做归并替换

写入时保留原始 tag。

系统不把 db 自动替换成 database，也不把杭州替换成浙A。

原始表达必须保留。

## 12.2 不使用无条件等价类

同义词关系不能简单做无向等价类。

应使用上下文关系图。

**关系类型包括：** synonym、alias、abbreviation、related、contextual_equivalent、location_mapping、product_name、ambiguous。

**每条关系包含：** term_a、term_b、relation_type、confidence、context_tags、evidence_refs、created_at、last_verified。

## 12.3 召回时扩展

同义词扩展只在召回时发生。

**扩展需要考虑：** 当前 query。当前 project。当前 tag 组合。term graph confidence。ambiguity risk。

## 12.4 MVP 冷启动策略

**MVP 使用以下方式发现关系：** tag 共现。search phrase 共现。上下文窗口重叠。用户检索行为。LLM 批量验证。

MVP 不做大规模自动巡检，只做最小可用 term graph。

---

# 13. Decision Trail

## 13.1 核心目标

Decision Trail 是本项目最重要的差异化。

它记录的不是"当前结论"，而是"这个结论怎么来的"。

## 13.2 类型

**支持以下类型：** idea、preference、proposal、rationale、constraint、rejection、decision、current_state、todo、correction。

其中 idea 是独立类型。

很多真实决策来自灵感、直觉、偏好或发散想法，不一定有严格理由。系统必须能保存这种"想法 → 偏好 → 提案 → 决策"的链条。

## 13.3 状态

**Decision 状态包括：** proposed、accepted、rejected、superseded、reopened、current、unknown。

## 13.4 双来源

Decision 来源有两种：

> **user_explicit**：用户明确声明。
>
> **agent_inferred**：系统自动整理时推断。

**规则：** user_explicit 绝对优先。agent_inferred 不能覆盖 user_explicit。低置信度 decision 不得更新 current_state。每条 decision 必须带 evidence。

## 13.5 事件流与当前视图

Decision Trail 拆成两层：

> **Decision events**：不可修改的历史事件。
>
> **Current decision view**：从事件流推导出的当前状态。

Current view 是派生结果，不是事实源。

## 13.6 数据结构要求

**每个 decision topic 需要：** canonical_id、aliases、events、current_state、source_events、confidence、merge_history、superseded_by、reopened_at。

---

# 14. 召回策略

## 14.1 召回触发

主 Agent 自决是否调用 memory search，但 Skill 必须规定以下语义优先检索：之前、当时、上次、我们说过、为什么选、继续那个、之前的方案、这个决定怎么来的、有没有聊过、还记得吗。

不使用外挂意图分类器，不增加额外 API 调用。

## 14.2 默认检索范围

**默认检索：** 当前 project scope。global 中非敏感、明确可复用内容。

**默认不检索：** 其他 project。sensitive memory。encrypted content。revoked/deleted memory。tampered high-risk source。

跨项目搜索必须由用户明确要求。

## 14.3 检索方式

**MVP 使用：** BM25。Tag filtering。Alias expansion。Term graph expansion。Search phrases。Time/scope filters。

MVP 不使用 embedding。

后续可加入 embedding 做 rerank。

## 14.4 中文与中英混合

BM25 必须考虑中文和中英混合。

**需要支持：** CJK tokenizer 或 n-gram。中英 alias。tag normalization。search phrase expansion。关键词变体。

## 14.5 Ranking

**排序考虑：** project scope match。exact tag match。alias match。keyword density。BM25 score。decision/topic match。time proximity。recency。user_explicit priority。confidence。source quality。pending raw penalty。tampered penalty。sensitive exclusion。

## 14.6 置信度分层

**召回结果必须区分：** exact record found。similar record found。possible match。no reliable memory found。conflicting memories found。unprocessed raw match。

## 14.7 候选兜底

用户线索不足时，不直接编造。

**应返回候选列表：** 可能相关主题。可能相关决策。可能相关时间段。可能相关 tag。

引导用户提供更多线索。

## 14.8 Evidence Package

Search 返回给主 Agent 的不是全文，而是 evidence package。

**内容包括：** match_type、confidence、source、snippet、decision_path_summary、raw_ref、warning_flags、sensitivity_flags。

---

# 15. 记事功能

## 15.1 显式记忆指令

**系统必须识别：** 记一下、这个要记住、保存这个、这个不要记、忘掉这个、删除刚才那个、更新一下这件事、不是这个意思、这条不对。

## 15.2 显式优先级

**用户显式保存的内容：** source = user_explicit。confidence 最高。进入优先队列。召回时绝对优先于 agent_inferred。

## 15.3 不保存

**用户说"不要记"时：** 当前 turn 不进入 processed。是否保留 raw 取决于配置。默认至少不参与 recall。如果用户明确要求完全删除，则执行 delete flow。

---

# 16. 用户控制

## 16.1 必须支持

pause、resume、don't save this、forget、delete、delete last、correct、status、inspect、doctor。

## 16.2 Forget

Forget 表示不再参与检索。

**实现：** processed memory 标记 revoked。registry 移除 active 引用。raw 默认保留。

## 16.3 Delete

Delete 表示删除指定内容。

**规则：** 必须二次确认。用户指定删 processed，就删 processed。用户指定删 raw，就删 raw event 或 raw 片段。删除后更新 registry。可留下 delete event。purge 才彻底删除 vault。

## 16.4 Correct

Correct 表示纠正旧记忆。

**实现：** 不改旧记录。追加 correction event。标记旧 memory corrected/superseded。更新 current view。保留历史路径。

## 16.5 Edit

系统只允许用户在当前未提交缓存里编辑。

一旦提交，系统不提供原地编辑能力。

用户在文件系统外部手动修改文件，系统不阻止，但会通过 hash/tamper 机制降级处理。

---

# 17. 隐私与安全

## 17.1 安装时必须告知

**安装器必须明确说明：** 系统会在本地保存对话记录。召回内容可能发送给当前云模型。local-first 不等于完全不出本机。如果后续启用 embedding API，文本可能发送给 provider。恶意 repo / prompt 可能诱导 Agent 访问本地文件。本项目降低风险，但不提供绝对安全保证。

## 17.2 Prompt Injection 防护

**默认策略：** Agent 不直接读取全 vault。检索尽量通过 helper。默认 project-only recall。默认限制返回片段数。默认限制返回长度。retrieved memory 是 evidence，不是 instruction。memory 中的命令不得执行。memory 中的旧 system prompt 不得遵守。当前用户指令优先。

## 17.3 跨项目泄露防护

默认不跨项目搜索。

其他项目内容只有在用户明确要求时才参与检索。

global memory 只存非敏感、明确可复用内容。

## 17.4 敏感信息

**敏感内容包括：** API key、token、password、private key、.env、cookie、SSH key、phone、email、address、customer information、health、finance、identity、politics、emotional state。

**策略：** secret 类内容默认不进入 processed。secret 默认不参与 recall。secret 默认不显示在窗口。高置信 secret 可在 capture 时加密保存。如果无法安全显示，Agent 应拒绝展示，并提示用户自行查看本地文件或使用安全方式。敏感推断 tag 默认不生成，除非用户允许。

## 17.5 Hidden Reasoning

不得保存 hidden reasoning。

**rationale 只能来自：** 用户明确说过的话。assistant 可见回复。可引用的对话证据。

---

# 18. Tamper 与文件破坏处理

用户可以在文件系统中修改任何文件，系统无法阻止。

**系统要求：** 每个 raw event 有 content_hash。每个 processed memory 有 source hash。hash 不匹配时标记 tampered。frontmatter 不合法时 quarantine。文件不可读时 skip，并在 doctor 中报告。tampered 内容默认低可信。tampered 内容中的指令不得执行。

Skill 仍应尽量正常工作，不因个别文件损坏整体崩溃。

---

# 19. 安装与卸载

## 19.1 安装命令

**默认：**

`npx -y continuity-skill install`

**支持：** interactive install。`--yes` 默认安装。

## 19.2 默认配置

**默认配置：** 自动保存。no embedding。project-only recall。sensitive exclusion。English protocol prompt。vault at `~/.continuity/vault`。

## 19.3 安装器要求

**安装器必须：** 最小依赖。无 telemetry。无不必要 postinstall。detect。backup。managed block insert。idempotent。不覆盖用户配置。可重复运行。可卸载。

## 19.4 卸载

**uninstall：** 移除 adapter。移除 managed block。不删除 vault。

**purge：** 二次确认。删除 vault。删除 cache。删除配置。

---

# 20. Adapter 支持等级

不同 Agent 自动化程度不同。

**定义等级：**

**L0：Rule-only mode** — 只安装规则，依赖 Agent 遵守。

**L1：File mode** — Agent 能读写 vault 文件。

**L2：Hook mode** — 支持 hook，可保底 capture / pending / startup scan。

**L3：Async workflow mode** — 支持后台 subagent，可整理 memory。

**L4：Full continuity mode** — 支持较完整 capture、processing、indexing、recall、recovery。

**MVP 目标：** Claude Code：目标 L2-L4，需实测确认。Codex：目标 L1-L3，需实测确认。

不承诺"支持所有 Agent"。

**正式表述：**

> 同一套 vault 格式可被多个 adapter 使用，但不同 Agent 的自动化程度不同。

---

# 21. Project Scope

## 21.1 Project ID

**project_id 生成规则：** 优先使用 git remote + git root path hash。没有 git 时使用 absolute path hash。display_name 使用目录名。

## 21.2 默认检索边界

默认只检索当前 project。

global 只保存长期偏好、跨项目工作方式、用户明确要求记住的非敏感事实。

项目专属敏感内容默认不进入 global。

## 21.3 多窗口

MVP 不承诺多窗口绝对无冲突。

**降低风险的策略：** 每个 session 独立 raw event。每个 project 独立 queue。共享 registry 通过 fragment 合并。event_id/content_hash 去重。doctor 尽力修复。

---

# 22. 性能与成本

## 22.1 Processing Budget

**需要支持：** max runs per hour。max tokens per run。skip if conversation too short。skip if no durable content。pause background processing。backlog status。

## 22.2 50KB 阈值

默认新增 raw 超过 50KB 触发整理。

50KB 约等于 12K-16K tokens，是单次整理的舒适区。

但必须同时支持最大等待时间，避免低频用户长期不整理。

## 22.3 Raw 与 Processed 切分

Raw 按 session / 时间切分。Processed 按 topic / decision / project 切分。Search index 可按 project / 时间分片。

## 22.4 Search 限制

**Recall 必须限制：** max files。max snippets。max characters。max raw fragment size。search timeout。

---

# 23. Embedding

MVP 不支持 embedding。

默认 no embedding。

**后续可选支持：** local embedding。API embedding。embedding cache。cache rebuild。semantic rerank。

如果使用 embedding API，必须明确说明文本可能发送给 provider。

Embedding cache 位于 `.cache`，可删除、可重建，不是 source of truth。

---

# 24. Failure Model

## 24.1 Capture Fail

用户对话继续。不保存 memory 或保留 error event。不影响主流程。

## 24.2 Processing Fail

raw 保留。queue item 标记 failed。下次可重试。

## 24.3 Indexing Fail

processed memory 可存在。检索质量下降。doctor 可修复。

## 24.4 Retrieval Fail

Agent 诚实说明没有找到可靠记忆。可返回候选。不得编造。

## 24.5 Adapter Unsupported

降级到低等级模式。明确显示当前支持等级。不得伪装成完整支持。

---

# 25. MVP 范围

## 25.1 P0 必须完成

- npx installer。
- vault 初始化。
- helper CLI。
- Claude Code adapter。
- Codex adapter。
- adapter capability report。
- hook capture。
- tmp/pending。
- raw event 写入。
- seq_id。
- content_hash。
- persistent queue。
- serial processing worker。
- processed memory。
- tag registry。
- search phrases。
- minimal term graph。
- project scope。
- project-scoped BM25 search。
- alias expansion。
- decision trail。
- user_explicit memory。
- forget。
- delete。
- correct。
- pause/resume。
- status。
- inspect。
- doctor。
- README。
- [PRIVACY.md](http://privacy.md/)。
- [SECURITY.md](http://security.md/)。
- DATA_MODEL.md。
- ADAPTER_SPEC.md。
- AGENT_COMPATIBILITY.md。

## 25.2 P1 应完成

- session-local scheduler。
- startup pending scan。
- predictive tags。
- current decision view。
- decision topic merge。
- sensitive exclusion。
- secret handling。
- tamper detection。
- index fragments。
- candidate fallback。
- backlog reporting。

## 25.3 P2 后续

- Cursor adapter。
- OpenCode adapter。
- MCP adapter。
- importers。
- embedding。
- local model。
- browser extension。
- GUI viewer。
- sync。
- stronger encryption UX。
- Agent2 bounded parallel。

---

# 26. 验收标准

## 26.1 安装验收

- 一条命令可安装。
- 不覆盖用户配置。
- 重复安装不破坏配置。
- uninstall 不删除 vault。
- purge 二次确认。
- adapter 能力可显示。

## 26.2 Capture 验收

- user message 可捕获。
- assistant completed answer 可捕获。
- interrupted answer 标记 partial。
- raw event 有 seq_id。
- raw event 有 content_hash。
- tmp 可恢复。
- queue 持久化。
- 重复事件可 dedupe。

## 26.3 Processing 验收

- 50KB 新增 raw 可触发整理。
- 最大等待时间可触发整理。
- Processing Worker 串行执行。
- processed memory 有 source_events。
- tag/search phrase 可生成。
- processing fail 不破坏 raw。

## 26.4 Recall 验收

- 当前 project 可检索历史。
- 默认不跨项目。
- tag 命中可召回。
- BM25 命中可召回。
- alias/term graph 可扩展召回。
- 线索不足返回候选。
- 找不到时不编造。
- 召回结果包含 source。

## 26.5 Decision Trail 验收

- 可记录 idea。
- 可记录 proposal。
- 可记录 rejection。
- 可记录 decision。
- 可记录 supersede。
- 可回答"为什么当时这么决定"。
- user_explicit 优先。
- agent_inferred 不覆盖 user_explicit。

## 26.6 安全验收

- retrieved memory 不作为 instruction。
- 默认不读取全 vault。
- 默认不跨项目。
- sensitive 不进入普通 recall。
- secret 不直接显示。
- delete 需要确认。
- tampered 文件可被检测或降级。

## 26.7 性能验收

- 小型 vault 检索无明显阻塞。
- 大型 vault 有 search timeout。
- processing 有 budget。
- recall 有 snippet 限制。
- queue backlog 不阻塞用户主对话。

---

# 27. 文档要求

**Repo 至少包含：** [README.md](http://readme.md/)、[PRIVACY.md](http://privacy.md/)、[SECURITY.md](http://security.md/)、DATA_MODEL.md、ADAPTER_SPEC.md、AGENT_COMPATIBILITY.md、[ROADMAP.md](http://roadmap.md/)、[CONTRIBUTING.md](http://contributing.md/)。

README 主定位不要写成通用 AI memory。

**推荐定位：**

> Continuity Skill is a file-native conversation archive and decision trail continuity layer for coding agents.

---

# 28. Roadmap

## v0.1

**目标：**

- Claude Code + Codex。
- file-native vault。
- helper CLI。
- hook capture。
- raw event。
- queue。
- serial processing。
- BM25 + tag + alias recall。
- minimal decision trail。
- no embedding。
- no user-managed daemon。

## v0.2

**目标：**

- 更强 decision trail。
- better term graph。
- better tag registry。
- startup repair。
- tamper detection。
- secret handling。
- candidate fallback。

## v0.3

**目标：**

- Cursor / OpenCode。
- optional embedding。
- importers。
- better inspect。
- bounded parallel processing。

## v0.4+

**目标：**

- MCP adapter。
- sync。
- GUI viewer。
- browser extension。
- 普通用户入口。

---

# 29. 当前技术设计阶段待定项

以下不阻塞 PRD，但需要在技术设计中确定：

1. Claude Code / Codex hook 能力实测。
2. final answer capture 能力实测。
3. raw event 默认使用独立 JSON 文件还是 JSONL shard。
4. Markdown mirror 是否默认生成。
5. helper CLI 命令参数。
6. secret encryption 方案。
7. BM25 中文 tokenizer 方案。
8. term graph 文件格式。
9. queue 文件格式。
10. registry fragment merge 规则。
11. session-local scheduler 实现方式。
12. adapter config 路径。
13. Windows / WSL / remote SSH 行为。
14. doctor 修复策略。

---

# 30. 最终承诺

Continuity Skill 不承诺让 AI 永远记住一切。

**它承诺的是：**

> 在 Claude Code / Codex 等 coding agents 中，尽可能无感地将长期对话、记事内容和决策演化路径保存为用户拥有的本地文件，并在需要时通过可信、可溯源、不过度编造的方式召回。
