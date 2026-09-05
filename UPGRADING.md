# Upgrading Linger

## v1.0.0 → v1.1.0 candidate

v1.1.0 is not published by this development task. After final review and release approval, the upgrade entry will be
`npx linger-skill@1.1.0 install --yes` (or update the global npm package first). For local candidate verification, build and
pack this checkout and install only into a temporary `--home` / `--vault`; do not use the production HOME.

- No Vault/config/raw/processed/Tag/Term Graph migration. Existing Local intent/profile/indexes are preserved. Tag
  suggestions reuse the selected Local profile and need no index rebuild. Missing/corrupt Tag registries can be explicitly
  regenerated with `tags rebuild --project ID`; old source records are unchanged.
- POSIX installs use `~/.local/bin/linger` regardless of install-time PATH. Previously advertised managed launchers are
  refreshed, and v0.2.x manifests without launchers gain the new entry. Add `$HOME/.local/bin` to PATH or invoke the reported
  absolute path. Windows retains `~/.linger/bin/linger.cmd`. The installer does not change shell profiles.
- The managed runtime now contains its CLI data dependencies, so `--version`, Local install-plan, and reinstall survive
  removal of the package cache. Hooks supply their trusted locator even when enrichment is empty.
- New `tags` commands expose the existing registries. `related`/`ambiguous` no longer authorize query expansion;
  `contextual_equivalent` requires explicit matching `--context`. Existing records remain readable without rewriting.
  Other confident curated mappings retain bidirectional, one-hop expansion with lexical confidence protection.
- Disabling embedding stops candidate inference and document semantics; already curated relations still work lexically.
  No new provider, credentials, setting, model, or dependency is introduced.
- The new Tag suggestion output uses status/coverage plus candidate names, optional cosine and a bounded evidence sample.
  Existing Registry and Term Graph files are unchanged; no candidate-output migration is needed.

After an approved upgrade, verify `linger --version`, `linger embedding-install-plan`, `linger tags list --project ID`,
and a known old-record recall. A new hook installation still needs observed lifecycle events to demonstrate capture health.

An integration rollback uses the preserved Vault and an older published installer; never use `purge`. v1.0.0 can read the
schema-v1 relations but applies its older, broader `related` expansion semantics. Preserve newer evidence before any backup
restore. v1.0.0 also has the incomplete managed-runtime issue; invoke its packaged CLI via npx for package-dependent commands.

## v1.0.0 → v1.1.0 候选

本任务不发布 v1.1.0。最终审查与发布批准后，升级入口为 `npx linger-skill@1.1.0 install --yes`；本地验证只将
当前工作区 build/pack 后安装到临时 `--home` / `--vault`，不使用正式 HOME。

无 Vault、配置、Raw、Processed、Tag 或 Term Graph 迁移；保留已有 Local 启用意图、profile 与文档索引。
Tag 候选不需要文档索引重建；必要时显式 `tags rebuild --project ID` 重建派生 Registry。
POSIX 入口固定为 `~/.local/bin/linger`，同时刷新旧受管入口；Windows 路径不变。目录不在 PATH 时直接用绝对路径
或自行配置 PATH，安装器不会改 shell profile。受管 runtime 补齐包资源，删除包缓存后版本、安装计划、重装仍可用。

新增 `tags` 命令；相关与歧义关系不再用于词法扩展，上下文等价必须显式匹配 `--context`。旧关系只兼容读取，
不批量改写。关闭 embedding 后，已整理关系仍可用于词法召回；没有新增 provider、凭据、配置、模型或依赖。
新 Tag 候选输出包含状态、覆盖计数、名称、可选余弦值和有界证据样本；不改变 Registry/Term Graph 文件，无需迁移。
升级后的验证与回退按上面的说明执行。回退 v1.0.0 会恢复它较宽的 related 扩展行为以及已知受管 runtime 限制。

---

# Upgrading Linger from v0.2.2 to v1.0.0 (historical)

