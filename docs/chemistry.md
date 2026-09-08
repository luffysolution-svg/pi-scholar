# CAS Common Chemistry 接入边界

[English](./chemistry.en.md)

CAS Common Chemistry 是独立的化学物质数据源，运行时工具为 `chemical_sources`、`chemical_search` 和 `chemical_get`。其 `ChemicalRecord` 只描述名称、CAS RN、同义词、分子式/分子量、SMILES、InChI/InChIKey、来源与许可；它不会转换成文献记录或 Materials Project 材料记录。

CAS 官方公开页面说明 API 接入资料需要提交申请后获取。仓库没有用户账户对应的端点、认证流程和响应 schema，因此当前状态为 `contract_blocked` / `permission_required`：`chemical_sources` 可离线显示状态，查询工具会在联网前失败。这样可以保留正确的数据模型和统一配置入口，同时避免猜测私有契约。

密钥可写在 `data.providers.cas-common-chemistry.apiKey`，也可通过 `apiKeyEnv` 或 `CAS_API_KEY` 提供。凭据存在只说明本地已配置，不会解除契约阻断。

获得 CAS 提供的 API 文档后，后续实现必须验证固定官方 HTTPS 主机、认证头、搜索/详情 schema、限流、许可证和商业使用边界，再把相应 capability 改为 `implemented` 并添加模拟测试；真实账户检查仍需用户显式启用。Common Chemistry 不能被扩展或描述为 SciFinder 的文献、反应、专利、配方或商业来源检索。

官方入口：[Request API Access for CAS Common Chemistry](https://www.cas.org/services/commonchemistry-api)。Common Chemistry 网页标示的公共物质内容使用 CC BY-NC 4.0；具体账户协议和用途仍以 CAS 条款为准。
