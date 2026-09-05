# Linger v1.1.0 独立消融报告

日期：2026-09-05。状态：完成本地消融，交给最终审查；未发布、未正式安装。

本轮实际取消了候选输出的两个重复字段、一个无消费者的类型导出、跨文档证据全集汇总、重复查询归一化、CLI 查询中间对象和重复源文件预检。保留后的生产 TypeScript 比原候选净少 **8 行**，没有新增生产模块、依赖、配置、迁移、索引或服务。最终有界回归 **215/215 通过**，临时 npm 安装和真实 v1.0.0 → 候选升级通过。

较大的删除实验揭示了明确损失：预测 Tag 消失、多词或连字符召回丢失、旧 alias 绕过歧义否决、余弦计算失真、worker 请求超限、旧入口不再维护，以及缓存消失后的受管 CLI 失效。这些删除均已恢复。这里的“最小本地候选”指本报告覆盖的产品要求与直接依赖范围；不声称已经证明全仓库的数学最小实现。

**真实 E5 Tag 效果和延迟未测量。** 受控向量验证排序、约束和调用链，不能证明模型会找到正确同义词，也不能校准 128-tag 上限或相似度阈值。

## 1. 起点、工作区与提交

| 项目 | 已核实记录 |
| --- | --- |
| v1.0.0 开发前基线 | `d56ea22` |
| 原候选 | `d4199dc9d73bdd964e7288fef3d24c9aedd501d6` |
| 原候选分支 | `codex/linger-v1.1.0-candidate`；本轮结束检查仍指向上述提交 |
| 独立分支 | `codex/linger-v1.1.0-ablation` |
| 实现及同步文档提交 | **`e966cffdf864bc9d24723e10de2c44624bc059e1`** |
| 报告提交 | 本报告由该实现提交的后续独立文档提交保存；用 `git log -1 --format='%H %s' -- ABLATION_REPORT.md` 定位 |
| 隔离工作区 | `/Users/arishana/.codex/worktrees/ce8e/Skill Project`；初始 HEAD 正确、状态干净 |
| 规则 | 已读原 `DEVELOPMENT.md`，检查项目及祖先规则；未发现额外适用项目规则 |
| 环境 | macOS arm64，Node 26.7.0，TypeScript 5.9.3，@types/node 24.13.3，undici-types 7.18.2 |

编译依赖直接复制已缓存、与 lockfile 相符的内容，没有下载依赖或模型。源码负对照每次只修改一个因果单元，完成必要检查后恢复，再继续下一单元。运行资产实验在临时 HOME 的受管副本中逐项移除并恢复文件。没有改动原候选工作区、用户正式 Vault 或本机安装。

复查实现：`git diff d4199dc e966cff -- src`。复查完整 v1.1.0 候选：`git diff d56ea22 HEAD`。过程只维护现有 `DEVELOPMENT.md` 的紧凑摘要；没有引入实验框架或历史取证目录。

## 2. 固定验收集与证据级别

“实测”指本任务确实执行的命令或断言；“代码推断”指从读取的实现得出，未伪装成运行结果；“未验证”指缺少本轮证据。最终回归之外的运行均围绕单一问题，不运行大型 year、held-out 或 adversarial 数据集。

