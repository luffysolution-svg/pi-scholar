# Pi Scholar 配置指南

[English](./CONFIGURATION.en.md)

配置文件使用 `schemaVersion: 3`。服务凭据可以直接写在 `apiKey` 中，也可以通过 `apiKeyEnv` 引用环境变量。

凭据按以下顺序读取：`apiKey`、`apiKeyEnv` 指向的变量、服务默认环境变量。项目的 `.gitignore` 已忽略 `pi-scholar.config.json`；其他位置的配置文件仍需自行排除，避免提交明文密钥。

## 配置示例

```json
{
  "schemaVersion": 3,
  "ai4scholar": {
    "apiKey": "YOUR_AI4SCHOLAR_API_KEY"
  },
  "research": {
    "policy": {
      "allowPaidFallback": false,
      "allowExternalFulltextUpload": false
    },
    "providers": {
      "semantic-scholar": { "enabled": true, "apiKey": "YOUR_SEMANTIC_SCHOLAR_API_KEY" },
      "openalex": { "enabled": true, "apiKey": "YOUR_OPENALEX_API_KEY" },
      "pubmed": { "enabled": true, "apiKey": "YOUR_NCBI_API_KEY" },
      "arxiv": { "enabled": true },
      "crossref": { "enabled": true },
      "unpaywall": { "enabled": true, "contact": "researcher@example.org" },
      "easyscholar": { "enabled": true, "apiKey": "YOUR_EASYSCHOLAR_SECRET_KEY" }
    }
  },
  "data": {
    "providers": {
      "materials-project": { "enabled": true, "apiKey": "YOUR_MATERIALS_PROJECT_API_KEY" },
      "cas-common-chemistry": { "enabled": true, "apiKey": "YOUR_CAS_COMMON_CHEMISTRY_API_KEY" }
    }
  },
  "mineru": {
    "apiKey": "YOUR_MINERU_API_KEY"
  }
}
```

所有字段见 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json)。

## 环境变量

用 `apiKeyEnv` 指定变量名：

```json
{
  "schemaVersion": 3,
  "data": {
    "providers": {
      "materials-project": { "enabled": true, "apiKeyEnv": "MY_MP_KEY" }
    }
  }
}
```

也可以直接设置服务默认变量。

PowerShell：
```powershell
$env:SEMANTIC_SCHOLAR_API_KEY = "YOUR_KEY"
$env:OPENALEX_API_KEY = "YOUR_KEY"
$env:NCBI_API_KEY = "YOUR_KEY"
$env:EASYSCHOLAR_SECRET_KEY = "YOUR_KEY"
$env:MP_API_KEY = "YOUR_KEY"
$env:CAS_API_KEY = "YOUR_KEY"
$env:AI4SCHOLAR_API_KEY = "YOUR_KEY"
$env:MINERU_API_TOKEN = "YOUR_KEY"
```

Bash / zsh：
```bash
export SEMANTIC_SCHOLAR_API_KEY="YOUR_KEY"
export OPENALEX_API_KEY="YOUR_KEY"
export NCBI_API_KEY="YOUR_KEY"
export EASYSCHOLAR_SECRET_KEY="YOUR_KEY"
export MP_API_KEY="YOUR_KEY"
export CAS_API_KEY="YOUR_KEY"
export AI4SCHOLAR_API_KEY="YOUR_KEY"
export MINERU_API_TOKEN="YOUR_KEY"
```

