# CAS Common Chemistry 化学数据源

[English](./chemistry.en.md)

Pi Scholar 内置了 CAS Common Chemistry 化学物质数据支持，提供以下三个工具：

- `chemical_sources`：离线查看化学数据源配置与当前状态。
- `chemical_search`：根据化学名称、CAS 号或结构式检索物质。
- `chemical_get`：根据 CAS 注册号（CAS RN）获取完整的物质记录。

查询结果使用独立的 `ChemicalRecord` 结构，包含化学名称、CAS RN、同义词、分子式、分子量、SMILES、InChI/InChIKey，以及数据来源与许可信息。化学记录与普通文献、材料数据相互独立，不会混淆。

## 接口状态与权限说明

CAS 官方要求在提交申请后才提供 API 详细资料与接入规范：

- 当前扩展已设计好完整的数据结构与配置项，但在获得官方正式规范前，查询工具默认不发起外网请求（状态显示为 `contract_blocked` / `permission_required`），以避免盲猜或调用不稳定的私有端点。
- 你可以在配置中提前保存 API Key（通过 `apiKey`、`apiKeyEnv` 或环境变量 `CAS_API_KEY`），配置好的密钥会在本地妥善保存。
- 待官方接口规范开放并接入后，工具即可无缝切换为可用状态。

## 检索范围说明

CAS Common Chemistry 的收录范围为常见化学物质的基础物理与化学标识信息。需要留意：

- 该服务**不包含** SciFinder 的学术文献、化学反应机理、专利分析、配方合成或商业试剂来源检索。

## 官方链接与授权

- 官方 API 申请入口：[Request API Access for CAS Common Chemistry](https://www.cas.org/services/commonchemistry-api)。
- 许可协议：Common Chemistry 公开网页数据采用 CC BY-NC 4.0 许可，实际调用时的权限与商业用途以 CAS 官方协议为准。