| 固定场景 | 实测结果 / 对应现有测试文件 |
| --- | --- |
| 真同义 `automobile ↔ car`、缩写 `db ↔ database` | 显式关系能扩展；原始 exact hit 排在前面；仅扩展命中为 `possible_match`、置信度低于 0.5；`src/tag-registry.test.ts` |
| 别名与空格、连字符、混合拼写 | `host-native → host native`、反向形式、`proof-link guide → proof-link` 均保留召回；`src/search-term-graph.test.ts`、`src/enrichment.test.ts` |
| 相关 / 上下位 `storage ↔ postgresql` | 即使给所有候选同样的高相似度，`related` 仍不扩展；`src/tag-registry.test.ts` |
| 反义 `enable ↔ disable` | 显式记为非等价 `related` 后不扩展；没有添加或声称存在独立 antonym schema |
| 歧义 `cc ↔ compiler` | `ambiguous` 不扩展；相似度不产生关系 |
| 上下文 `GC ↔ garbage collector` | 需要显式 backend context；大小写及词对空格/连字符形式受同一旧边否决控制；`src/term-graph.test.ts` |
| 旧图与一跳边界 | 旧 `location_mapping`、`product_name` 可读且仍双向映射；空 context 的旧 contextual edge 不扩展；两段链不会变成二跳；`src/term-graph.test.ts` |
| Registry / 证据 | 预测 Tag 能发现；被遗忘的 Tag 不送入 worker；另一项目的 Tag 不混入；候选的一份证据样本仍可交给 writer 校验 |
| Embedding off / unavailable | off 不调用 embed；缺失 Local profile/runtime 或非法向量返回精确名称与状态；原词法结果和已有关系仍可用 |
| 精确优先与工作范围 | 130 个合格 Tag 中，排在使用频次/名称窗口外的精确名称仍被优先考虑；精确项余弦 -1 仍排在余弦 +1 的其他项之前 |
| worker 生命周期 | 24 个 Tag 加 query 形成 16 + 9 两批；两次请求重新计算；成功和失败均关闭 worker；不需要文档索引；`src/local/local-embedding.test.ts` |

关系 writer 检查项目、正常敏感级别和证据完整性，不判断引文是否足以证明“同义”。关系含义仍由整理者审阅；上下位与反义的具体含义可保留在证据中，现有类型用 `related` 表达不等价。

## 3. 已取消、删除或合并的每一部分

### B1 — 删除候选 `lexical_match`

- **位置**：`src/tag-registry.ts` 的 `TagCandidate`、候选构建和排序。
- **非必要原因**：该布尔值完全由候选 `tag` 与归一化查询词比较得到；它不是独立证据。排序与 fallback 可以直接比较同一对值。
- **实际改动**：删除输出字段；查询先计算一次 `normalizedTerm`，在 Registry 排序、精确 fallback、最终候选排序中复用。
- **收益与代价**：减少每项输出和派生状态。新候选接口的调用者若需要显示“精确”标签，需要自行比较名称；v1.0.0 无此新增接口，不改旧数据格式。
- **实测**：固定语义集与 CLI 流程通过；130-tag 用例中精确项在余弦更低时仍排第一，off/unavailable 的精确 fallback 保持可用。删除的是表示字段，精确优先规则保留。

### B2 — 删除 Tag 输出的固定 `degraded_reason`

- **位置**：`src/tag-registry.ts` 的 `TagSuggestions` 和两处 unavailable 返回分支。
- **非必要原因**：两处都只返回同一个 `embedding.tag_candidates_unavailable`，没有携带具体失败原因；与 `semantic_status: unavailable` 重复。
- **实际改动**：只保留状态，不再输出该固定字符串；off、privacy_blocked、active 和 unavailable 分支继续区分。
- **收益与代价**：输出契约少一个无新增信息的字段。没有丢失具体故障明细，因为原字段本来就不区分故障。文档级 hybrid 的 `degraded_reason` 完全未动。
- **实测**：缺失 runtime、非法向量和模拟 worker 失败均仍得到 unavailable；词法 fallback 正常。两个 README、升级说明、协议和 CLI help 已与保留行为一致。

### B3 — 取消 `TagCandidate` 的公开导出

- **位置**：`src/tag-registry.ts`，`export interface` 改为文件内 `interface`。
- **非必要原因**：仓库内没有外部消费者导入它；跨层消费者使用 `TagSuggestions`。这是候选新增的类型，不是 v1.0.0 兼容 API；npm 包也没有发布这组 `.d.ts`。
- **收益与代价**：减少一个不必要公开名字；保留清晰的内部候选类型，没有将其压成难读的内联结构。JS 行为无变化。
- **证据**：源码引用检查、TypeScript 编译和最终回归通过。此项收益是接口收缩，不宣称运行速度提升。

### B4 — 删除跨文档证据全集汇总

