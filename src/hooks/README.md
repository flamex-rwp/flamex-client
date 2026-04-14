# `src/hooks`

## Customer domain

Customer-specific logic lives under [`customers/`](customers/index.js). Query keys are centralized in [`src/lib/queryKeys.js`](../lib/queryKeys.js).

## Offline / provider boundary

- **`useOffline()`** is only valid **below** `OfflineProvider` (authenticated `App.js` tree). Pass `enabled: online` into customer queries when the network should not be used.
- **Login** is **outside** `OfflineProvider` and **outside** `QueryClientProvider`. Do not use `useQuery` / `useMutation` on the login screen unless you wrap that branch with its own provider.
- **`QuerySyncBridge`** (inside `QueryClientProvider` + `OfflineProvider`) invalidates `customerKeys.all` after multi-tab sync / data refresh events.
