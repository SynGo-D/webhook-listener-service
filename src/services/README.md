# services

`WebhookIngestionService.ingest()` orchestrates the pipeline: verify
signature → check the event is supported → extract delivery ID →
[Phase 7: deduplicate] → normalize → [Phase 8: publish]. Contains no HTTP
concerns (the controller's job) and no provider-specific payload parsing
(the adapters' job) — it only sequences calls to the adapter it gets from
`ProviderHandlerFactory`.