- **位置**：`src/tag-registry.ts` 的 `evidenceByTag`。
- **原行为**：为每个 Tag 遍历全部合格文档的 event ID、存入 Set，最后排序并只输出前五个。
- **非必要原因**：候选发现需要可检查的来源样本，不要求汇总这个 Tag 的全部使用历史；最终接口本来就只展示五个 ID。
- **实际改动**：保留同一 eligibility 检查，选择排序后的第一个合格有效文档，保存其最多五个 event ID。后续同 Tag 文档无需再向 Set 加入 ID，也不再做全集排序。
- **收益**：每 Tag 的证据容器直接限制为最多五项；去掉跨文档去重、累积与排序。有效文档本身的加载/验证范围不变，未声称实测了速度或总内存改善。
- **代价**：候选输出不再代表多个不同文档的抽样，可能少列一些佐证。审阅更广范围时仍可用 Registry、inspect 和搜索；不能把这一份样本当作完整关系论证。
- **实测**：两个 database 记录仍生成 usage_count = 2，候选只引用一个源 event，该引用被 `setTermRelation` 接受。预测 Tag 的引用仍等于其来源；被遗忘与跨项目保护继续通过。

### B5 — 合并重复查询归一化

- **位置**：`src/tag-registry.ts`、`src/term-graph.ts`。
- **实际改动**：Tag 的查询归一化从排序比较器/候选循环提到请求入口；Term Graph 的 query 列表预先运行 `termKey`，删除 `matches` 内对每个 query 的重复处理。
- **收益与代价**：相同工作从多次比较移动到一次准备；`matches` 少一个块和局部变量。没有新 wrapper、缓存、持久状态或额外 normalization schema。归一化扫描减少是代码推断，没有微基准速度结论。
- **实测**：4 项关系/搜索 focused 检查通过，最终多词、大小写、context、旧图与否决验收通过。词对匹配和 veto 继续使用同一 `termKey`。

### B6 — 合并 CLI 查询中间对象

- **位置**：`src/cli.ts` 的 `search` 分支。
- **实际改动**：取消只用一次的 `searchOptions` 和随后对象展开，直接向 `localHybridSearch` 传参；`query` 仍放在参数解析的最后。
- **收益与代价**：少一次中间对象分配和一次 spread，数据路径更直接；无新增接口。这里没有净物理行数下降，不为减少行数压缩排版。
- **实测**：CLI 中裸 `db --context backend` 不把尾部选项吸进查询，仍产生受 context 控制的扩展；带 `--query` 的 search/recall 和完整 CLI 回归通过。

### B7 — 删除重复源 hook 文件预检

- **位置**：`src/runtime-installer.ts`，删除 `sourceDist` 及拷贝前的 hook-cli `stat`。
- **非必要原因**：真正被切换为受管 runtime 的是 staged 副本；后续已在 rename 之前检查该副本的 hook-cli。检查原始源路径不是替代 staged 验证的证据。
- **保留**：版本/路径检查、受管所有权检查、完整资产拷贝、staged hook 校验、rename/回滚与清理；安装入口的 launcher/hook 预检未删除。
- **收益与代价**：少一个路径变量与一次磁盘 stat。损坏源包会晚到 staging 阶段才报错，并可能先创建空 runtime 父目录；这不是“任何失败均零文件操作”的承诺。
- **实测**：16 项安装 focused 检查通过。额外将临时源包的 hook-cli 删除，安装失败，原受管 runtime 全树哈希相同，没有残留 `.stage-*` 或 `.previous-*`；最终打包后的自重装通过。

## 4. 尝试取消后保留 / 恢复的部分

