# Pi Scholar 配置指南

[English](./CONFIGURATION.en.md)

Pi Scholar 1.0 使用 `schemaVersion: 3` 配置文件。需要认证的服务均支持两种配置方式：

- `apiKey`：直接填写 API Key 明文。
- `apiKeyEnv`：指定自定义环境变量名称，运行时自动读取。

**凭据优先级**：如果同时提供了多种凭据来源，系统将按 `apiKey` → `apiKeyEnv` 所指变量 → 服务默认标准环境变量的顺序依次匹配。

> 提示：若配置文件中包含明文密钥，请妥善保管。项目根目录已默认忽略 `pi-scholar.config.json`，避免意外提交密钥至版本库。

## 快速上手配置

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

完整配置模板可参考根目录下的 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json)。

## 环境变量使用方式

如果你更习惯将密钥存放在环境变量中，可以将对应项配置为 `apiKeyEnv`：

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

或者直接设置各服务默认的标准环境变量：

**PowerShell**：
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

**Bash / zsh**：
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

科研绘图供应商的环境变量包括：`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`OPENAI_API_KEY`、`XAI_API_KEY`、`FAL_KEY`、`DASHSCOPE_API_KEY`（或 `QWENCLOUD_API_KEY`）及 `ATLAS_API_KEY`。Vertex AI 支持 Google 应用默认凭据（ADC）或通过 `GOOGLE_APPLICATION_CREDENTIALS` 指定服务账号 JSON。

## 配置文件查找顺序

启动与加载时，系统按以下顺序定位首个存在的配置文件：

1. 环境变量 `PI_SCHOLAR_CONFIG` 指定的绝对路径。
2. 当前可信项目目录及其父级目录中递归向上查找到的 `pi-scholar.config.json`。
3. 用户全局配置目录：`~/.config/pi-scholar/config.json`（Windows 对应 `%USERPROFILE%\.config\pi-scholar\config.json`）。
4. 用户根目录配置：`~/.pi-scholar.json`。
5. 扩展内置的默认参数。

配置文件中的相对路径均以该配置文件所在的目录为解析基准。

## 服务凭据一览表

| 服务 | 配置路径 | 标准环境变量 | 备注 |
|---|---|---|---|
| **Semantic Scholar** | `research.providers.semantic-scholar` | `SEMANTIC_SCHOLAR_API_KEY` | Key 可选，配置后享有更高请求配额 |
| **OpenAlex** | `research.providers.openalex` | `OPENALEX_API_KEY` | Key 可选，开放数据源 |
| **PubMed / PMC** | `research.providers.pubmed` | `NCBI_API_KEY` | Key 可选，配置后提高 NCBI 请求速率限制 |
| **arXiv** | `research.providers.arxiv` | 无 | 免 Key 开放检索 |
| **Crossref** | `research.providers.crossref` | 无 | 可在 `research.contact` 配置联系邮箱以接入 Polite 池 |
| **Unpaywall** | `research.providers.unpaywall` | 无 | 需在 `contact` 中填写联系邮箱 |
| **easyScholar** | `research.providers.easyscholar` | `EASYSCHOLAR_SECRET_KEY` | 需填写 SecretKey 以查询期刊等级与分区 |
| **Materials Project** | `data.providers.materials-project` | `MP_API_KEY` | REST API 与 Python 扩展计算共用该 Key |
| **CAS Common Chemistry** | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | 可预填 Key；官方接入开放后即可使用 |
| **Ai4Scholar** | `ai4scholar` | `AI4SCHOLAR_API_KEY` | 独立调用工具，按需使用 |
| **MinerU** | `mineru` | `MINERU_API_TOKEN` | 用于本地 PDF 的深度解析与结构化提取 |

查看配置状态命令 `/pi-scholar status` 仅在本地做信息汇总，不会向服务商发起不必要的网络校验，也不会在终端输出明文密码。

## Materials Project 材料数据

在 `data.providers.materials-project` 下可配置以下选项：

| 字段 | 默认值 | 作用说明 |
|---|---|---|
| `enabled` | `false` | 是否开启 Materials Project 相关功能 |
| `apiKey` / `apiKeyEnv` | 无 / `MP_API_KEY` | 认证密钥或对应环境变量名 |
| `timeoutMs` | `20000` | 网络超时时间（毫秒），范围 1,000 ~ 120,000 |
| `maxRequests` / `maxPages` | `10` | 单次查询的最大翻页/子请求限制 |
| `maxResults` | `100` | 单次操作返回的最大记录数，上限 10,000 |
| `maxResponseBytes` | `5242880` (5 MiB) | 单次响应的最大字节数，防止超大体积响应占用内存 |

### Python 计算桥接（可选）

Materials Project 的基础 REST 查询（如材料概览、结构筛选、热力学与基础性质）无需安装额外环境。

如果你需要计算**完整能带图、态密度（DOS）、声子谱、相图（Phase Diagram）或模拟 XRD 衍射图谱**，请安装 Python 3.11+ 及官方推荐库：

```sh
pip install mp-api pymatgen
```

若 Python 未加入系统环境变量，可通过环境变量指定解释器路径：
```sh
export PI_SCHOLAR_PYTHON="/path/to/python"
# Windows PowerShell: $env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

相图分析和模拟 XRD 为基于理论参数在本地进行的推导与计算，不额外消耗远程 API 额度。完整能力清单请参阅 [Materials Project 能力说明](./materials-capabilities.md)。

## Ai4Scholar 与 MinerU 选项

- **Ai4Scholar**：支持通过 `baseUrl`、`timeoutMs` 和 `proxyUrl` 配置自定义中转地址或网络代理（`proxyUrl` 支持 HTTP/HTTPS 代理地址，或设为 `direct` 直连）。相关环境变量为 `AI4SCHOLAR_BASE_URL`、`AI4SCHOLAR_TIMEOUT_MS` 及 `AI4SCHOLAR_PROXY`。
- **MinerU**：支持配置解析超时 `timeoutMs`、轮询策略（`pollInitialMs`、`pollMaxMs`、`maxAttempts`）以及解析控制项：`language`（语言）、`enableFormula`（公式提取）、`enableTable`（表格提取）、`isOcr`（OCR 识别）和 `modelVersion`（模型版本，默认为 `vlm`）。支持通过 `MINERU_*` 系列环境变量覆盖。

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

- **同步安全**：同步遵循保护本地内容的原则。发生改动冲突时优先保留本地内容；元数据更新时不会重新上传 PDF，最大化节省网络与解析开销。
- **输出管理**：`output.directory` 可直接指向你的 Obsidian Vault 目录。各篇论文以独立目录存储，图表等资产自动归入子目录 `assets` 中。
- **Zotero 设置**：Zotero 本地 API 默认地址为 `http://127.0.0.1:23119/api`（在 Zotero 首选项 → 高级中勾选“允许其他应用程序与 Zotero 通信”）。

## 科研绘图配置

科研绘图支持在 `media` 节点下配置 Gemini API、Vertex AI、OpenAI、xAI、fal.ai、Qwen/DashScope、Atlas 以及自定义 OpenAI 兼容模型服务。支持按需指定生图质量、透明背景、参考图数量与分辨率档位。详细支持列表与兼容性说明见 [科研绘图供应商指南](./IMAGE_PROVIDERS.md)。

## 配置自检与诊断

修改配置文件后，可直接通过内置诊断命令检查配置是否有效、网络是否通畅：

```sh
npx @luffysolution/pi-scholar doctor
```
