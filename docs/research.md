# 文献数据源与检索

Pi Scholar 内置了学术文献检索层，聚合了多个主流学术开放接口与检索服务。查询到的文献记录统一格式化，并完整保留原始标识符、引用关系、许可协议及原始数据。

## 支持的数据源

| 数据源 | 核心能力 | 配置说明与使用建议 |
|---|---|---|
| **Semantic Scholar** | 论文搜索、文献详情、引用/被引网络、相关论文推荐 | 免 Key 可用；配置 API Key 可获得更高的并发与每日请求额度 |
| **OpenAlex** | 机构/学者检索、多维结构化筛选、文献关系图谱 | 完全开放数据源，无需 Key 即可使用全部功能 |
| **PubMed / PMC** | 生物医药文献检索，定位与获取 PMC 开放获取（OA）全文 | 检索免 Key；配置 NCBI Key 可提升速率限制；支持获取符合 OA 协议的全文 |
| **arXiv** | 计算机、物理、数学等预印本检索，直接获取最新版本 PDF | 免 Key；支持解析并下载对应版本号的原版 PDF |
| **Crossref** | 权威 DOI 元数据反查、更新记录、勘误与撤稿标记 | 适合根据 DOI 补全出版年份、卷期、页码等标准出版信息 |
| **Unpaywall** | 根据 DOI 检索合法免费的开放获取全文下载地址与许可协议 | 需要在配置中提供有效的联系邮箱（`contact`） |
| **easyScholar** | 期刊等级与 JCR / 中科院分区快速查询 | 需要在配置中提供 easyScholar 的 `SecretKey` |

### 独立补充服务

- **Ai4Scholar**：包含 Google Scholar 检索、专利查询、学术数据集检索及高级工作流。这是一组独立的显式调用工具（以 `ai4scholar_*` 命名），不会在普通检索未命中时自动调用，确保费用透明可控。
- **CAS Common Chemistry**：化学物质名称、CAS 号与结构式查询，属于独立化学数据模块，详情见 [CAS Common Chemistry 说明](./chemistry.md)。

## 工具集与操作说明

文献模块向 Pi 注册了以下工具：

- `research_sources`：离线查看各数据源的启用状态、已配置凭据与接口能力。
- `literature_search`：在已启用的数据源中检索论文，支持限制年份、关键词以及筛选仅开放获取（OA）。
- `literature_get`：根据特定数据源的 ID（如 DOI、arXiv ID、PMID 等）获取详细元数据。
- `literature_graph`：获取指定论文的参考文献（`references`）、施引文献（`citations`）或相关推荐（`recommendations`）。
- `journal_metrics`：查询期刊指标与分区信息（主要由 easyScholar 提供）。
- `literature_fulltext`：处理全文资源。支持两种操作：
  - `action: "resolve"`：解析合法的全文下载地址与许可信息；
  - `action: "fetch"`：直接下载并本地缓存全文文件（如 arXiv PDF）。

## 配置示例

```json
{
  "schemaVersion": 3,
  "research": {
    "policy": {
      "allowPaidFallback": false,
      "allowExternalFulltextUpload": false
    },
    "contact": "your-email@example.org",
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

- 需要密钥的服务既可以使用环境变量（`apiKeyEnv`），也可以直接填写 `apiKey`。
- Semantic Scholar、OpenAlex 和 PubMed 的 API Key 为可选项；easyScholar 的 `SecretKey` 为必填项。
- Unpaywall 依赖有效联系邮箱，可通过全局 `research.contact` 或 `unpaywall.contact` 配置。

## 网络请求与安全规范

- 所有请求均直接连接各服务商官方 HTTPS 端点，不支持重定向至非官方第三方镜像。
- 密钥、令牌与认证头会自动从日志、终端输出与生成文件中脱敏。
- 内置请求超时限制、结果分页上限及遵循 `Retry-After` 的节流重试，防止触发平台风控封禁。

## 官方 API 参考

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities 与 PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API 用户手册](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar 期刊等级接口](https://www.easyscholar.cc/open/getPublicationRank)
