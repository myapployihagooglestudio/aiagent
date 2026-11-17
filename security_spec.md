# Omnia AI Security Specification (Firestore Rules Phase 0)

## 1. Data Invariants
1. **Owner-Only Access**: Only the verified owner account (`mirzayevulugbek024@gmail.com` with `request.auth.token.email_verified == true`) may read or mutate operational metadata via the client SDK.
2. **No Secret Storage in Client-Readable Firestore**: Bot tokens, webhook secret tokens, and Gemini API keys are strictly prohibited in Firestore documents.
3. **Account Isolation**: Contacts and conversations under `/accounts/{accountId}` must strictly match `accountId in ['account_a', 'account_b']` and `data.accountId == accountId`.
4. **Server-Only Infrastructure Collections**: `/message_queue` and `/dedup` are locked (`allow read, write: if false;`) to client SDKs and written solely by Firebase Admin SDK on the backend.
5. **Immutable Audit Logs**: Audit logs cannot be updated or deleted by clients; client writes are disallowed (server-only logging) or strictly append-only by verified admin.
6. **Terminal Approval State Lock**: Once a `pending_approvals` record transitions to `'approved'`, `'rejected'`, or `'expired'`, subsequent client updates are blocked.

## 2. Dirty Dozen Adversarial Test Payloads
1. **Unauthenticated read on `/accounts/account_a`** -> Expected: `PERMISSION_DENIED`.
2. **Unverified email spoof (`email == 'mirzayevulugbek024@gmail.com'`, `email_verified == false`)** -> Expected: `PERMISSION_DENIED`.
3. **Unauthorized user (`other@example.com`, `email_verified == true`) listing `/audit_logs`** -> Expected: `PERMISSION_DENIED`.
4. **Shadow field injection on `/accounts/account_a` (`{ ...valid, botToken: "123:ABC" }`)** -> Expected: `PERMISSION_DENIED` (`hasOnly` rejection).
5. **Oversized `personaPrompt` (> 4000 chars) on `/accounts/account_a`** -> Expected: `PERMISSION_DENIED`.
6. **ID Poisoning on `/accounts/invalid_account_c` or 500-char ID** -> Expected: `PERMISSION_DENIED`.
7. **Cross-account mismatch (`accountId: "account_b"` inside `/accounts/account_a/contacts/123`)** -> Expected: `PERMISSION_DENIED`.
8. **Client timestamp forgery (`updatedAt != request.time`)** -> Expected: `PERMISSION_DENIED`.
9. **Client write to `/message_queue/job1`** -> Expected: `PERMISSION_DENIED`.
10. **Client write to `/dedup/key1`** -> Expected: `PERMISSION_DENIED`.
11. **Mutating terminal `pending_approvals` doc after `status == 'approved'`** -> Expected: `PERMISSION_DENIED`.
12. **Mutating or deleting `/audit_logs/{logId}` from client** -> Expected: `PERMISSION_DENIED`.
