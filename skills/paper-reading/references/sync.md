# Local synchronization decisions

Use the runtime's plan and registered schema; do not infer safety from filenames.

- `up_to_date`: read the existing output. No upload is needed.
- `metadata_changed` or `render_changed`: use a local update/cache path when available.
- `missing`: ordinary import skips the paper. Restore only when the user requests it; a cache miss is a new parsing decision.
- `incomplete`: repair confirmed missing artifacts. Preserve existing edited files.
- `excluded`: ordinary imports skip it. Unexclude only removes the exclusion; it does not authorize downloading.
- `conflict`: retain local text and inspect the generated candidate/difference. Historical output without a reliable baseline remains protected.
- `source_unavailable`: report the unavailable source, PDF, or vault. Do not interpret this as deletion.
- `recovery_required`: resolve the recorded transaction before another publication.

A plan can contain multiple changes. Re-plan if inputs or local files change after planning. Cache clearing is distinct from clearing exclusion records. Parser revision `unknown` means remote algorithm changes cannot be detected automatically. Zotero remains read-only throughout.
