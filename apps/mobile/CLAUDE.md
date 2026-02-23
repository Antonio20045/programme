# Mobile App (React Native + Expo)

## Architektur
- Expo Router für Navigation
- Kommuniziert via Cloudflare Relay (packages/relay/) mit Desktop
- E2E verschlüsselt (X25519+XSalsa20 via packages/shared/)

## Kritische Regeln
- Kein direkter Gateway-Zugriff — immer über Relay
- Expo-kompatible Libraries verwenden
- iOS + Android Support berücksichtigen

## Befehle
- `pnpm --filter mobile start` — Expo Dev Server
- `pnpm --filter mobile typecheck` — TypeScript prüfen
