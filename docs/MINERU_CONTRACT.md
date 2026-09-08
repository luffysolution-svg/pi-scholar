# MinerU contract

Official source: https://mineru.net/apiManage/docs (checked 2026-09-07).
API family: v4 precise parsing. Live account entitlement and PDF uploads were not tested.

The adapter uses `POST /api/v4/file-urls/batch` with `files`, `model_version`, `enable_formula`, `enable_table`, and `language`; the control response contains `code`, `data.batch_id`, and `data.file_urls`. The signed URL receives a raw PDF PUT without the control API's Bearer token. `GET /api/v4/extract-results/batch/{batch_id}` returns `data.extract_result`, terminal state, and `full_zip_url`. Downloads reject redirects and use bounded bodies. Control endpoints are fixed to `https://mineru.net`.

The documented `model_version` is a model selector, not a verifiable server build revision. A missing returned parser revision stays unknown. Application error `-10001` is documented as a service exception with a retry suggestion; confirmed application rejections have bounded retry handling. A lost creation/upload response or HTTP server error cannot prove that the job was not accepted: these return `AMBIGUOUS_SUBMISSION`, without retransmission. Polling and result downloads are read-only retry paths. The overall deadline includes creation, upload, polling, and download.

Validation: `test/mineru.test.ts` exercises successful mocked exchanges, bounded polling, redaction, PDF validation, cancellation, application errors, and uncertain creation/upload responses. Fixtures are synthetic; status is `mock_passed / live_untested`. No real PDF was uploaded.