绘图供应商使用以下环境变量：`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`OPENAI_API_KEY`、`XAI_API_KEY`、`FAL_KEY`、`DASHSCOPE_API_KEY`（或 `QWENCLOUD_API_KEY`）及 `ATLAS_API_KEY`。Vertex AI 支持 Google 应用默认凭据（ADC）或通过 `GOOGLE_APPLICATION_CREDENTIALS` 指定服务账号 JSON。

## 配置文件查找顺序

Pi Scholar 使用找到的第一个配置文件，不合并多个文件：

1. `PI_SCHOLAR_CONFIG` 指定的文件。
2. 已信任项目及其父目录中的 `pi-scholar.config.json`。
3. `~/.pi/agent/pi-scholar.json`，或 `PI_CODING_AGENT_DIR` 指定目录中的 `pi-scholar.json`。
4. `~/.config/pi-scholar/config.json`。
5. `~/.pi-scholar.json`。
6. 内置默认值。

相对路径以配置文件所在目录为准。

## 服务凭据一览表

| 服务 | 配置路径 | 标准环境变量 | 备注 |
|---|---|---|---|
| Semantic Scholar | `research.providers.semantic-scholar` | `SEMANTIC_SCHOLAR_API_KEY` | Key 可选，配置后享有更高请求配额 |
| OpenAlex | `research.providers.openalex` | `OPENALEX_API_KEY` | Key 可选，开放数据源 |
| PubMed / PMC | `research.providers.pubmed` | `NCBI_API_KEY` | Key 可选，配置后提高 NCBI 请求速率限制 |
| arXiv | `research.providers.arxiv` | 无 | 免 Key 开放检索 |
| Crossref | `research.providers.crossref` | 无 | 可在 `research.contact` 配置联系邮箱以接入 Polite 池 |
| Unpaywall | `research.providers.unpaywall` | 无 | 需在 `contact` 中填写联系邮箱 |
| easyScholar | `research.providers.easyscholar` | `EASYSCHOLAR_SECRET_KEY` | 需填写 SecretKey 以查询期刊等级与分区 |
| Materials Project | `data.providers.materials-project` | `MP_API_KEY` | REST API 与 Python 扩展计算共用该 Key |
| CAS Common Chemistry | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | 当前版本未实现查询端点 |
| Ai4Scholar | `ai4scholar` | `AI4SCHOLAR_API_KEY` | 独立调用工具，按需使用 |
| MinerU | `mineru` | `MINERU_API_TOKEN` | 用于本地 PDF 的深度解析与结构化提取 |

`/pi-scholar status` 读取本地配置并显示已启用的服务。它不测试远端权限或余额，也不显示密钥。

## Materials Project 材料数据

在 `data.providers.materials-project` 下可配置以下选项：

| 字段 | 默认值 | 作用说明 |
|---|---|---|
| `enabled` | `false` | 启用 Materials Project 工具 |
| `apiKey` / `apiKeyEnv` | 无 / `MP_API_KEY` | 密钥或变量名 |
| `timeoutMs` | `20000` | 请求超时，单位为毫秒；范围 1,000 到 300,000 |
| `maxRequests` / `maxPages` | `10` | 单次查询的翻页或子请求上限 |
| `maxResults` | `100` | 单次操作的记录上限，最高 10,000 |
| `maxResponseBytes` | `5242880` (5 MiB) | 单次响应大小上限 |

### Python 计算桥接（可选）

材料概览、结构筛选、热力学和基础性质查询只使用 REST API。相图和模拟 XRD 等本地计算需要 Python 3.11+、`mp-api` 和 `pymatgen`：

```sh
pip install mp-api pymatgen
```

用 `PI_SCHOLAR_PYTHON` 指定 Python 路径：
```sh
export PI_SCHOLAR_PYTHON="/path/to/python"
# Windows PowerShell: $env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

相图和模拟 XRD 在本地计算，不消耗额外的 Materials Project 请求额度。能力清单见 [Materials Project 能力说明](./materials-capabilities.md)。

## Ai4Scholar 与 MinerU 选项

- Ai4Scholar：`baseUrl` 设置服务地址，`timeoutMs` 设置普通请求超时，`crawlerTimeoutMs` 设置 Google Scholar 和 Google Patents 超时，`proxyUrl` 设置 HTTP/HTTPS 代理；`direct` 表示直连。对应变量为 `AI4SCHOLAR_BASE_URL`、`AI4SCHOLAR_TIMEOUT_MS`、`AI4SCHOLAR_CRAWLER_TIMEOUT_MS` 和 `AI4SCHOLAR_PROXY`。
- MinerU：`timeoutMs` 设置总超时；`pollInitialMs`、`pollMaxMs` 和 `maxAttempts` 控制轮询；`language`、`enableFormula`、`enableTable`、`isOcr` 和 `modelVersion` 控制解析。对应变量使用 `MINERU_*` 前缀。

## 本地同步、Zotero 与输出目录

```json
{
  "sync": {
    "missingPolicy": "skip-and-report",
    "conflictPolicy": "preserve-local",
    "metadataPolicy": "three-way-merge",
    "reparsePolicy": "when-required-and-authorized",
    "backupRetentionDays": 30
  },
  "output": {
    "directory": "~/pi-scholar",
    "literaturesDirectory": "Literatures",
    "assetFilePrefix": "figure-",
    "filenameSeparator": "-",
    "tagSpaceReplacement": "-"
  }
}
```

同步冲突时保留本地内容。只更新元数据时，不会重新上传 PDF。

`output.directory` 可以指向 Obsidian Vault。每篇论文使用一个目录，图片保存在其 `assets` 子目录。

Zotero 本地 API 默认地址是 `http://127.0.0.1:23119/api`。使用前，在 Zotero 首选项的“高级”页面启用“允许其他应用程序与 Zotero 通信”。

## 科研绘图配置

`media` 节点配置 Gemini API、Vertex AI、OpenAI、xAI、fal.ai、Qwen/DashScope、Atlas 和自定义 OpenAI 兼容服务。模型支持的尺寸、参考图数量和输出选项见 [绘图供应商说明](./IMAGE_PROVIDERS.md)。

## 检查配置

以下命令检查配置文件、Zotero 连接和凭据是否存在，不验证远端账号权限：

```sh
npx @luffysolution/pi-scholar doctor
```
