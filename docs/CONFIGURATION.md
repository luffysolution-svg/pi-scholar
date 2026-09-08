# Pi Scholar 配置

[English](./CONFIGURATION.en.md)

Pi Scholar 1.0 使用 `schemaVersion: 3`。需要密钥的服务都接受两种配置：

- `apiKey`：直接填写密钥。
- `apiKeyEnv`：填写环境变量名，运行时读取该变量。

同一服务同时配置两者时，`apiKey` 优先；随后检查 `apiKeyEnv`，最后检查服务的标准环境变量。配置文件可能包含明文密钥，请只放在本机。仓库已忽略 `pi-scholar.config.json`，但用户级文件仍需自行保护。

## 最小可用示例

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

完整示例见 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json)。占位值必须替换或删除，不能直接作为有效凭据使用。

## 使用环境变量

将某个服务的 `apiKey` 改为 `apiKeyEnv` 即可使用自定义变量名：

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

PowerShell 当前会话：

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

Bash、zsh：

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

绘图服务的标准变量包括 `GEMINI_API_KEY`、`GOOGLE_API_KEY`、`OPENAI_API_KEY`、`XAI_API_KEY`、`FAL_KEY`、`FAL_API_KEY`、`DASHSCOPE_API_KEY`、`QWENCLOUD_API_KEY` 和 `ATLAS_API_KEY`。Vertex 使用 ADC 或 `GOOGLE_APPLICATION_CREDENTIALS`。

## 配置文件位置

程序按以下顺序读取首个可用文件：

1. `PI_SCHOLAR_CONFIG` 指定的文件。
2. 可信项目中，从当前目录向上找到的 `pi-scholar.config.json`。
3. `~/.config/pi-scholar/config.json`。Windows 路径为 `%USERPROFILE%\.config\pi-scholar\config.json`。
4. `~/.pi-scholar.json`。
5. 内置默认值。

JSON 中的相对路径以配置文件目录为基准。路径环境变量仍以运行时工作目录为基准。

## 服务凭据

| 服务 | 配置位置 | 标准环境变量 | 说明 |
|---|---|---|---|
| Semantic Scholar | `research.providers.semantic-scholar` | `SEMANTIC_SCHOLAR_API_KEY` | key 可选，配置后使用对应账户额度 |
| OpenAlex | `research.providers.openalex` | `OPENALEX_API_KEY` | key 可选 |
| PubMed / PMC | `research.providers.pubmed` | `NCBI_API_KEY` | key 可选；PMC 全文仍受许可限制 |
| arXiv | `research.providers.arxiv` | 无 | 不接受无意义的 key 字段 |
| Crossref | `research.providers.crossref` | 无 | 可在 `research.contact` 配置联系信息 |
| Unpaywall | `research.providers.unpaywall` | 无 | 使用 `contact` 邮箱，不使用 API key |
| easyScholar | `research.providers.easyscholar` | `EASYSCHOLAR_SECRET_KEY` | 只接入已核验的期刊等级/分区接口 |
| Materials Project | `data.providers.materials-project` | `MP_API_KEY` | REST 与可选 Python 桥接共用该 key |
| CAS Common Chemistry | `data.providers.cas-common-chemistry` | `CAS_API_KEY` | 可保存 key；公开契约不足时仍会阻止网络调用 |
| Ai4Scholar | `ai4scholar` | `AI4SCHOLAR_API_KEY` | 保留原有工具，不作为自动付费兜底 |
| MinerU | `mineru` | `MINERU_API_TOKEN` | PDF 解析会上传所选文件 |

`enabled` 只允许路由，不代表账户权限、配额或数据可用性已经验证。`/pi-scholar status`、`research_sources` 和 `materials_capabilities` 不会发起网络请求，也不会显示密钥。

## Materials Project

`data.providers.materials-project` 支持：

| 字段 | 默认值 | 范围或用途 |
|---|---|---|
| `enabled` | `false` | 是否允许材料工具联网 |
| `apiKey` | 无 | 直接密钥 |
| `apiKeyEnv` | `MP_API_KEY` | 自定义环境变量名 |
| `timeoutMs` | `20000` | 1,000 到 120,000 毫秒 |
| `maxRequests` / `maxPages` | `10` | 单次操作的请求上限 |
| `maxResults` | `100` | 单次结果上限，最大 10,000 |
| `maxResponseBytes` | `5242880` | 1 KiB 到 64 MiB |

