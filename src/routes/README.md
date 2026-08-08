# routes

Express route wiring — maps HTTP verbs/paths to controller methods. No
logic lives here beyond that mapping.

- `webhookRoutes.ts` — `POST /webhooks/:provider`, mounted at `/webhooks`
  in `app.ts`.
