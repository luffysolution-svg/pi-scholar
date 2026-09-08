# Pi Scholar 最终功能改造实施报告

日期：2026-09-08。本文记录 0.5.0 生产版本的实现与验收状态。运行时状态仍区分实现、凭据、账户权限与 live 验证。

## 最终来源范围

| 服务 | 当前状态 | 凭据与权限 | 已实现边界 |
|---|---|---|---|
| Semantic Scholar | `implemented / live_passed` | 基本访问不强制 key；key 可选 | 默认主检索、详情、参考文献、引用、推荐 |
| OpenAlex | `implemented / live_passed` | 基本访问不强制 key；key 可选 | 补充检索、年份/OA 筛选、详情、作者/机构、引用关系；保留服务返回的请求费用 |
| PubMed / PMC | `implemented / mock_passed` | NCBI key 可选；本机到 NCBI 的 TLS/DNS 连接失败 | PubMed 检索、详情、PMID/PMCID/DOI 关联、引用关系；PMC 仅在 OA 服务返回明确许可后解析/获取 XML |
| arXiv | `implemented / live_passed` | 无 key | Atom 检索、直接 ID 查询、版本、摘要、原文定位与有界 PDF 获取 |
| Crossref | `implemented / live_passed` | 无 key；可配置联系信息 | DOI 校验、检索/详情、字段补全、参考文献，保留 `update-to` 与 relation 供撤稿/发表后更新检查 |
| Unpaywall | `implemented / live_passed` | REST v2 要求联系邮箱，不是 API key | DOI 查询、OA location、版本、host type 与许可；只解析位置，不提供搜索或下载 |
| easyScholar | `implemented / live_passed` | `EASYSCHOLAR_SECRET_KEY` 必需 | 已核验并接入 `getPublicationRank`；只声明期刊等级与分区能力 |
| Materials Project | `implemented + partial / core_live_passed` | `MP_API_KEY` 必需 | 独立 `MaterialRecord`；筛选、结构、性质、计算来源、多路由合并、安全导出和 MP01–MP17 能力矩阵 |
| CAS Common Chemistry | `contract_blocked / permission_required` | CAS 公开页要求申请接入资料 | 独立 `ChemicalRecord` 与状态/查询工具边界；未猜测端点或认证，未扩展成 SciFinder 文献/反应检索 |
| Ai4Scholar | 保留且兼容 | 现有显式配置与积分规则 | 原有服务、命令、工具和测试均保留；不进入第一方 registry，不是必需依赖或自动付费兜底 |

第一方文献 registry 已拒绝 Elsevier/Scopus、Springer、Web of Science、Wiley、Ai4Scholar 和 CAS 文献别名。未指定来源的检索只使用最高优先级的 Semantic Scholar；补充来源由调用方明确选择。

Materials Project 矩阵以 [`materials-capabilities.md`](./materials-capabilities.md) 为准：MP01–MP04、MP13、MP16 已实现；MP05–MP12、MP14–MP15 为受字段/解释边界约束的 partial；MP17 为 planned。CAS 的阻断依据和后续接入条件见 [`chemistry.md`](./chemistry.md)。

## 安全同步交付

- 持久 manifest、稳定 publication identity、库 namespace、父条目与附件隔离；同一 Zotero 条目的多个 PDF 不会互相覆盖。
- `new / up_to_date / metadata_changed / parse_changed / render_changed / incomplete / missing / excluded / conflict / source_unavailable / recovery_required` 状态和 plan/apply 陈旧计划校验。
- 整目录缺失默认跳过；`exclude`、`unexclude`、`restore`、`repair` 分离。元数据独立刷新复用已有解析，不读取或上传 PDF。
- 解析缓存按 PDF、解析选项、namespace 与授权域校验，原子写入；进程内任务合并和跨进程 lease 防止同目标重复提交。
- 发布事务使用持久 journal、阶段校验、原版本备份、manifest commit 与幂等恢复。无法证明结果时保留新旧两版并报告 `recovery_required`。
- 三方更新保护正文、未知 YAML、用户笔记和额外资源；无法安全合并时保留本地内容并生成候选，不覆盖用户版本。
- MinerU 的任务创建/上传出现不确定结果时返回 `AMBIGUOUS_SUBMISSION`，不自动重发；整体 deadline 覆盖请求、轮询和响应体读取。
- SVG/XML、Markdown 内 HTML、压缩包与资源路径按不可信输入处理；网络响应、工具输出和错误信息均有限额并脱敏。

## 配置与操作

- `schemaVersion: 2` 统一承载 `research`、`data` 与 `sync`；新来源只保存环境变量名，不接受明文 key 或自定义凭据目标。
- `/pi-scholar setup-sources` 只生成待审核候选，不覆盖活动配置、不联网；`config-migrate` 保留原文件并创建逐字节验证备份和独立 v2 候选。
- `/pi-scholar status`、`research_sources`、`materials_capabilities` 和 `chemical_sources` 都是无网络状态检查。
- `npm run test:live -- <source>` 默认只打印预览。只有同时设置 `PI_SCHOLAR_LIVE_TEST=1` 并追加 `execute` 才发送一次有界请求。

## 验证结果与已知边界

- `npm test`：完整测试套件通过，0 失败。覆盖合成/模拟服务、失败注入、发布阶段进程退出、恢复幂等、缓存、并发、输出保护、来源 schema 和 Ai4Scholar 兼容。
- `npm run check`：TypeScript 静态检查通过。
- `npm run pack:check`：npm 打包内容校验通过，必需代码、SKILL 与中英文文档均包含在包内。

2026-09-08 使用用户提供的凭据完成了 Semantic Scholar、OpenAlex、arXiv、Crossref、Unpaywall、easyScholar 和 Materials Project 的有界实测；详情、引用关系、OA 定位、arXiv PDF、材料属性合并与本地导出均通过。PubMed/PMC 在本机于 TLS/DNS 建连前失败，未收到 NCBI HTTP 响应，因此保留为 `mock_passed`，不改写官方端点。CAS Common Chemistry 的公开资料仍不足以确定账户专属主机、认证头和 schema，继续在联网前明确阻断。Ai4Scholar 未提供本轮凭据，但原服务、注册与模拟调用均已验证保留。
