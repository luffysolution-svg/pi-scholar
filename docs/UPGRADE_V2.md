# Pi Scholar 1.0.0 配置切换

1.0.0 使用 `schemaVersion: 3`，不再读取 v1/v2 字段，也不提供 `config-migrate`。请从 [`pi-scholar.config.example.json`](../pi-scholar.config.example.json) 新建配置，不要直接修改旧文件后继续使用。

主要变化：

- 文献、Materials Project、CAS Common Chemistry、Ai4Scholar、MinerU 和绘图服务共用一份配置。
- 需要凭据的服务都支持 `apiKey` 和 `apiKeyEnv`。直接配置优先，标准环境变量作为最后回退。
- `credentialEnv` 改为 `apiKeyEnv`，`mineru.tokenEnv` 改为 `mineru.apiKeyEnv`。
- Ai4Scholar 不再依赖单独的 `pi-scholar.credentials.json`；`/pi-scholar setup` 写入统一配置。
- Materials Project 的 MP01-MP17 已接入。独立路由使用 `materials_route_search`，完整对象和本地派生计算使用 `materials_advanced`。

如果使用 Materials Project 的完整能带、DOS、声子、结构辅助方法、相图或模拟 XRD，请安装 Python 3.11 以上、`mp-api` 和 `pymatgen`。基础 REST 查询不依赖 Python。

```sh
python -m pip install mp-api pymatgen
npm test
npm run check
npm run pack:check
npx @luffysolution/pi-scholar doctor
```

环境变量命令和完整字段说明见 [`CONFIGURATION.md`](./CONFIGURATION.md)。本版本不会删除旧配置文件；确认新配置可用后，再由用户自行归档旧文件。
