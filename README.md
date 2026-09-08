# Pi Scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

简体中文 | [English](./README.en.md)

Pi Scholar 是面向 Pi 的一体化科研扩展，在一个安装包中提供在线学术检索、本地 Zotero 只读访问、MinerU PDF 解析、引用与期刊分析、科研绘图和动态 MCP 能力。

输出是普通 UTF-8 Markdown、JSON 元数据和图片文件，不依赖 Obsidian 插件或数据库；将输出目录设置为 Obsidian Vault 后即可直接使用。

安全同步、多源文献和 Materials Project 使用统一配置，完整字段见 [配置说明](docs/CONFIGURATION.md)。

## 主要功能

- 通过 Semantic Scholar、OpenAlex、PubMed/PMC、arXiv 和 Crossref 发现并核验文献
- 通过 Unpaywall 定位带版本与许可信息的开放获取全文
- 查询 Materials Project 的 MP01-MP17 能力，包括路由筛选、完整对象桥接、导出、相图和模拟 XRD；CAS Common Chemistry 化学物质记录独立存储
- 通过显式选择的 Ai4Scholar 工具访问 Google Scholar、专利及高级工作流，不作自动付费兜底
- 查询论文、作者、引用网络、相关推荐、全文片段和数据集
- 查询 JCR / 中科院分区并推荐投稿期刊
- 只读搜索 Zotero 收藏夹、条目、笔记、批注和附件
- 使用 MinerU 解析 PDF 中的正文、公式、表格和图片
- 生成引用、参考文献并为学术文本自动补充引用
- 生成、编辑、评审和矢量化科研图片
- 按需发现并加载在线 MCP 工具
- 安全可靠：Zotero 仅限本地只读访问、密钥自动脱敏、文件写入支持原子保护与故障恢复

## 安装

要求 Node.js `>=22.19`、Pi `>=0.84.4`、Zotero `7+`，支持 Windows、macOS 和 Linux。

```sh
pi install npm:@luffysolution/pi-scholar@latest
```

也可以固定版本或从 GitHub 安装：

```sh
pi install npm:@luffysolution/pi-scholar@1.0.2
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
```

安装后重启 Pi 或运行 `/reload`。已安装固定版本时，使用 `pi install npm:@luffysolution/pi-scholar@latest` 切换到最新通道；更新与卸载：

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

不带参数时会打开输入框；带自然语言参数时直接调用总编排技能，由模型选择必要的在线、本地、解析、引用或绘图工具。

配置和状态管理也统一在同一命令下：

```text
/pi-scholar setup       配置在线服务密钥
/pi-scholar status      查看配置来源、连接方式和绘图供应商
/pi-scholar credits     查询在线服务积分
/pi-scholar docs        打开配置文档地址
/pi-scholar clear-key   删除本机保存的密钥
/pi-scholar setup-sources  预览并生成多源配置候选
```

Ai4Scholar 只在用户选择相应工具时调用。需要凭据的服务都支持统一配置中的 `apiKey`；也可以用 `apiKeyEnv` 指定环境变量。优先级是 `apiKey`、`apiKeyEnv`、服务的标准环境变量。不要提交含密钥的配置。

## 内置技能

安装包同时提供一个编排技能和七个专用技能：

| 技能 | 用途 |
|---|---|
| `pi-scholar` | 总入口；组合多阶段科研任务 |
| `scholar-search` | 在线文献、专利、作者、引用网络、期刊和数据集 |
| `zotero-research` | 本地 Zotero 检索、匹配、笔记、批注和附件 |
| `paper-reading` | MinerU PDF 解析与正文、公式、表格、图片精读 |
| `academic-citation` | 引用核验、格式化、参考文献和自动引用 |
| `scientific-figure` | 科研图片生成、编辑、评审和矢量化 |
| `materials-project` | 材料筛选、结构、性质、计算来源和导出 |
| `chemical-data` | CAS Common Chemistry 化学物质名称、CAS RN、结构与基本信息 |

日常直接使用 `/pi-scholar` 即可；各专用技能也支持通过 `/skill:<技能名>` 单独调用。

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

- `output.directory` 指向 Vault 或普通输出根目录。
- `output.literaturesDirectory` 控制 `Literatures` 名称，可以改成 `文献`、`Papers` 等安全的单级目录名。
- 每篇论文是一个独立事务单元，复制、移动或删除时不会遗漏元数据和图片。
- 同一 Zotero 条目重新解析时复用原目录；同名不同条目使用 ` (2)`、` (3)` 等后缀。
- 资源目录固定为短名称 `assets`，图片默认使用 `figure-01.png` 形式，避免标题在图片路径中重复。
- 论文目录名会结合实际输出根路径自动截短，使最终 Markdown 和图片路径不超过 240 个字符；完整标题仍保存在 frontmatter 和 `metadata.json`。
- Markdown 图片使用相对路径，因此整篇论文目录移动后仍可正常显示。

## 配置

复制 [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) 为 `pi-scholar.config.json`，或放到用户级位置。

配置查找顺序：

1. `PI_SCHOLAR_CONFIG` 指定的文件
2. 可信项目中向上查找的 `pi-scholar.config.json`
3. `~/.config/pi-scholar/config.json`
4. `~/.pi-scholar.json`
5. 内置默认值

直接填写的凭据优先，环境变量用于回退。Zotero 和输出路径的专用环境变量可以覆盖 JSON；相对路径按配置文件所在目录解析。

科研绘图原生接入了 Gemini API、Vertex AI、OpenAI、xAI、fal.ai、Qwen/DashScope、Atlas 与自定义 OpenAI 兼容服务，覆盖文生图、图生图/编辑、多参考图、透明背景、尺寸与各模型允许的 1K/2K/4K 档位，并提供连接测试与模型目录查看。

> 模型、参数与平台限制见 [科研绘图供应商兼容性](./docs/IMAGE_PROVIDERS.md)。
>
> 所有字段、默认值、范围和环境变量见 [中文配置说明](./docs/CONFIGURATION.md) / [English](./docs/CONFIGURATION.en.md)。

Zotero 中需要开启“允许其他应用程序与 Zotero 通信”。不要将端口 `23119` 暴露到外网。

## 环境自检

无需先启动 Pi：

```sh
npx @luffysolution/pi-scholar doctor
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

`doctor` 检查 Node 版本、配置发现、Zotero 可达性以及 MinerU/在线服务密钥是否存在，但不会显示密钥内容或读取文献数据。

<details>
<summary>安全与隐私</summary>

- Zotero 请求严格限制在本地回环地址（`127.0.0.1:23119/api`），仅支持 GET 查询且禁用外部重定向。
- MinerU 仅在需要深度解析 PDF 中的公式、表格或图表时调用，上传所选文件。
- API Key、Authorization 认证头和签名 URL 绝不会写入生成的 Markdown、YAML 或输出日志。
- 解压 MinerU ZIP 归档时自动校验相对路径与体积，避免恶意路径穿越。
- 论文与附件采用先写临时目录再原子替换的方式发布，出现中断或异常时自动回滚，保护原有文件不受破坏。
- 在线检索、自动引用、MinerU 与科研绘图会正常消耗对应平台的配额或积分。

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
