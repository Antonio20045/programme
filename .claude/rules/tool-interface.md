# Tool-Interface (OpenClaw AgentTool)

Jedes Tool in `packages/tools/src/` implementiert das OpenClaw `AgentTool`-Interface:

```typescript
interface AgentTool {
  name: string
  description: string
  parameters: JSONSchema          // JSON Schema für Argumente
  execute: (args: unknown) => Promise<unknown>
}
```

Tools werden via LLM-native Function Calling aufgerufen (nicht String-Parsing).
Registrierung über `createOpenClawCodingTools()` in `register.ts`.

Jedes Tool braucht Verhaltens-Tests UND Security-Tests (kein eval, kein unauthorisierter fetch, kein Path Traversal).

## Tool-Caveats

- Tool-Signierung: Ed25519 — `sign-tools.ts` signiert mit libsodium, `verify.ts` prüft mit Node crypto (timingSafeEqual + crypto.verify). Private Key NUR in `.env`, Public Key in `public-key.ts`. Gateway ruft `verifyTool()` vor dem Laden auf.
- Kein fetch() in Tools außer an dokumentierte APIs (Gmail, Calendar, Search)
- Pfad-Validierung gegen Whitelist bei jedem Dateizugriff (Path Traversal Schutz)

## Tool-Signierung

```bash
npx tsx scripts/sign-tools.ts  # Keypair generieren (wenn nötig) + alle Tools signieren
```
