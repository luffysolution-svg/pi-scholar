# CAS Common Chemistry 化学数据源

[English](./chemistry.en.md)

Pi Scholar 注册了三个 CAS Common Chemistry 工具：

- `chemical_sources`：离线查看化学数据源配置与当前状态。
- `chemical_search`：根据化学名称、CAS 号或结构式检索物质。
- `chemical_get`：根据 CAS 注册号（CAS RN）获取完整的物质记录。

查询结果使用 `ChemicalRecord`，字段包括化学名称、CAS RN、同义词、分子式、分子量、SMILES、InChI、InChIKey、来源和许可。

## 当前状态

CAS Common Chemistry 的 API 资料需要申请后获取。当前版本没有接入查询端点，因此 `chemical_search` 和 `chemical_get` 返回 `contract_blocked` 或 `permission_required`，不会发送网络请求。`chemical_sources` 可用于查看状态。

配置文件接受 `apiKey`、`apiKeyEnv` 或 `CAS_API_KEY`，但当前版本不会使用该凭据发起查询。

## 数据范围

CAS Common Chemistry 提供常见物质的名称、标识符和基础理化信息，不包含 SciFinder 文献、反应机理、专利分析、合成配方或试剂采购信息。

## 官方链接与授权

- 官方 API 申请入口：[Request API Access for CAS Common Chemistry](https://www.cas.org/services/commonchemistry-api)。
- 许可协议：Common Chemistry 公开网页数据采用 CC BY-NC 4.0 许可，实际调用时的权限与商业用途以 CAS 官方协议为准。