| 编号与实际移除 | 预期检验 | 实际差异 | 最终决定 |
| --- | --- | --- | --- |
| N1：删除 `effective-search-document.tag_terms`，让候选复用 `search_tags` | 已有字段能否覆盖所有 Registry Tag | `host enrichment improves...` 从通过变为失败：`host-native` 预期存在，实际 undefined | 恢复。`search_tags` 不含 predictive tags；把两者合并又会改变词法 tag boost。当前投影只有内存字段，没有写入 source、canonical text 或索引 identity |
| N2：取消 legacy pair veto，只跳过 related/ambiguous 自己 | 能否仅靠类型过滤约束扩展 | 旧 `GC` alias 在新增歧义关系后仍扩展，size 从预期 0 变成 1 | 恢复。必须约束竞争旧边，不能只阻止新非等价边自己参与扩展 |
| N3：取消 `matches` 的词组包含判断，只留相等判断 | 可否只匹配单词/整条查询 | `why use garbage collector` 在 backend context 下不再得到 gc，期望 0.95，实际 undefined | 恢复词组匹配；仅合并重复归一化 |
| N4：扩展目标仅 `tokenize(term)`，删除空格/连字符形式 | Registry key 能否直接命中旧文档拼写 | `host-native must find host native` 从 1 命中变 0 | 恢复。最终补充验收覆盖反向和混合形式。只保留转换形式而删除 literal 对混合旧词的风险是代码推断，未伪称另做了该负对照 |
| N5：删除向量归一化，直接对 callback 向量做 dot | Local worker 已要求 normalize，消费侧能否不校验 | 受控输入 `[2,0]` 与 `[-3,0]` 返回 -6，预期 cosine -1 | 恢复。最终非法 NaN 向量会降级，精确 fallback 保留 |
| N6：取消 16 条分批，一次调用 worker | 能否复用单次请求省去循环 | 24 Tag + query 的 25 个输入触及既有协议限制；synthetic transport 断言使 active 变 unavailable | 恢复分批。真实 child 的 `inputs.length > 16` 约束也已读到；本轮不是实际 E5 推理 |
| N7：launcher targets 只返回新 primary，不并入旧路径 | 固定一个入口能否覆盖升级兼容 | `upgrade retains the v1.0.0...` 失败，manifest 只余新入口，旧绝对路径消失 | 恢复维护旧路径。旧文件将继续引用旧 runtime 是代码推断；完整升级正向检查实测了两个入口都返回 1.1.0 |
| N8：locator 仅在 pending enrichment > 0 时返回 | 可否恢复较窄的 hook 文本输出条件 | 空 enrichment 的 SessionStart 不再含 Trusted CLI locator，但仍要求 session 控制使用它；focused 检查失败 | 恢复。locator 是 CLI/PATH/adapter 链路的一部分，不能依赖是否有 enrichment |
| N9a：临时 runtime 移除 `package.json` | 包元数据是否运行时必要 | managed `--version` 报 ENOENT | 恢复 |
| N9b：移除 `local-runtime-manifests` | Local 安装计划是否可脱离清单 | `embedding-install-plan` 报对应 JSON 的 ENOENT | 恢复 |
| N9c：移除 `local-model-manifests` | 模型清单是否只是开发资源 | 同一计划报模型 JSON 的 ENOENT | 恢复 |
| N9d：移除 `skills` | 受管 CLI 是否只要 compiled code | managed `install --home TEMP --yes` 报 SKILL.md 不存在 | 恢复。用户要求包缓存消失后仍能执行必要安装功能 |
| N9e：移除 `dist` | 确认受管启动实际执行位置 | 启动报找不到 runtime 下的 cli.js | 恢复 |

资产实验每次 rename 掉一组资产、调用一个判别命令、再恢复，未把一组缺失造成的失败误记到另一组。`LICENSE` 未做删除实验：它不参与候选发现算法，但本仓库许可要求副本保留版权与许可声明，因此保留随 runtime 分发的声明文件。

## 5. 可以取消但本次未取消的部分

只有一个有具体条件的项目：**128-tag 这一具体窗口限制**，不把所有保留功能都泛称为“未来可删”。

- **确实做了实验**：暂时从 `entries.slice(0, 128)` 改为直接处理 `entries`，同一 130-tag fixture 改为断言实际考虑 130 个；受控向量下排序、精确优先与 fallback 检查仍通过，然后恢复。
- **它为什么可取消**：128 不是 Tag Registry / Term Graph 的 schema 要求，也不是 worker 的 16 条单批协议上限。去掉它确实能覆盖此 fixture 的另外两个 Tag。
- **为什么本次保留**：取消后，整个 eligible 集合都会进入每次按需推理；受控数组运算的通过不能说明固定 E5 在真实项目量级、既有进程内存与 30 秒预算内完成。当前错误处理在中途失败时回到精确候选，不会保留部分语义排序，因此失去工作量限制有明确成本风险，但本轮未实测其发生概率。
- **取消前还需的条件**：复用现有固定 Node v24.14.0 / E5 工件，对目标项目范围测量完整集合的成本与发现收益，并确认既有时间/进程限制足够。不能借此再增加一套 Tag cache、索引、配置或服务。本轮没有为该问题下载模型或正式安装环境。
- **当前代价**：频率较低且非精确名称的第 129 项以后可能不被发现。精确名称被提升进窗口；`considered_tags` / `total_tags` 保留，使覆盖范围可解释。未将 128 宣称为校准后的最佳数值。

