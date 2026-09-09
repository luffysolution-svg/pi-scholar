# Pi Scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

简体中文 | [English](./README.en.md)

Pi Scholar 为 Pi 添加文献检索、Zotero 读取、PDF 解析、引用处理、材料数据和科研绘图工具。模型直接调用这些工具，不需要 MCP。

解析结果保存为 UTF-8 Markdown、JSON 和图片。输出目录可以是普通文件夹，也可以是 Obsidian Vault。配置字段见 [配置说明](docs/CONFIGURATION.md)。

## 功能

- 检索 Semantic Scholar、OpenAlex、PubMed/PMC、arXiv、Crossref 和 Google Scholar
- 查询论文详情、作者、引用网络、全文片段、专利、数据集和期刊指标
- 通过 Unpaywall 查找开放获取版本及其许可信息
- 读取 Zotero 收藏夹、条目、笔记、批注和附件，不修改 Zotero 数据
- 使用 MinerU 提取 PDF 正文、公式、表格和图片
- 查找引用候选并生成指定格式的参考文献
- 查询 Materials Project，导出材料记录，计算相图和模拟 XRD
- 调用 Ai4Scholar 或已配置的图像供应商生成、编辑和矢量化科研图片

## 安装

要求 Node.js `>=22.19`、Pi `>=0.84.4`、Zotero `7+`，支持 Windows、macOS 和 Linux。

```sh
pi install npm:@luffysolution/pi-scholar@latest
```

也可以固定版本或从 GitHub 安装：

```sh
pi install npm:@luffysolution/pi-scholar@1.1.1
pi install git:github.com/luffysolution-svg/pi-scholar@main
```

安装后重启 Pi 或运行 `/reload`。更新或卸载：

```sh
pi update npm:@luffysolution/pi-scholar@latest
pi remove npm:@luffysolution/pi-scholar
```

## 入口：`/pi-scholar`

```text
/pi-scholar
/pi-scholar 查找光热催化制氢论文，并匹配本地 Zotero
/pi-scholar 解析 Zotero 条目 BIRUSQD5 并分析图 3
/pi-scholar 为这段相关工作补充 GB/T 7714 引用
```

不带参数时打开输入框。带参数时，Pi Scholar 根据请求选择检索、Zotero、解析、引用或绘图工具。

凭据写在配置文件中，也可以引用环境变量。命令本身不写入凭据。可用的状态命令：

```text
/pi-scholar status      查看配置来源、连接方式和绘图供应商
/pi-scholar credits     查询在线服务积分
/pi-scholar docs        打开配置文档地址
```

凭据优先级为 `apiKey`、`apiKeyEnv` 指向的变量、服务默认环境变量。含有明文密钥的配置文件不要提交到版本库。

Ai4Scholar 的 Google Scholar 和 Google Patents 请求默认等待 60 秒，其他请求默认等待 30 秒。超时设置见 [配置说明](docs/CONFIGURATION.md)。绘图文件保存在输出目录的 `ai4scholar-images/` 中，图片也会随工具结果返回，模型可以直接查看。

`ai4scholar_citation_candidates` 根据正文中的 `[CITE]` 标记或指定陈述搜索 Semantic Scholar。它返回候选文献，不替用户决定引用哪一篇。

## 内置技能

安装包同时提供一个编排技能和七个专用技能：

| 技能 | 用途 |
|---|---|
| `pi-scholar` | 总入口；组合多阶段科研任务 |
| `scholar-search` | 在线文献、专利、作者、引用网络、期刊和数据集 |
| `zotero-research` | 本地 Zotero 检索、匹配、笔记、批注和附件 |
| `paper-reading` | MinerU PDF 解析与正文、公式、表格、图片精读 |
| `academic-citation` | 引用核验、格式化、参考文献和引用插入 |
| `scientific-figure` | 科研图片生成、编辑、评审和矢量化 |
| `materials-project` | 材料筛选、结构、性质、计算来源和导出 |
| `chemical-data` | CAS Common Chemistry 化学物质名称、CAS RN、结构与基本信息 |

通常使用 `/pi-scholar`。需要固定流程时，也可以调用 `/skill:<技能名>`。

## 输出结构

默认结构：

```text
<vault>/
└── Literatures/
    └── Yang-2024-Paper Title/
        ├── Yang-2024-Paper Title.md
        ├── metadata.json
        └── assets/
            ├── figure-01.png
            └── figure-02.png
```

- `output.directory` 设置输出根目录。
- `output.literaturesDirectory` 设置文献目录名，例如 `Literatures`、`文献` 或 `Papers`。该值只能是单级目录名。
- 同一 Zotero 条目重新解析时沿用原目录。同名条目追加 ` (2)`、` (3)`。
- 图片保存在 `assets` 中，默认名称为 `figure-01.png`。
- 路径超过限制时，目录名会自动缩短；完整标题仍写入 frontmatter 和 `metadata.json`。
- Markdown 使用相对图片路径，整篇文献目录可以一起移动。

## 配置

复制 [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) 为 `pi-scholar.config.json`，或放到用户级位置。

配置查找顺序：

1. `PI_SCHOLAR_CONFIG` 指定的文件
2. 已信任项目及其父目录中的 `pi-scholar.config.json`
3. `~/.pi/agent/pi-scholar.json`
4. `~/.config/pi-scholar/config.json`
5. `~/.pi-scholar.json`
6. 内置默认值

直接填写的凭据优先，环境变量用于回退。Zotero 和输出路径的专用环境变量可以覆盖 JSON；相对路径按配置文件所在目录解析。

科研绘图支持 Gemini API、Vertex AI、OpenAI、xAI、fal.ai、Qwen/DashScope、Atlas 和自定义 OpenAI 兼容服务。可用的编辑方式、尺寸和输出格式取决于供应商与模型。

> 模型、参数与平台限制见 [科研绘图供应商兼容性](./docs/IMAGE_PROVIDERS.md)。
>
> 所有字段、默认值、范围和环境变量见 [中文配置说明](./docs/CONFIGURATION.md) / [English](./docs/CONFIGURATION.en.md)。

Zotero 中需要开启“允许其他应用程序与 Zotero 通信”。端口 `23119` 只用于本机访问。

## 环境自检

无需先启动 Pi：

```sh
npx @luffysolution/pi-scholar doctor
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

`doctor` 检查 Node 版本、配置文件位置、Zotero 连接以及 MinerU 和 Ai4Scholar 凭据是否存在。它不显示密钥，也不读取文献内容。

<details>
<summary>数据与文件处理</summary>

- Zotero 工具只向 `127.0.0.1:23119/api` 发送 GET 请求。
- MinerU 解析会把用户选定的 PDF 上传到 MinerU。
- 密钥、认证头和签名 URL 不写入 Markdown、YAML 或日志。
- MinerU 归档在解压前检查路径和大小。
- 论文文件先写入临时目录，完成后再替换目标目录；中断时保留原文件。
- 在线检索、MinerU 和绘图可能消耗服务配额或积分。

</details>

## 开发与验证

```sh
npm install
npm test
npm run check
npm run pack:check
npm audit --omit=dev
```

测试使用 mock 和临时目录，不会访问真实 Zotero、MinerU 或在线服务。

## 许可证

[MIT](./LICENSE) © Pi Scholar contributors

第三方依赖说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
