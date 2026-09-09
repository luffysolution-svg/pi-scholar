# Materials Project 能力说明

[English](./materials-capabilities.en.md)

本页概述 Pi Scholar 已接入的 Materials Project 功能。字段、筛选器、端点和限制的实时清单可通过 `materials_capabilities` 查看；该工具不发送网络请求。

下列 17 项能力均已实现。实测状态描述本项目的验证结果，不代表账号一定有权访问每种数据。

## 能力概览

| ID | 功能 | 入口工具 | 验证状态 |
|---|---|---|---|
| MP01 | 材料概览检索 | `materials_search` | 已通过在线实测 |
| MP02 | 晶体结构获取 | `materials_get`<br>`materials_advanced`<br>`materials_export` | 已通过在线实测 |
| MP03 | 热力学数据 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP04 | 常用概览性质 | `materials_search` | 已通过在线实测 |
| MP05 | 能带结构 | `materials_get`<br>`materials_route_search`<br>`materials_advanced` | REST 已实测；样本未返回 Python 对象 |
| MP06 | 态密度 | `materials_get`<br>`materials_route_search`<br>`materials_advanced` | REST 已实测；样本未返回 Python 对象 |
| MP07 | 磁性 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP08 | 弹性 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP09 | 介电与压电性质 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP10 | 声子 | `materials_route_search`<br>`materials_advanced` | REST 已实测；样本未返回 Python 对象 |
| MP11 | 光学与 XAS | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP12 | 嵌入电极 | `materials_route_search` | 已通过在线实测 |
| MP13 | 来源与计算任务 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP14 | 局部结构描述 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP15 | 其他材料数据集合 | `materials_get`<br>`materials_route_search` | 已通过在线实测 |
| MP16 | 本地导出 | `materials_export` | 已通过本地测试 |
| MP17 | 本地派生计算 | `materials_advanced` | 已通过本地测试 |

## 如何选择工具

| 工具 | 用途 |
|---|---|
| `materials_capabilities` | 离线查看能力、字段、筛选器和凭据状态 |
| `materials_search` | 按化学式、元素、带隙、稳定性等条件筛选概览记录 |
| `materials_get` | 按材料 ID 获取结构或指定性质 |
| `materials_route_search` | 查询使用任务 ID、光谱 ID、电极条件等专用筛选器的数据集合 |
| `materials_advanced` | 获取完整能带、态密度或声子对象，并执行相图和模拟 XRD 计算 |
| `materials_export` | 将已获取记录导出为 JSON、CSV、CIF 或 Markdown；不联网 |

## 使用限制

- MP05、MP06 和 MP10 的 REST 元数据已通过实测，但抽样时官方 Python helper 未返回完整对象。工具会保留 REST 结果并报告 helper 错误。
- `materials_route_search` 按数据集合验证筛选器。Materials Project 的 `available_fields` 不能直接视为可搜索字段。
- 相图标记为 0 K、0 atm 的本地推导结果；模拟 XRD 不属于实验数据。
- CIF 导出需要有限晶格和位点数据。计算稳定性也不等同于实验可合成性。

## 凭据与数据

Materials Project 凭据按 `apiKey`、`apiKeyEnv` 指向的变量、`MP_API_KEY` 的顺序读取。`X-API-KEY` 只发送到 `https://api.materialsproject.org`，不会写入 URL、导出文件或状态输出。

返回值会区分未请求、服务端缺失、不支持和请求失败。比较材料时还应保留单位、计算方法、任务 ID、数据库版本和警告。

## 官方文档

- [开始使用](https://docs.materialsproject.org/downloading-data/using-the-api/getting-started)
- [查询数据](https://docs.materialsproject.org/downloading-data/using-the-api/querying-data)
- [进阶用法](https://docs.materialsproject.org/downloading-data/using-the-api/advanced-usage)
- [示例](https://docs.materialsproject.org/downloading-data/using-the-api/examples)
- [大批量下载说明](https://docs.materialsproject.org/downloading-data/using-the-api/tips-for-large-downloads)
