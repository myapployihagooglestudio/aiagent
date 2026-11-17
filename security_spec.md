# Omnia AI Security Specification (Production Firestore Rules & Server Isolation)

## 1. Data Invariants
1. **Owner-Only Access**: Only the verified owner account (`mirzayevulugbek024@gmail.com` with `request.auth.token.email_verified == true`) may read or mutate permitted collections via client SDKs.
2. **Immutable Numeric Owner Lock**: In Telegram runtime, `TELEGRAM_OWNER_USER_ID` (and preconfigured `ownerTelegramId`) enforces strict owner access. Unconfigured bots NEVER grant owner takeover to strangers sending `/start` or connecting Business accounts.
3. **No Secret Storage in Firestore**: Bot tokens, webhook secret tokens, and Gemini API keys are strictly prohibited in Firestore documents.
4. **Memory & User Isolation**: `scope == 'owner'` memories and `memorySummary` are strictly restricted to `bot_direct` and are NEVER injected into `business_chat` prompts with external contacts. Per-user profiles live under `/user_profiles/{userId}` and language preferences under `/user_preferences/{userId}`.
5. **Server-Only Infrastructure Collections**: `/message_queue` and `/dedup` are locked (`allow read, write: if false;`) to client SDKs and written solely by Firebase Admin SDK with atomic transactions and delivery checkpoints.
6. **Immutable Audit Logs**: Audit logs cannot be updated or deleted by clients.
7. **Terminal Approval State Lock**: Once a `pending_approvals` record transitions to `'approved'`, `'rejected'`, or `'expired'`, subsequent client updates are blocked.

## 2. Adversarial Security Checks
1. **Unauthenticated read on `/system/bot_settings`** -> Expected: `PERMISSION_DENIED`.
2. **Unverified email spoof (`email == 'mirzayevulugbek024@gmail.com'`, `email_verified == false`)** -> Expected: `PERMISSION_DENIED`.
3. **Unauthorized user (`other@example.com`, `email_verified == true`) listing `/audit_logs`** -> Expected: `PERMISSION_DENIED`.
4. **Shadow field injection on `/system/bot_settings`** -> Expected: `PERMISSION_DENIED` (`hasOnly` rejection).
5. **Oversized `personaPrompt` (> 4000 chars) on `/system/bot_settings`** -> Expected: `PERMISSION_DENIED`.
6. **Client write to `/message_queue/job1`** -> Expected: `PERMISSION_DENIED`.
7. **Client write to `/dedup/key1`** -> Expected: `PERMISSION_DENIED`.
8. **Client write to `/user_profiles/{userId}` or `/user_preferences/{userId}`** -> Expected: `PERMISSION_DENIED`.
9. **Mutating terminal `pending_approvals` doc after `status == 'approved'`** -> Expected: `PERMISSION_DENIED`.
10. **First-stranger `/start` when `TELEGRAM_OWNER_USER_ID` is unset** -> Expected: rejected safely (no owner hijack).