没有其他已经证明不影响本任务要求、却仅因时间原因推迟删除的项目。

## 6. 其余功能、接口与依赖的必要性审查

下表是代码审查与正向验证，不冒充做过整块删除实验。

| 部分 | 保留理由与边界 |
| --- | --- |
| `suggestTags` 与 `suggestLocalTags` 两层 | 前者复用 Registry/effective documents 做筛选与排序；后者只接已有 Local profile/worker、E5 前缀、分批和关闭。使用现有 embed callback 形状，不另造检索 backend。合并会把 registry 核心强绑到实际 Local 生命周期，当前没有重复候选算法可删 |
| ephemeral Tag 向量 | 连续两次请求均重算，已有测试观测到两组相同批次；省掉重算需持久缓存或将陈旧向量当当前向量，均不比当前方案更小。代价是重复启动/校验/推理，真实成本未测 |
| `embedding-index` 的 normalize/dot 两个导出 | 算法已由文档索引使用，Tag 复用同一实现；没有为 Tag 创建新 math 模块。去掉复用要重复数学代码，或添加一次包装/抽取；未发现副作用或双份算法收益。归一化必要性有 N5 实证；模块耦合评价是代码审查 |
| `readTermRelations` | 同一 reader 供 CLI 检查和 expansion 使用；共享 schema/path 验证，坏图条目被跳过以保留词法可用性；删除它后仍需在两处处理同一职责 |
| `setTermRelation` | 是候选发现 → 明确类型化关系 → 受控扩展的可用写入路径；复用 schema-v1 图、稳定 pair/context ID、现有 evidence assessment 和原子写入。相似度不调用 writer。重复写保持 ID 和 created_at；其他项目证据、NaN confidence、无 context 的 contextual_equivalent 被拒绝 |
| 置信度、context、veto、一跳 | 直接阻止非等价、低置信或缺少上下文的扩展；旧边仍可读。未添加递归遍历、自动 synonym 分类、平行 relation schema 或全局 context 状态 |
| 候选保留字段 | `tag` 是关系目标；`semantic_similarity` 解释排序但不等于关系置信度；`evidence_refs` 支持检查与 writer；project/query 可定位一次发现；status 区分推理是否使用/失败；两个计数说明有限覆盖。删除它们会减少可解释性 |
| 五个 Tag CLI 子命令 | list 只读检查旧 Registry；rebuild 显式重建缺失/损坏的派生文件；suggest 发现；relate 写图；relations 检查已保存关系。没有增加旧 `term-add`/`tags-rebuild` 旁路或自动写图命令 |
| Registry 既有 aliases/related_terms/示例等字段 | 本轮兼容读取、不重新解释为 typed relation、不存向量；贸然删字段会超出新候选接口消融范围，并影响旧数据 |
| lexical/BM25-like 与 document hybrid | 继续使用原 effective documents、tokenizer、lexical exact 优先及 confidence 边界；无另一套检索索引。非等价图只限制 term expansion，不否决已有文档级 semantic candidates |
| CLI 安装防护 | 固定 POSIX 主入口；旧入口只在受管所有权验证后维护；Windows 分支保留。源文件重复预检可删，launcher/目标所有权与 staged 检查有不同职责，不能一并删除 |
| 包依赖、配置、迁移 | 没有新生产 npm 依赖或新增 Local 工件。复用现有 50-package 固定 Local runtime 清单；Embedding 配置仍为已有键、默认 off。不需要新增迁移 |

## 7. 消融前后的规模

代码行采用物理行，含空行/注释。生产范围是 `src/**/*.ts`，排除 `*.test.ts` 和 `src/dev/**`；测试范围是全部 `src/**/*.test.ts`。这不是复杂度分数。

