# Pi Scholar 1.0.0 实施记录

日期：2026-09-08。

## 来源范围

生产版内置 Semantic Scholar、OpenAlex、PubMed/PMC、arXiv、Crossref、Unpaywall、easyScholar、Materials Project 和 CAS Common Chemistry。Ai4Scholar 原有工具继续保留，但不会在其他来源失败时自动调用。Elsevier/Scopus、Springer、Web of Science 和 Wiley 不在第一方路由中。

CAS Common Chemistry 使用独立 `ChemicalRecord`。统一配置可以保存其 key，但 CAS 的公开资料仍未给出可核验的账户端点、认证头和响应 schema，因此运行时在联网前返回 `contract_blocked`。该状态不会被描述成 SciFinder 文献或反应检索能力。

## 统一配置

`schemaVersion: 3` 为唯一当前 schema。Semantic Scholar、OpenAlex、PubMed、easyScholar、Materials Project、CAS Common Chemistry、Ai4Scholar、MinerU 和绘图服务都支持直接 `apiKey`，也支持 `apiKeyEnv` 和标准环境变量。解析顺序为直接配置、自定义环境变量、标准环境变量。

旧版 `credentialEnv`、`mineru.tokenEnv`、独立 Ai4Scholar 凭据文件和 `config-migrate` 已退出运行路径。`/pi-scholar setup` 现在写入统一配置。状态和诊断只报告凭据是否存在，不显示值。

## Materials Project

MP01-MP17 均有运行时能力记录。工具分工如下：

- `materials_search`：summary 筛选、字段选择、分页和结果预算。
- `materials_get`：按材料 ID 合并可直接寻址的结构与性质；需要任务记录时可从 summary origins 解析 task ID。
- `materials_route_search`：按各路由自己的参数查询电子结构、声子、XAS、电极、EOS、衬底、合金、相似性和合成等集合。
- `materials_advanced`：固定的 `mp-api`/`pymatgen` 结构、能带、DOS、声子、相图和模拟 XRD 操作。
- `materials_export`：JSON、CSV、CIF 和 Markdown，保留查询、单位、字段状态、数据库版本、许可、获取时间和 warnings。

2026-09-08 使用生产 API 做了有界验收。24 个 REST 子路由均返回了合法响应；结构辅助方法、Li-F 相图和本地模拟 XRD 在 `mp-api 0.46.0`、`pymatgen 2026.3.23` 下通过。当前官方 helper 对抽查材料的完整能带、DOS 和声子对象返回对象缺失或服务端/client schema 不兼容。桥接器会将这类情况报告为 `SOURCE_UNAVAILABLE`，不会把 REST 元数据当作完整曲线。机器矩阵见 [`materials-capabilities.json`](./materials-capabilities.json)，人读版本由同一源码生成：[`materials-capabilities.md`](./materials-capabilities.md)。

## 文献服务验收

Semantic Scholar、OpenAlex、arXiv、Crossref、Unpaywall 和 easyScholar 的有界实测通过。PubMed/PMC 适配器通过模拟契约测试；本机到 NCBI 的连接仍可能在 TLS/DNS 阶段失败，因此没有改用非官方端点。easyScholar 只声明本地文档已核验的期刊等级/分区接口。Ai4Scholar 的工具、命令和模拟调用仍在测试套件中。

## 同步与发布

同步继续使用稳定 publication identity、多附件隔离、解析缓存、跨进程 lease、三方内容合并和事务发布。删除、排除、恢复、修复、元数据刷新和重新解析是不同动作。元数据刷新不会上传 PDF；不确定的 MinerU 创建或上传结果不会自动重发。发布失败时保留可恢复版本和 journal，不覆盖用户正文、未知 YAML 或额外文件。

## 发布检查

生产包在发布前执行 TypeScript 检查、完整测试、Materials 能力文档一致性检查、npm 包内容检查、生产依赖审计和 SKILL 校验。发布后再从 npm 安装，检查 CLI 版本、扩展加载和八个内置 SKILL。
