# services

Application/orchestration logic for the webhook ingestion pipeline:
verify signature → normalize → deduplicate → publish. Coordinates the
adapters, repositories, and messaging layers; contains no HTTP concerns
(that's the controller's job) and no provider-specific payload parsing
(that's the adapters' job).

Planned: introduced incrementally alongside Phases 4-8 as each pipeline
step is built.
