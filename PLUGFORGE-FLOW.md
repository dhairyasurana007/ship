# PlugForge — Basic Flow

```mermaid
flowchart TD
    Client(["Developer / CLI / App"])

    subgraph Auth ["OAuth 2.0"]
        Authorize["/oauth/authorize\nConsent screen"]
        Token["/oauth/token\nAccess + refresh tokens"]
    end

    subgraph PublicAPI ["/api/v1/ — Public Boundary"]
        Middleware["Bearer token check\nScope enforcement\nRate limiting"]
        Resources["Documents · Issues · Sprints"]
        OpenAPI["/api/v1/openapi.json"]
    end

    subgraph Domain ["Domain Services"]
        DocService["Document Service"]
        EventBus["IEventBus\n(publishes events)"]
    end

    subgraph Webhooks ["Webhook Pipeline"]
        Signer["HMAC Signer\nShip-Signature: t=…,v1=…"]
        Retry["Retry Scheduler\n1s → 4s → 16s → 1m → 5m → 30m"]
        DLQ["Dead-Letter Queue\n(after 6 failures)"]
    end

    DB[("PostgreSQL")]

    SDK["@ship/sdk\nShipClient · verifyWebhook()"]

    Receiver(["Webhook Receiver\n(Slack, GitHub, custom)"])

    Client -->|"1. authenticate"| Authorize
    Authorize --> Token
    Token -->|"2. bearer token"| Middleware
    Middleware --> Resources
    Resources -->|"3. calls"| DocService
    DocService -->|"4. writes to"| DB
    DocService -->|"5. publishes event"| EventBus
    EventBus -->|"6. signs & delivers"| Signer
    Signer --> Retry
    Retry -->|"success"| Receiver
    Retry -->|"6 failures"| DLQ
    DLQ -->|"manual replay"| Receiver
    SDK -->|"wraps"| PublicAPI
    Client -->|"uses"| SDK
```

## Flow in plain English

1. **Authenticate** — the app goes through OAuth (`/oauth/authorize` → `/oauth/token`) and receives a scoped bearer token. CLI uses Device Flow; web apps use Auth Code + PKCE.
2. **Call the public API** — every request to `/api/v1/*` passes through bearer token validation, scope enforcement, and rate limiting before reaching a resource handler.
3. **Domain work** — the resource handler delegates to an internal domain service (e.g. Document Service) which reads/writes PostgreSQL.
4. **Event published** — on any write, the domain service publishes an event onto `IEventBus` (never the route layer).
5. **Webhook delivery** — the event is matched to subscriptions, HMAC-signed (Stripe-style `Ship-Signature` header), and delivered with exponential-backoff retries. After 6 failures, the delivery lands in the Dead-Letter Queue for manual replay.
6. **SDK** — `@ship/sdk` wraps the public API so consumers never call raw HTTP. `verifyWebhook()` lets receivers verify signatures in one line.