| 指标 | v1.0.0 基线 | 原候选 d4199dc | 最终实现 e966cff / 本报告 |
| --- | ---: | ---: | ---: |
| 生产 TS 文件 | 61 | 61 | 61 |
| 生产 TS 物理行 | 8,334 | 8,527 | 8,519 |
| 相对 v1.0.0 生产 diff | — | +244 / -51；净 +193 | +236 / -51；净 +185 |
| 测试 TS 文件 | 81 | 81 | 81 |
| 测试 TS 物理行 | 3,572 | 3,718 | 3,822 |
| 仓库 tracked 文件 | 177 | 178 | 179（含本报告） |
| 相对 v1.0.0 变动文件 | — | 26 | 29（含本报告） |
| 新增生产模块 / 依赖 | — | 0 / 0 | 0 / 0 |
| 新增配置键 / 迁移 | — | 0 / 0 | 0 / 0 |
| 新候选字段数（每项） | — | 4 | 3 |
| 新建议响应字段数 | — | 7（含可选 reason） | 6 |
| 本功能新增公开导出名字 | — | 8（4 新函数、2 新接口、2 既有 helper 的公开导出） | 7（TagCandidate 改私有） |
| Tag CLI 子命令 | — | 5 | 5 |

相对 d4199dc，本轮只修改 **4 个生产文件，+18/-26，净 -8**；5 个既有测试文件 **+108/-4，净 +104**。测试增加用于补上预测 Tag、精确优先、128 覆盖、数学输入、混合拼写、旧图与实际 Local 适配层的判别盲点；没有新测试模块或评测框架。全量通过数从交接记录的 212 变成此次实测的 215。

没有删除完整生产文件：原候选没有新增可整体移除的生产模块；直接删除现有文件会牵连 v1.0.0 职责。唯一新 tracked 文件为用户要求的本报告；`DEVELOPMENT.md` 更新为紧凑摘要。

声明依赖仍为 0 个生产依赖、2 个 devDependencies，lockfile 中解析的 3 个开发包不变。没有向量数据库、云 API、新模型、常驻服务、平行检索系统、wrapper 层或影子持久状态。

## 8. 最终验证、打包与升级

### 8.1 有界回归

