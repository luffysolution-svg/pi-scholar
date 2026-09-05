# 📚 Pi Scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

🌐 **简体中文** ｜ [English](./README.en.md)

Pi Scholar 是面向 Pi 的一体化科研扩展，在一个安装包中提供在线学术检索、本地 Zotero 只读访问、MinerU PDF 解析、引用与期刊分析、科研绘图和动态 MCP 能力。

输出是普通 UTF-8 Markdown、JSON 元数据和图片文件，不依赖 Obsidian 插件或数据库；将输出目录设置为 Obsidian Vault 后即可直接使用。

## ✨ 主要功能

- 🔎 检索 Semantic Scholar、PubMed、Google Scholar 和 Google Patents
- 🧭 查询论文、作者、引用网络、相关推荐、全文片段和数据集
- 📊 查询 JCR / 中科院分区并进行投稿期刊推荐
- 🗂️ 只读搜索 Zotero 收藏夹、条目、笔记、批注和附件
- 🧬 使用 MinerU 解析 PDF 中的正文、公式、表格和图片
- 📝 生成引用、参考文献并为学术文本自动补充引用
- 🎨 生成、编辑、评审和矢量化科研图片
- 🔌 按需发现并加载在线 MCP 工具
- 🔒 本地回环限制、安全压缩包检查、密钥脱敏和事务化发布

## 📦 安装

要求 Node.js `>=22.19`、Pi `>=0.84.4`、Zotero `7+`，支持 Windows、macOS 和 Linux。

```sh
pi install npm:@luffysolution/pi-scholar
```

也可以指定版本或从 GitHub 安装：

```sh
pi install npm:@luffysolution/pi-scholar@0.3.1
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
```

安装后重启 Pi 或运行 `/reload`。更新与卸载：

```sh
pi update npm:@luffysolution/pi-scholar
pi remove npm:@luffysolution/pi-scholar
```

## 💬 唯一入口：`/pi-scholar`

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
/pi-scholar status      查看配置来源和连接方式
/pi-scholar credits     查询在线服务积分
/pi-scholar docs        打开配置文档地址
/pi-scholar clear-key   删除本机保存的密钥
```

API Key 只保存在环境变量或 `~/.pi/agent/pi-scholar.credentials.json`，不会写入项目配置、模型消息或解析结果。

## 🧠 内置技能

安装包同时提供一个编排技能和五个专用技能：

| 技能 | 用途 |
|---|---|
| `pi-scholar` | 总入口；组合多阶段科研任务 |
| `scholar-search` | 在线文献、专利、作者、引用网络、期刊和数据集 |
| `zotero-research` | 本地 Zotero 检索、匹配、笔记、批注和附件 |
| `paper-reading` | MinerU PDF 解析与正文、公式、表格、图片精读 |
| `academic-citation` | 引用核验、格式化、参考文献和自动引用 |
| `scientific-figure` | 科研图片生成、编辑、评审和矢量化 |

日常使用只需记住 `/pi-scholar`；专用技能也可通过 `/skill:<技能名>` 显式调用。

## 📁 输出结构

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

## ⚙️ 配置

复制 [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) 为 `pi-scholar.config.json`，或放到用户级位置。

配置查找顺序：

1. `PI_SCHOLAR_CONFIG` 指定的文件
2. 可信项目中向上查找的 `pi-scholar.config.json`
3. `~/.config/pi-scholar/config.json`
4. `~/.pi-scholar.json`
5. 内置默认值

环境变量始终优先于 JSON。相对路径按配置文件所在目录解析。

> 📖 所有字段、默认值、范围和环境变量见 [中文配置说明](./docs/CONFIGURATION.md) / [English](./docs/CONFIGURATION.en.md)。

Zotero 中需要开启“允许其他应用程序与 Zotero 通信”。不要将端口 `23119` 暴露到外网。

## 🩺 环境自检

无需先启动 Pi：

```sh
npx @luffysolution/pi-scholar doctor
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

`doctor` 检查 Node 版本、配置发现、Zotero 可达性以及 MinerU/在线服务密钥是否存在，但不会显示密钥内容或读取文献数据。

<details>
<summary>🔒 安全与隐私</summary>

- Zotero 请求硬性限制为 `localhost:23119/api` 或 `127.0.0.1:23119/api`，仅允许 GET 并禁用重定向。
- MinerU 会通过网络接收所选 PDF，只有需要结构化全文、公式、表格或图片时才应调用。
- API Key、Authorization 请求头和签名 URL 不会写入 Markdown、YAML、元数据或工具输出。
- MinerU ZIP 在写盘前检查条目数量、展开大小、加密、符号链接、绝对路径、路径穿越和重复条目。
- 每篇论文先写入临时目录，再原子替换最终目录；失败或取消时恢复原内容。
- 在线检索、自动引用、MinerU 和科研绘图可能消耗配额或积分。

</details>

## 🛠️ 开发与验证

```sh
npm install
npm test
npm run check
npm run pack:check
npm audit --omit=dev
```

测试使用 mock 和临时目录，不会访问真实 Zotero、MinerU 或在线服务。

## 📄 许可证

[MIT](./LICENSE) © Pi Scholar contributors

第三方依赖说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
