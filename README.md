# 📚 pi-scholar

[![npm version](https://img.shields.io/npm/v/@luffysolution/pi-scholar.svg)](https://www.npmjs.com/package/@luffysolution/pi-scholar)
[![GitHub release](https://img.shields.io/github/v/release/luffysolution-svg/pi-scholar)](https://github.com/luffysolution-svg/pi-scholar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/@luffysolution/pi-scholar.svg)](https://nodejs.org)

🌐 **简体中文** ｜ [English](./README.en.md)

Pi 原生的 TypeScript 科研工作流：整合已验证的 `pi-ai4scholar` 扩展、只读的本地 Zotero 访问，以及 MinerU 官方 Precision API。产出是普通的 UTF-8 Markdown 文件 + 同级 `.assets` 资源目录——**不依赖 Obsidian、Vault、插件或任何数据库**。

> 📦 npm 包名为 **`@luffysolution/pi-scholar`**（带作用域）——不带作用域的 `pi-scholar` 已被一个无关的第三方包占用。命令 `/pi-scholar`、技能 `pi-scholar`、工具 `pi_scholar_parse`、配置文件名 `pi-scholar.config.json` 均不受此影响，只有 npm 包标识变了。

## ✨ 功能一览

- 🔎 **在线检索 + 本地匹配**：复用 `pi-ai4scholar` 做在线文献检索/引用取证，并与本地 Zotero 条目做 DOI/标题精确匹配。
- 🗂️ **完整元数据聚合**：`zotero_item` 一次性给出结构化作者、日期、DOI/ISBN/ISSN、标签、笔记、批注、附件与已选 PDF。
- 🧬 **PDF 深度解析**：`pi_scholar_parse` 调用 MinerU 官方 API，识别公式/表格/版面，提取插图，安全落盘。
- 📝 **干净的 Markdown 输出**：精简 YAML frontmatter + 完整溯源信息旁车文件 `metadata.json`，图片路径开箱即用（对 Obsidian 友好但不依赖它）。
- 🔒 **安全默认值**：Zotero 请求锁死本地回环地址、MinerU 密钥全程脱敏、ZIP 解压前做路径穿越/符号链接校验、发布过程事务化。

## 📦 安装

**环境要求**：Node.js `>=22.19`、Pi `>=0.84.4`、Zotero `7+`（已开启 Local API）、Windows / macOS / Linux 均可。

```sh
pi install npm:@luffysolution/pi-scholar
pi install npm:@luffysolution/pi-scholar@0.1.2        # 指定版本
pi install git:https://github.com/luffysolution-svg/pi-scholar.git#main
pi install ./path/to/pi-scholar                        # 本地持久安装
pi -e ./path/to/pi-scholar                              # 临时开发加载
```

安装后重启 Pi 或执行 `/reload`，然后确认以下工具/命令均可用：`zotero_collections`、`zotero_search`、`zotero_item`、`pi_scholar_parse`、随包引入的 `ai4scholar_search` / `ai4scholar_paper` / `ai4scholar_cite`，以及 `/skill:pi-scholar`。

更新 / 卸载：

```sh
pi update npm:@luffysolution/pi-scholar
pi remove npm:@luffysolution/pi-scholar
```

安装本包会自动带上其锁定测试过的 `pi-ai4scholar` 依赖（仅引入一次，未复制或重写任何 Ai4Scholar 客户端源码）。

<details>
<summary>⚠️ 如果你已经单独安装过 <code>pi-ai4scholar</code>，点此展开必读</summary>

Pi 会独立加载每一个已安装的扩展。如果 `pi-ai4scholar` 已作为独立扩展安装，它和 `pi-scholar` 内置的那份会同时尝试注册相同的 `ai4scholar_*` 工具名，导致 **Pi 完全拒绝加载 `pi-scholar`**（报 "Tool conflicts" 错误）。

请先移除独立安装的版本，再安装/更新 `pi-scholar`：

```sh
pi remove npm:pi-ai4scholar
pi update npm:@luffysolution/pi-scholar
```

</details>

### 💬 `/pi-scholar` 对话命令

安装完成后，在 Pi 聊天框输入 `/pi-scholar` 即可调用。

- **不带参数**：弹出单行输入对话框（"Pi Scholar：你想研究什么？"）。
- **带参数**（如 `/pi-scholar 查找光热催化论文，并匹配本地 Zotero`）：跳过对话框，直接执行。

无论哪种方式，命令都会通过 Pi 的提示词模板展开机制，把请求转发给 `pi-scholar` 技能（等价于 `/skill:pi-scholar ...`），由模型在 Pi 正常的工具权限流程下规划并调用 `zotero_*` / `ai4scholar_*` / `pi_scholar_parse`——**命令本身从不直接访问 Zotero 或 MinerU**。

> 在 print/JSON/非交互式 Pi 模式下（`ctx.hasUI === false`）没有对话框可用，必须把请求作为参数直接传入。

### 🩺 环境自检（`npx` / `npm`，无需 Pi）

包内附带一个零依赖的诊断 CLI，用于在安装到 Pi **之前或之后**检查你的环境。它只做一次有边界的只读可达性探测，不会读取 Zotero 数据，也不能代替 `pi install ...` 完成扩展安装/配置。

```sh
npx @luffysolution/pi-scholar doctor     # 检查 Node 版本、配置发现、Zotero 可达性、MinerU 令牌是否存在
npx @luffysolution/pi-scholar --version
npx @luffysolution/pi-scholar --help
```

> 💡 若在 `pi-scholar` 项目自身目录内运行 `npx`，Node 的本地解析优先级可能导致命令行为异常；在其他任意目录运行则完全正常。

## ⚙️ 配置

所有配置项集中在**一个 JSON 文件**里，涵盖 Zotero 连接、MinerU 解析行为、输出位置、资源命名与标签格式。复制 [`pi-scholar.config.example.json`](./pi-scholar.config.example.json) 为 `pi-scholar.config.json` 并按需修改。

**查找顺序**：`PI_SCHOLAR_CONFIG` 环境变量 → 就近的 `pi-scholar.config.json`（仅可信项目）→ `~/.config/pi-scholar/config.json` → `~/.pi-scholar.json` → 内置默认值。环境变量随时可覆盖 JSON 文件中的对应字段。

> 📖 **完整字段参考、每个选项的默认值/取值范围/环境变量名，请查阅 [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)（[English](./docs/CONFIGURATION.en.md)）。**

Ai4Scholar 相关配置由其自身管理，与本文件无关：`/ai4scholar setup`、`AI4SCHOLAR_API_KEY`、`AI4SCHOLAR_BASE_URL` 等。

别忘了在 Zotero 设置里开启 **允许其他应用程序与 Zotero 通信**。所有 Zotero 请求都是无认证的本地回环 GET，且禁用重定向；切勿把 23119 端口暴露到公网。

## 🔍 工作原理

<details>
<summary>点此展开详细行为说明</summary>

**`zotero_collections`** 可以列出收藏夹、读取收藏夹元数据，或列出收藏夹下的顶层条目。

**`zotero_item`** 把原始记录映射为一个类型化的 `Paper`：完整的向前兼容父级元数据、结构化作者、原始日期/年份、DOI/ISBN/ISSN、出版信息字段、标签/收藏夹、子笔记/附件、PDF 子项批注、全文索引可用性，以及已选 PDF。当父条目明显信息稀疏时，只有在 Zotero 中存在**恰好一条**标准化标题与第一作者都相同的未删除条目时，才会补全缺失的文献字段，并记录来源条目键、字段与原始元数据以供溯源。未显式指定附件键时，按键排序选取第一个 PDF 并在结果中说明。标识符匹配优先使用标准化 DOI，其次是标准化标题/年份；**不会**向 Zotero 写回任何内容。

**`pi_scholar_parse`** 校验 `%PDF-` 文件头、计算 SHA-256、向 MinerU 请求签名上传地址、用 PUT 上传原始字节、带退避策略轮询状态、下载并安全检查返回的 ZIP、修复本地图片链接，并以事务方式发布结果。生成的文件名格式为 `FirstAuthor+Year+Title.md`；缺失的部分用 `UnknownAuthor`、`UnknownYear` 或 `Untitled` 填充。跨平台非法字符与文件名分隔符 `+` 会被替换为空格，保留设备名会加前缀，UTF-8 长度有上限。文件名冲突用 ` (2)`、` (3)` 等后缀区分——**从不**使用 Zotero 键。是否已经解析过，通过 YAML 中的 `zotero://select/...` 深链识别（旧版 `zotero_key` 字段仍可读取）。

YAML frontmatter 刻意保持精简，只包含非空、常用于查询的文献字段，加上 Zotero/附件身份信息与解析时间；空字段、原始对象、笔记、批注、附件数组、详细解析参数均不出现在其中。完整的、路径安全的溯源信息——包括选中的原始 Zotero 元数据、任何精确匹配的补全来源、笔记、批注、附件、MinerU 参数——写入同级的 `.assets/metadata.json`；全文索引内容和本地文件系统路径不会重复存储。Zotero 条目与已选 PDF 分别以可点击的 `zotero://select/...` 和 `zotero://open-pdf/...` 链接出现在 frontmatter 中。图片使用显式相对路径，如 `![](<./<document>.assets/figure-01.jpg>)`，因此当 Markdown 文件与同级资源目录一起复制时，空格与 Unicode 文件名也能在 Obsidian 中正确渲染。资源目录后缀、图片前缀、元数据文件名与文件名分隔符均可配置。frontmatter 标签在元数据旁车文件中保留原始形式，而面向 Obsidian 的值会把空白和不受支持的标点替换掉（默认用 `-`）；例如 `frustrated Lewis pairs` 会变成 `frustrated-Lewis-pairs`，`Ni/NiOx@C` 会变成 `Ni/NiOx-C`。

MinerU 会通过网络接收 PDF 内容，请自行了解其隐私政策；MinerU 与 Ai4Scholar 均有用量配额，可能产生费用。令牌、Authorization 头与签名 URL 从不写入输出或 YAML。工具输出统一限制在 50KB / 2000 行以内。

</details>

## 🔒 安全说明

- Zotero 访问在代码层面被硬性限制为 `http://localhost:23119/api` 或 `http://127.0.0.1:23119/api`，仅允许 GET，且禁用重定向——即便扩展本身被攻破或配置错误，也无法访问任意主机或修改你的文献库。
- MinerU 请求必须使用 HTTPS 且不含内嵌凭据；签名上传/下载 URL、Bearer 令牌与原始错误响应体，会从所有抛出的错误与工具输出中脱敏。
- 下载的 MinerU 结果压缩包在解压前会先做校验（中央目录检查、条目数/大小上限、拒绝符号链接/加密条目、拒绝路径穿越/绝对路径、拒绝重复条目），确保写盘前的安全性。
- 发布解析结果是事务化的：先在临时暂存目录完成全部工作，只有新内容完全写入后才替换已有文件；中途崩溃或取消会恢复到发布前的状态，不会留下半成品的 `.md` / `.assets`。
- 运行时不依赖本项目自身的 registry 账号：`pi-ai4scholar` 被锁定到精确版本并随包捆绑，即使上游发布被攻破或撤回，也不会静默改变已安装版本的行为。

## 🛠️ 开发

```sh
npm install
npm test
npm run check
npm run pack:check
npm pack --dry-run
```

测试全部基于 mock 与临时文件，**不会**联网访问真实的 Zotero 或 MinerU。

<details>
<summary>🚀 发布流程（维护者参考）</summary>

1. 在 `package.json` 中升级 `version`，如有需要同步更新 README 中带版本号的安装示例，本地运行 `npm run prepublishOnly`（`npm publish` 前也会自动执行）。
2. 打标签并推送：`git tag vX.Y.Z && git push origin main --tags`，随后从该标签创建 GitHub Release：`gh release create vX.Y.Z --generate-notes`。
3. 发布到 npm：`npm publish`（包已设置作用域并标记 `"publishConfig": {"access": "public"}`，无需额外的 `--access` 参数）。
4. 发布公告前，先在一个临时 Pi 会话中用 `pi install npm:@luffysolution/pi-scholar@X.Y.Z` 验证安装无误。

</details>

## 📄 许可证

[MIT](./LICENSE) © pi-scholar contributors

第三方依赖与致谢见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
