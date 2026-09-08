# Pi Scholar 1.0.0 configuration change

Version 1.0.0 uses `schemaVersion: 3`. It does not read v1/v2 fields and does not provide `config-migrate`. Create a new file from [`pi-scholar.config.example.json`](../pi-scholar.config.example.json) instead of editing the old file in place.

The changes are limited and explicit:

- Literature providers, Materials Project, CAS Common Chemistry, Ai4Scholar, MinerU, and image providers share one configuration file.
- Every keyed service accepts `apiKey` and `apiKeyEnv`. A direct key wins; the standard environment variable is the final fallback.
- `credentialEnv` becomes `apiKeyEnv`, and `mineru.tokenEnv` becomes `mineru.apiKeyEnv`.
- Ai4Scholar no longer depends on a separate `pi-scholar.credentials.json`; `/pi-scholar setup` writes the unified config.
- Materials Project MP01-MP17 is wired through `materials_search`, `materials_get`, `materials_route_search`, and `materials_advanced`.

Complete band structures, DOS, phonons, structure helpers, phase diagrams, and simulated XRD require Python 3.11 or newer with `mp-api` and `pymatgen`. Basic REST queries do not require Python.

```sh
python -m pip install mp-api pymatgen
npm test
npm run check
npm run pack:check
npx @luffysolution/pi-scholar doctor
```

See [`CONFIGURATION.en.md`](./CONFIGURATION.en.md) for environment commands and every field. This release does not delete old files. Archive the old configuration yourself after the new one is verified.