[简体中文](#从-v022-升级到-v100)

Linger v1 reads the existing file-native Vault in place. It does not batch-rewrite Raw evidence, Processed memory,
Decision events, enrichment overlays, or historical Markdown during installation.

## Before upgrading

- Use Node.js 22, 24, or 26. Node 20 is no longer supported by the base v1 CLI.
- Finish any important active conversation before replacing hooks.
- A Vault backup is recommended even though the installer does not migrate source records.
- Local Embedding remains off after upgrade. Its model/runtime are not bundled in the npm package.

Example backup:

```sh
cp -R ~/.linger/vault ~/.linger/vault-backup-before-v1
```

## Upgrade

```sh
npx linger-skill@1.0.0 install --yes
```

Select one adapter only when needed:

```sh
npx linger-skill@1.0.0 install --adapters claude-code --yes
npx linger-skill@1.0.0 install --adapters codex --yes
```

The installer reports the exact stable CLI path and whether bare `linger` is currently reachable. It does not edit shell
profiles. Use the reported absolute path when its directory is not on `PATH`.

## Verify

```sh
linger project-id --cwd .
linger status --cwd .
linger doctor
```

A newly replaced adapter may remain `unknown` or `degraded` until a real lifecycle event is observed. Installed files alone
are not proof of healthy capture.

For Local Embedding, review the plan first and opt in explicitly:

```sh
linger embedding-install-plan
linger embedding-status --project PROJECT_ID
```

Do not enable or rebuild Local Embedding unless the documented Darwin/arm64 profile applies. Lexical recall remains the
default and fallback.

## Compatibility

v1 reads existing schema-v1 Raw, Processed, Queue, Pending, Decision, Memory Control, Project, Registry, Config, enrichment,
and Markdown content. It also understands manifest-owned v0.2.x Skill paths and ownership markers.

- An old same-root project ID is reused instead of silently creating a second project.
- A legacy Processed record without `source_hash` remains searchable with `unverified_source` provenance degradation.
- A present but incorrect source hash still fails closed.
- Derived indexes may require an explicit rebuild when their runtime or content identity changes.
- Uninstall preserves the Vault and host-owned memory.
- Linger never automatically merges two project identities that already contain data.

## Removed or narrowed surfaces

- Node 20 support was removed; Node 26 support was added.
- `linger-eval` is no longer a public package binary. Evaluation remains repository-only.
- Recall-sampling write commands and undocumented `term-add` / `tags-rebuild` maintenance commands are not part of the v1
  public CLI.
- API/Remote Embedding does not exist in v1. Local Embedding never needs an embedding API key.
- The installer no longer writes duplicate `active.json` state.

## Roll back the integration

Rollback is an installer/runtime rollback, not a destructive Vault migration:

```sh
npx linger-skill@1.0.0 uninstall --yes
npx linger-skill@0.2.2 install --yes
```

The v1 uninstall preserves `~/.linger/vault`. v0.2.2 may ignore v1-derived settings, lifecycle evidence, and Local indexes;
do not delete those files merely to make the older integration run. Restore the pre-upgrade backup only after separately
preserving the current Vault and confirming that newer evidence can be discarded.

Never use `purge` as an upgrade or rollback step. `purge` permanently removes Linger state and has a separate double-confirmation contract.

---

# 从 v0.2.2 升级到 v1.0.0

Linger v1 会原地读取既有 file-native Vault。安装过程不会批量改写 Raw、Processed、Decision、enrichment overlay
或历史 Markdown。

## 升级前

- 使用 Node.js 22、24 或 26；基础 v1 CLI 不再支持 Node 20；
- 替换 Hook 前结束重要的活动对话；
- 安装器虽然不迁移源记录，仍建议先备份 Vault；
- 升级后 Local Embedding 保持关闭，模型和 runtime 不包含在 npm 包中。

备份示例：

```sh
cp -R ~/.linger/vault ~/.linger/vault-backup-before-v1
```

## 执行升级

```sh
npx linger-skill@1.0.0 install --yes
```

只安装一个 adapter 时：

```sh
npx linger-skill@1.0.0 install --adapters claude-code --yes
npx linger-skill@1.0.0 install --adapters codex --yes
```

安装器会返回 stable CLI 的绝对路径及裸 `linger` 当前是否可达，但不会修改 shell profile。目录未进入 `PATH`
时，直接使用返回的绝对路径。

## 验证

```sh
linger project-id --cwd .
linger status --cwd .
linger doctor
```

刚替换的 adapter 在真实 lifecycle event 出现前可能显示 `unknown` 或 `degraded`；安装文件存在不等于 capture 健康。

Local Embedding 必须先查看计划，再显式选择：

```sh
linger embedding-install-plan
linger embedding-status --project PROJECT_ID
```

只有文档冻结的 Darwin/arm64 profile 才能启用或重建；lexical recall 始终是默认路径和故障回退。

## 兼容范围

v1 原地读取 schema-v1 Raw、Processed、Queue、Pending、Decision、Memory Control、Project、Registry、Config、
enrichment 和 Markdown，也兼容 manifest-owned v0.2.x Skill 路径与 ownership marker。

- 同一 root 的旧 project ID 会被复用，不静默创建第二个项目；
- 缺少 `source_hash` 的旧 Processed 仍可检索，但标记 `unverified_source`；
- 已存在但错误的 source hash 继续 fail-closed；
- runtime/content identity 变化时，派生 index 可能需要显式重建；
- uninstall 保留 Vault 和宿主自有 memory；
- 两个都已经有数据的 project identity 不会被自动合并。

## 移除或收窄的表面

- 移除 Node 20 支持，新增 Node 26 支持；
- `linger-eval` 不再是 public package binary，评测只留在仓库开发层；
- recall sampling 写命令和未文档化的 `term-add` / `tags-rebuild` 不再属于 v1 public CLI；
- v1 没有 API/Remote Embedding，也不需要 embedding API key；
- installer 不再写入重复的 `active.json`。

## 回退集成

回退只替换 installer/runtime，不是破坏性 Vault 降级：

```sh
npx linger-skill@1.0.0 uninstall --yes
npx linger-skill@0.2.2 install --yes
```

v1 uninstall 会保留 `~/.linger/vault`。v0.2.2 可能忽略 v1 settings、lifecycle evidence 与 Local index；不要为了
运行旧集成而删除这些文件。只有先单独保存当前 Vault，并明确确认可放弃升级后的新证据，才考虑恢复升级前备份。

不要把 `purge` 用作升级或回退步骤。`purge` 会永久删除 Linger 状态，属于单独的双重确认操作。