使用已有 lockfile 对应的缓存依赖执行等价于 package test 脚本的命令，直接调用编译器以避免环境中的 pnpm 包装器进行额外 registry policy 查询：

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test --test-reporter=spec dist/*.test.js dist/local/*.test.js dist/dev/eval/*.test.js
node scripts/package-smoke.mjs
node scripts/validate-skill.mjs
node scripts/scan-tracked-secrets.mjs
node scripts/release-readiness.mjs
git diff --check
```

最终测试：215 tests、215 pass、0 fail、0 skipped，耗时 6,169.604 ms。包括现有安装、adapter、legacy compatibility、effective document、hybrid、integrity 和 eval 工具本身的单元测试；没有运行庞大评测语料。编译、Skill 验证、secret scan、metadata 和 whitespace 检查通过。

CLI help 实际检查过，仍明确 Local 可选、typed relations、context、默认 off 与固定 launcher；README 中英文版、配置说明、Changelog、升级说明和安装协议与最终响应一致。

`release-readiness` 是本地只读元数据检查，输出的 ready 标志不代表获准发布，本任务也没有执行发布步骤。

### 8.2 实际 npm 临时安装

`scripts/package-smoke.mjs` 实测结果：

- `npm pack --ignore-scripts` 得到 `linger-skill-1.1.0.tgz`，随后 `npm install --offline --ignore-scripts --no-audit --no-fund` 到临时 consumer。
- 两个 npm binary：`linger`、`linger-skill` 均能报告 1.1.0。
- 删除 consumer 的整个 node_modules 后，受管 `--version`、Local install-plan、安装到同一临时 HOME 仍工作。
- 只设置临时 user bin 的新 shell 可以运行裸 `linger --version`；capture → process → recall 成功；uninstall 保留 Vault。
- 14 个必需文件在包内，0 个 forbidden development/test/eval 文件；Claude capability L2、未建立信任的 Codex L1 符合既有边界。
- consumer、HOME、npm cache 和压缩包均位于临时目录，运行后清理；没有全局 npm 或本机 Linger 安装。

### 8.3 独立真实基线升级与资产消融

从 Git archive 导出 `d56ea22`，链接缓存开发依赖并编译，在临时 HOME、`/usr/bin:/bin` PATH 下安装。**没有使用交接任务的临时包来代替本轮验证。**

实测基线根因：安装选择 `.linger/bin/linger`；受管 `--version` 打开 `runtime/1.0.0/package.json` 时报 ENOENT；`embedding-install-plan` 读取 `local-runtime-manifests/...json` 时报 ENOENT。即使 Node 启动器可执行，包数据依赖不完整仍会失败。

然后用基线 packaged CLI 创建一个 durable memory、处理为 JSON/Markdown，保存旧 Registry 的 alias/related_terms 和一个旧 schema-v1 abbreviation 图文件，并将既有 `embedding.desired_enabled` 设为 true。使用本轮编译候选升级相同临时 HOME 后：

| 验证 | 实测 |
| --- | --- |
| 新 `.local/bin/linger` 与旧 `.linger/bin/linger` | 两者均返回 1.1.0 |
| 删除原 v1.0.0 package 后 | 两入口继续可用；新 shell 裸命令可用 |
| 旧 record 召回 | 已知词命中 1 个记录；`db` 经旧图扩展得到 possible_match 与 term_expansion |
| Raw / Processed | 1 个 Raw 文件、2 个 Processed 文件（JSON + Markdown）的 SHA-256 前后相同 |
| Tag Registry / Term Graph | 原 JSON 字节完全相同；旧 ID、aliases、related_terms 保留；CLI 能读取 |
| 配置 | 原 embedding intent = true 保留；缺少 Local profile 时正常词法退化 |
| 不完整 staging | 删除待安装源副本的 hook-cli 后拒绝替换，旧 runtime 全树哈希相同，无 staging 残留 |

v0.2.x 的 manifest/managed marker、缺少 `cli_launchers` 等路径由已有 legacy fixtures 和最终回归覆盖；本轮没有可用 v0.2.2 原始发布包，因此没有把 fixtures 说成真实 v0.2.2 二进制升级。

## 9. 剩余限制与后续审查结论

1. **模型质量未验证**：检查的正式 runtime、缓存、主线/原候选工作区和常见临时工件位置中，未找到可复用的固定 Node v24.14.0 / E5 runtime。没有下载替代模型，没有伪造 profile 来宣称真实模型通过。测试中明确标注的 synthetic transport fixture 只用于调用链验证。
2. **规模与时间未校准**：128 是工作窗口；30 秒是已有分批调用预算，前置 effective-document 读取和 runtime 文件校验不是完整端到端硬时限。没有吞吐、内存峰值或 Tag 召回率结论。现有 effective-document 的文件预算继续适用，并未因 cap 消融扩成无限读取。
3. **文本匹配有范围**：本轮实测空格、连字符、大小写和指定多词用例；没有声称覆盖所有 Unicode、标点或自然语言词组边界。未用新的 tokenizer 或全局同义字典扩大范围。
4. **关系语义由审阅承担**：高 cosine 不产生 synonym；项目证据校验不证明语义正确；legacy evidence 按既有读取契约保留，没有重新判定全部旧关系。非等价关系只限制受控词法扩展，不屏蔽已有 hybrid 的所有相近文档。
5. **安装平台边界**：本轮真实执行在 macOS arm64 / Node 26；Windows 保留原分支并经过现有命令构造测试，没有真实 Windows 安装结果。launcher 绑定的 Node 若被用户移除，仍需重跑安装器；该行为已有文档说明。

交给最终审查的对象是分支 `codex/linger-v1.1.0-ablation`，实现提交 `e966cffdf864bc9d24723e10de2c44624bc059e1` 及其报告提交。核心路径保持可用：**当前合格 Tag → 可选 Local 候选 → 查看证据 → 显式类型化关系 → 项目/context/置信度/否决约束下的一跳扩展**。

本轮没有留下已确认可以无损删除、却未完成的实现工作。可以继续讨论 128 具体数值的条件性取消，但这需要固定工件的实测，不能从受控向量通过推出。不得把这份报告当成真实 E5 质量背书或发布批准。

截至交付，未 push、publish、创建 tag/release、更新 GitHub、正式安装/升级本机、创建发布自动化或另开任务；停止在可复查的本地候选状态。
