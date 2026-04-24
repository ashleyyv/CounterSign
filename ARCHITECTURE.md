# Countersign Architecture

Built as an additive layer on Documenso. New files over modified files wherever possible.

---

## Guiding Constraints (from PRD)

- New routes, new components, new models — don't mutate existing ones
- Feature flags on anything that changes default behavior
- Schema additions only — no renames or removals
- Upstream-mergeable in principle

---

## New Prisma Models

File: `packages/prisma/schema.prisma` (additions only)

```prisma
model DocumentReview {
  id           String   @id @default(cuid())
  documentHash String   @unique
  summary      Json
  flaggedClauses Json
  documentType String?
  createdAt    DateTime @default(now())
}

model SignerPreferences {
  id        String   @id @default(cuid())
  userId    Int      @unique
  targets   Json     // [{ label: string, email: string }], max 3
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id])
}

model ForwardEvent {
  id          String   @id @default(cuid())
  documentId  Int
  senderId    Int
  targetEmail String
  sentAt      DateTime @default(now())
  document    Document @relation(fields: [documentId], references: [id])
  user        User     @relation(fields: [senderId], references: [id])
}
```

---

## New tRPC Router

**New file:** `packages/trpc/server/countersign-router/index.ts`

Procedures:
- `getDocumentReview(documentHash)` — fetch or trigger AI analysis; returns cached result
- `getSignerPreferences()` — return forwarding targets for authed user
- `upsertSignerPreferences(targets)` — save up to 3 forwarding targets
- `forwardDocument(documentId, targetEmail)` — send signed PDF via existing SMTP pipeline; write ForwardEvent
- `getStalePendingDocuments()` — return documents pending >7 days for current user

Register in: `packages/trpc/server/router.ts` (single-line addition)

---

## New Routes

All new files. No existing routes modified structurally.

| Route file | Purpose |
|---|---|
| `apps/remix/app/routes/_recipient+/sign.$token+/intelligence-panel.tsx` | Server action: fetch AI review for document hash |
| `apps/remix/app/routes/_authenticated+/settings.forwarding.tsx` | Forwarding targets settings page |

---

## New Components

All new files under `apps/remix/app/components/countersign/`:

| Component | Used by | Purpose |
|---|---|---|
| `IntelligencePanel.tsx` | signing page | Summary + flagged clauses + diff section |
| `ForwardingButtons.tsx` | completion page | One-tap forward to configured targets |
| `NudgeIndicator.tsx` | dashboard | Visual badge for docs pending >7 days |
| `ForwardingSettings.tsx` | settings.forwarding route | Add/edit/delete forwarding targets |
| `AIDisclaimer.tsx` | IntelligencePanel | "Not legal advice" notice |

---

## AI Layer

**New file:** `packages/lib/server-only/countersign/ai-review.ts`

- Calls Anthropic API (`claude-sonnet-4-6`) with structured JSON output
- Input: document text, document type hint, optional prior document text
- Output: `{ summary: string[], flaggedClauses: Clause[], diff?: DiffItem[] }`
- Cached per `documentHash` in `DocumentReview` model
- Panel hides gracefully if `ANTHROPIC_API_KEY` is not set

---

## Email

**New template:** `packages/email/templates/document-forwarded.tsx`

Reuses existing `sendEmail()` infrastructure. No new SMTP config required.

---

## Files That Need Minimal Modification

These existing files get small, additive changes only:

| File | Change |
|---|---|
| `apps/remix/app/routes/_recipient+/sign.$token+/_index.tsx` | Mount `<IntelligencePanel>` alongside existing document viewer |
| `apps/remix/app/routes/_recipient+/sign.$token+/complete.tsx` | Mount `<ForwardingButtons>` below existing completion UI |
| `apps/remix/app/routes/_authenticated+/dashboard.tsx` | Mount `<NudgeIndicator>` on document rows with pending >7d |
| `packages/trpc/server/router.ts` | Register `countersignRouter` |
| `packages/prisma/schema.prisma` | Add 3 new models |

---

## Files to Leave Untouched

Do not touch auth, billing, teams, org, webhooks, templates, or any existing tRPC routers:

- `packages/trpc/server/auth-router/`
- `packages/trpc/server/admin-router/`
- `packages/trpc/server/team-router/`
- `packages/trpc/server/organisation-router/`
- `packages/trpc/server/webhook-router/`
- `packages/trpc/server/template-router/`
- `apps/remix/app/routes/_authenticated+/settings.*.tsx` (all except the new forwarding file)
- `apps/remix/app/routes/_admin+/`
- `packages/ee/` (enterprise edition)
- `docker/`, `scripts/`, `apps/docs/`, `apps/openpage-api/`
- All existing email templates

---

## Environment Variables

| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | No | Enables AI review panel; panel hidden if absent |

No new infrastructure. Forwarding uses existing `SMTP_*` vars.

---

## Feature Flags

Wrap any behavior that changes Documenso defaults:

```ts
const COUNTERSIGN_ENABLED = process.env.COUNTERSIGN_ENABLED !== 'false'
```

- Intelligence panel: on by default, hidden if no `ANTHROPIC_API_KEY`
- Forwarding buttons: shown only if user has configured targets
- Nudge indicators: always on (purely additive, no default behavior change)

---

## MVP Scope (P0 only)

| Use Case | Model | Procedure | Component | Touched existing file |
|---|---|---|---|---|
| UC1: Intelligence Panel | `DocumentReview` | `getDocumentReview` | `IntelligencePanel` | `sign.$token+/_index.tsx` |
| UC1: Diff (conditional) | — | — | Inside `IntelligencePanel` | — |
| UC2: Forwarding targets | `SignerPreferences` | `upsertSignerPreferences` | `ForwardingSettings` | — |
| UC2: Forward after sign | `ForwardEvent` | `forwardDocument` | `ForwardingButtons` | `sign.$token+/complete.tsx` |
| UC3: Stale nudges | — | `getStalePendingDocuments` | `NudgeIndicator` | `dashboard.tsx` |
| UC4: Self-hoster | — | — | — | — (env var only) |
