# 文献数据源与检索

Pi Scholar 将不同数据源的论文记录转换为同一结构，同时保留原始标识符、引用关系、许可信息和服务端响应。

## 支持的数据源

| 数据源 | 可用功能 | 配置 |
|---|---|---|
| Semantic Scholar | 论文检索、详情、引用网络和推荐 | Key 可选；配置后按服务端规则获得更高额度 |
| OpenAlex | 论文、作者、机构和结构化筛选 | Key 可选 |
| PubMed / PMC | 生物医学检索和 PMC 开放全文 | NCBI Key 可选，用于提高请求速率 |
| arXiv | 预印本检索和版本 PDF | 无需 Key |
| Crossref | DOI 元数据、更新记录、勘误和撤稿标记 | 无需 Key；可配置联系邮箱 |
| Unpaywall | DOI 对应的开放获取地址和许可 | 需要 `contact` 邮箱 |
| easyScholar | 期刊等级、JCR 和中科院分区 | 需要 `SecretKey` |

### 其他数据服务

Ai4Scholar 工具使用 `ai4scholar_*` 前缀，提供 Google Scholar、Google Patents、Semantic Scholar、PubMed、期刊和数据集接口。调用可能消耗 Ai4Scholar 积分。

CAS Common Chemistry 单独处理化学物质记录，见 [化学数据源说明](./chemistry.md)。

## 工具

- `research_sources`：离线查看各数据源的启用状态、已配置凭据与接口能力。
- `literature_search`：从指定数据源检索论文，可按年份和开放获取状态筛选。
- `literature_get`：按 DOI、arXiv ID、PMID 或数据源 ID 获取元数据。
- `literature_graph`：读取论文的参考文献、施引文献或推荐结果。
- `journal_metrics`：查询期刊指标和分区。
- `literature_fulltext`：`resolve` 返回全文地址和许可信息，`fetch` 下载并缓存文件。

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

`apiKey` 直接保存密钥，`apiKeyEnv` 引用环境变量。Semantic Scholar、OpenAlex 和 PubMed 的 Key 可选；easyScholar 需要 `SecretKey`。Unpaywall 联系邮箱可以写在 `research.contact` 或 `unpaywall.contact`。

## 请求行为

文献模块连接各数据源的 HTTPS 地址，不跟随跨站重定向。日志和生成文件会过滤密钥与认证头。每个请求有超时、分页和结果数量上限；服务返回 `Retry-After` 时按该时间等待。

## 官方 API 参考

- [Semantic Scholar Graph API](https://api.semanticscholar.org/api-docs/graph)
- [OpenAlex API](https://docs.openalex.org/)
- [NCBI E-utilities 与 PMC OA](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
- [arXiv API 用户手册](https://info.arxiv.org/help/api/user-manual.html)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Unpaywall REST API](https://unpaywall.org/api)
- [easyScholar 期刊等级接口](https://www.easyscholar.cc/open/getPublicationRank)
