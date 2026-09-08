# 安全同步与多源配置

这份说明适用于 0.5.0 起的 schemaVersion 2 配置。旧配置、Ai4Scholar 命令和绘图配置继续保留。

## 配置与迁移

从 `pi-scholar.config.example.json` 复制配置，明确启用所需来源。`research.providers` 管理最终确定的文献来源；`data.providers.materials-project` 与 `data.providers.cas-common-chemistry` 分别管理材料和化学物质数据。新来源只接受 `credentialEnv` 等环境变量引用，不能在这些配置段内填写明文密钥或自定义凭据发送地址。旧版 `media` 配置保持原有兼容行为。

`/pi-scholar setup-sources` 可交互选择来源和凭据环境变量名，预览后生成独立配置候选。它不自动切换活动配置，也不测试远端账户。`/pi-scholar status` 显示配置状态；详细能力和权限限制以 `research_sources` 返回值为准。`enabled`、凭据存在、接口已实现、账户有权限和真实联调通过是不同状态。

旧配置使用 `/pi-scholar config-migrate`。预览只读取文件；确认后创建 `.v2.json` 候选及逐字节验证的原文备份，保留当前配置。检查候选后通过 `PI_SCHOLAR_CONFIG` 选择它。再次执行不会覆盖已存在的不同候选；配置在预览后变化时必须重新预览。未配置的新来源不会因迁移而自动打开。

默认不允许付费回退、不允许外部全文上传。显式选择收费来源并不代表费用已知；预算只约束本客户端观测到的请求，不能代表共享凭据的账户总量。Ai4Scholar 保持为可显式调用的独立服务，不会被删除，也不会因为其他来源失败而自动调用。easyScholar 仅接入已核验的 `getPublicationRank` 期刊等级接口并要求 SecretKey。CAS Common Chemistry 在缺少账户专属接口契约时保持阻断，不虚构端点，也不扩展为 SciFinder 文献或反应检索。

## 本地同步

先查询 `pi_scholar_sync` 的状态或计划，检查文件修改、缺失、缓存、拟写路径及远端调用。按工具 schema 传入操作参数。`pi_scholar_parse` 保留兼容入口，实际调用进入安全同步流程。

- 输入未变时使用现有结果；元数据刷新不应重新上传 PDF。
- 整目录缺失默认跳过，恢复需要明确选择 `restore`；缓存不足时再决定是否授权解析。
- `exclude` 持久化排除；`unexclude` 只取消排除，不表示下载。
- `repair` 只处理确认的缺失产物；正文、YAML、自建文件和额外图片的修改需要保护或冲突审查。
- `recovery_required` 表示先处理未完成事务。来源离线或 vault 不可访问不表示用户删除了内容。

`sync.namespace` 可为 Zotero 配置档案指定稳定的独立命名空间。更换本地 Zotero 库时使用不同命名空间，避免相同条目 key 混淆。`sync.cacheDir` 默认为用户目录下 `.cache/pi-scholar/parse`；`backupRetentionDays` 默认 30 天。多个设备同时写同一 vault 不受支持；保留恢复副本直到事务安全得到确认。

MinerU 请求模型名称不等于服务端不可变构建版本；未返回解析器修订时保持未知。创建或上传结果不确定时返回 `AMBIGUOUS_SUBMISSION`，禁止自动重发。参见 [MinerU 契约](MINERU_CONTRACT.md)。

## 文献、材料与化学物质工作流

先选择来源和有界检索，再按可靠标识符取详情。引用、参考文献和推荐分别调用；引用计数不能跨来源相加。全文链接解析、下载、保存、外部上传是独立权限。

Materials Project 使用用户自己的 key。先有界筛选摘要和性质可用性，再按 ID 取数；区分包含元素与确切元素体系，保留单位、计算方法、任务和版本。`materials_export` 导出已取得的数据，不隐式下载数据库。完整能带、DOS 等对象与元数据是不同能力，按运行时矩阵判断。

CAS Common Chemistry 记录保持独立的化学物质模型，只用于名称、CAS RN、结构表示和基本性质。API 访问需要遵循 CAS 提供给账户的接入资料和许可证；没有已核验契约时，运行时只报告阻断原因，不猜测端点或认证方式。

验收执行 `npm test`、`npm run check`、`npm run pack:check`。默认测试使用合成数据和模拟服务，不上传真实 PDF；`mock_passed` 不能表述成真实账户联调通过。具体完成度与限制见实施报告及各来源契约说明。

Live smoke test 默认只打印来源、凭据状态、权限未知项、请求上限和费用状态，不联网：`npm run test:live -- <source>`。只有同时设置 `PI_SCHOLAR_LIVE_TEST=1` 并追加 `execute` 才会发出一次有界请求，例如 `npm run test:live -- crossref "test query" execute`。Unpaywall 的 query 应为 DOI，easyScholar 应为期刊名，Materials Project 应为化学式；CAS 在契约不足时返回明确阻断状态。执行前仍需确认来源条款与账户权限。
