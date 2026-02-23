# Channel-Adapter Interface (OpenClaw ChannelPlugin)

Unser In-App Channel in `packages/gateway/channels/in-app.ts` implementiert:

```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk"

// ChannelPlugin<TAccount, TProbe> mit diesen Pflicht-Feldern:
const inAppPlugin: ChannelPlugin<InAppAccount, InAppProbe> = {
  id: "in-app",
  meta:         { /* label, docs, blurb */ },
  capabilities: { /* chatTypes, media, reactions */ },
  config:       { /* list, resolve, create, delete accounts */ },
  security:     { /* dmPolicy, pairing, allowlists */ },
  gateway:      { /* startAccount, logoutAccount */ },
  outbound:     { /* sendText, sendMedia */ },
}

// Registrierung im Plugin-Entry:
// api.registerChannel({ plugin: inAppPlugin as ChannelPlugin })
```

Siehe `docs/openclaw-analyse.md` Abschnitt 3 für vollständiges Telegram-Beispiel.
