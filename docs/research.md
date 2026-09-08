# 文献与科研数据接入

`src/research` 只承载以下文献服务：Semantic Scholar、OpenAlex、PubMed/PMC、arXiv、Crossref、Unpaywall，以及 easyScholar 的期刊等级 endpoint。每个记录统一为 `LiteratureRecord`，保留来源、原始标识符、获取时间、许可和原始响应。

| 来源 | 能力 | 边界 |
| --- | --- | --- |
| Semantic Scholar | 检索、详情、参考文献、引用、相关推荐 | Graph API 能力和配额以账户权限为准 |
| OpenAlex | 检索、结构化筛选、详情、作者/机构、参考文献与引用关系 | key 只用于可选配额提升 |
| PubMed / PMC | PubMed 检索/详情/关联；PMC OA 许可检查、解析与 XML 获取 | 只有 OA 服务明确给出许可时才获取全文 |
| arXiv | Atom 检索、版本保留、详情、摘要与原文 PDF 定位/获取 | 遵守官方请求间隔；不推断同行评审状态 |
| Crossref | DOI 检索/详情、字段补全、参考文献及更新/撤稿关系原文保留 | 元数据不等于全文授权 |
| Unpaywall | 按 DOI 查询 OA 状态、版本、许可和全文位置 | 只解析位置，不代替许可检查或下载 |
| easyScholar | 期刊等级与分区增强（`getPublicationRank`） | 需要 `SecretKey`；仅声明该 endpoint 能力，不扩展会员产品能力 |

现有 `ai4scholar_*` 服务和工具完整保留，继续承担用户显式选择的 Google Scholar、专利、数据集、期刊和高级工作流；它不进入上述第一方 registry，也不会在其他来源失败时自动调用或扣费。

CAS Common Chemistry 是独立的 `src/chemistry` 数据边界，使用 `ChemicalRecord`，不注册为文献来源。当前 API 访问与 endpoint 契约需向 CAS 申请，客户端保持 `contract_blocked` / `permission_required`，不猜测接口；范围仅限名称、CAS RN、结构和基本信息，不扩展为文献、反应或 SciFinder 检索。

## 工具与安全

`research_sources` 只读列出状态，不联网。`literature_search`、`literature_get`、`literature_graph`、`journal_metrics` 和 `literature_fulltext` 都要求来源能力真实存在；全文 `resolve` 与 `fetch` 分开。

`chemical_sources`、`chemical_search` 和 `chemical_get` 属于独立化学数据工具；它们读取 `data.providers["cas-common-chemistry"]`，当前契约阻断时不会发起请求。

请求仅允许官方 HTTPS 主机。需要密钥的来源可直接使用 `apiKey`，也可用 `apiKeyEnv` 或标准环境变量；Unpaywall 联系邮箱通过 `research.contact` 或 provider 的 `contact` 提供。URL、诊断和工具输出都会脱敏。GET 使用有界重试并遵守 `Retry-After`，POST 默认不重试；请求超时、请求数、页数和响应体大小均有上限。

## 配置示例

```json
{
  "schemaVersion": 3,
  "research": {
    "policy": { "allowPaidFallback": false, "allowExternalFulltextUpload": false },
    "contact": "you@example.org",
    "providers": {
      "semantic-scholar": { "enabled": true, "apiKeyEnv": "SEMANTIC_SCHOLAR_API_KEY" },
      "openalex": { "enabled": true, "apiKeyEnv": "OPENALEX_API_KEY" },
      "pubmed": { "enabled": true, "apiKeyEnv": "NCBI_API_KEY" },
      "arxiv": { "enabled": true },
      "crossref": { "enabled": true },
      "unpaywall": { "enabled": true },
      "easyscholar": { "enabled": false, "apiKeyEnv": "EASYSCHOLAR_SECRET_KEY" }
    }
  }
}
```

上例使用环境变量，也可以把 `apiKeyEnv` 换成直接 `apiKey`。Semantic Scholar、OpenAlex 和 PubMed 的 key 可选；easyScholar 的 SecretKey 必需。缺少联系邮箱时，Unpaywall 请求会在执行前明确失败。

## 官方契约

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities 与 PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar 期刊等级接口](https://www.easyscholar.cc/open/getPublicationRank)
- [CAS Common Chemistry API](https://www.cas.org/services/commonchemistry-api)

## 生产验收

2026-09-08 的有界实测通过了 Semantic Scholar、OpenAlex、arXiv、Crossref、Unpaywall、easyScholar 和 Materials Project。PubMed/PMC 在本机于 TLS/DNS 建连阶段失败，没有收到 NCBI HTTP 响应；其适配器仍通过模拟契约测试，未改用非官方端点。CAS 因公开契约不足继续在联网前阻断。运行时不会把这次验收永久等同于其他用户账户的权限或配额。