`materials_search` 用于 summary 筛选；`materials_get` 按材料 ID 合并可直接寻址的属性；`materials_route_search` 处理 task、phonon identifier、电极、衬底和合成等独立路由；`materials_advanced` 提供固定的 Python 操作及本地相图、模拟 XRD。完整矩阵见 [`materials-capabilities.md`](./materials-capabilities.md)。

完整能带、DOS、声子对象、官方结构辅助方法和多元相图需要 Python 3.11 以上及官方包：

```powershell
python -m pip install mp-api pymatgen
$env:PI_SCHOLAR_PYTHON = "C:\Path\To\python.exe"
```

```bash
python -m pip install mp-api pymatgen
export PI_SCHOLAR_PYTHON="/path/to/python"
```

桥接器只接受固定操作和 JSON 输入输出，不运行用户或模型提供的 Python、shell、pickle。相图会标明热力学类型、0 K/0 atm 条件和本地派生身份；模拟 XRD 不会标作实验数据。

## Ai4Scholar 与 MinerU

Ai4Scholar 还支持 `baseUrl`、`timeoutMs` 和 `proxyUrl`。`proxyUrl` 可以是 HTTP(S) 代理或 `direct`。对应环境变量是 `AI4SCHOLAR_BASE_URL`、`AI4SCHOLAR_TIMEOUT_MS`、`AI4SCHOLAR_PROXY` 和 `AI4SCHOLAR_MCP_URL`。`/pi-scholar setup` 将新密钥写入统一配置，`clear-key` 只删除 `ai4scholar.apiKey`。

MinerU 支持 `timeoutMs`、`pollInitialMs`、`pollMaxMs`、`maxAttempts`、`language`、`enableFormula`、`enableTable`、`isOcr` 和 `modelVersion`。原有 `MINERU_*` 环境变量仍可覆盖这些非凭据字段。外部上传必须同时满足 `research.policy.allowExternalFulltextUpload` 和调用时授权。

## 同步、输出与 Zotero

同步策略只接受以下保守值：

```json
{
  "sync": {
    "missingPolicy": "skip-and-report",
    "conflictPolicy": "preserve-local",
    "metadataPolicy": "three-way-merge",
    "reparsePolicy": "when-required-and-authorized",
    "backupRetentionDays": 30
  }
}
```

`sync.namespace` 用于隔离不同资料库，`sync.cacheDir` 指定解析缓存。缺失输出默认只报告；恢复、排除和修复必须使用各自的显式动作。元数据刷新不会因此重传 PDF。

`output.directory` 默认为 `~/pi-scholar`；`literaturesDirectory`、`assetFilePrefix`、`filenameSeparator` 和 `tagSpaceReplacement` 控制目录与文件名。对应的 `PI_SCHOLAR_OUTPUT_DIR` 等环境变量仍可覆盖 JSON。

Zotero `baseUrl` 只允许 `http://localhost:23119/api` 或 `http://127.0.0.1:23119/api`。`timeoutMs` 范围为 1,000 到 120,000 毫秒，`maxItems` 范围为 1 到 50,000。不要将 23119 端口暴露到外网。

## 绘图服务

`media.providerOptions.<id>.apiKey` 和 `apiKeyEnv` 的优先级与其他服务相同。内置供应商为 Gemini、Vertex、OpenAI、xAI、fal.ai、Qwen/DashScope 和 Atlas，也支持显式声明的 OpenAI 兼容服务。模型、尺寸、连接测试和字段限制见 [`IMAGE_PROVIDERS.md`](./IMAGE_PROVIDERS.md)。

## 校验

加载配置时会检查未知字段、错误类型、数值范围、URL 和路径安全。旧 `schemaVersion`、`credentialEnv`、`mineru.tokenEnv` 和迁移命令不再支持。先从 1.0.0 示例建立新配置，再运行：

```sh
npx @luffysolution/pi-scholar doctor
```
