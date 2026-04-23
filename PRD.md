Countersign PRD
Project: Countersign — decision and action support for signers, on top of Documenso Owner: [Your Name] (lead) Team: Ashley, Raj, Rich Date: [Date]

Problem
E-signature tools are built for senders. Signers click a link, sign, and disappear — with no help deciding whether to sign and no way to act on what they signed after.
Documenso, DocuSign, and DocuSeal all ship this pattern. Signers are technically supported, strategically ignored.
Proposed Solution
Countersign gives signers two things Documenso doesn't: decision support before signing, action support after.
Before: an AI review panel with a plain-English summary and flagged clauses — with baseline context from standard documents of the same type. When the signer has prior documents from the same counterparty, the panel adds a diff showing what changed.
After: one-tap forward to pre-configured contacts (accountant, lawyer, archive), plus nudges on pending documents that have sat too long.
Built as an additive layer on Documenso — upstream-mergeable in principle.
Users & Needs
Primary: Signers — the person receiving and signing a document.
 Secondary: Senders — they benefit when their counterparties sign faster and more confidently. 
Key needs:
As a signer, I need to understand what I'm agreeing to before I sign, because I'm not a lawyer.
As a signer, I need to know which clauses are standard and which are unusual, especially on my first document of a given type.
As a signer, I need a copy to reach the people in my life who also need it (accountant, lawyer, archive) without manually forwarding.
As a signer with pending documents, I need a reminder when something's been sitting too long.
As a self-hoster, I need all of this inside my instance — privacy is the reason I self-host.
Top 3 MVP Value Props
 Know what you're signing. A pre-sign AI review panel gives a plain-English summary and flags clauses of interest. No lawyer required.
Catch what's unusual. The panel compares clauses against standard documents of the same type ("this non-compete is broader than typical"). When you've signed with this counterparty before, it also shows what changed.
Send it where it needs to go. Pre-configure up to three forwarding targets once. After signing, tap "Send to my accountant." Signed copy lands in their inbox in seconds.
Goals & Non-Goals
Goals:
Thesis legible end-to-end in a 2-minute demo.
Three functional features that prove the decision-support + action-support framing — each one works for every signer on every document.
Additive layer on Documenso, not a fork.
Non-Goals:
Full workflow automation. Documenso has webhooks and Zapier. We don't compete there.
Smart or AI-driven forwarding. Stays deliberately simple.
Cross-document relationship summaries beyond pairwise diff. V2 territory.
Rebuilding the existing signer dashboard. We enhance it, not replace it.
Native mobile apps. V1 is responsive web only.
Requirements
Legend: [P0] = MVP, [P1] = polish if time allows, [P2] = V2+
Use Case 1: Signer understands what they're about to sign
Before signing, the signer opens the document and gets real help — a summary, flagged clauses with baseline context, and when applicable, a diff against prior documents from the same counterparty. Copy throughout the signing page is rewritten to acknowledge the signer as a user.
Intelligence panel (baseline)
[P0] Panel appears alongside the document during signing
[P0] Three-bullet plain-English summary of the document
[P0] Flagged clauses of interest with baseline context — each flagged clause includes a note on whether it's standard or unusual relative to documents of the same type (non-competes, auto-renewals, governing law, indemnification, unilateral modification rights)
[P0] Clear disclaimer that this is not legal advice
[P0] Review cached by document hash; loads async and never blocks the signing UI
[P1] Collapsible with remembered preference
[P1] Scoped chat for questions about the document
Document diff (conditional enrichment)
[P0] When the signer has prior signed documents from the same counterparty, the panel adds a diff section
[P0] Diff highlights changed clauses in plain English ("Non-compete extended from 1 year to 2 years")
[P0] Signer can click to see the prior document for reference
[P0] When no prior documents exist, the diff section is hidden entirely — the baseline panel stands on its own
[P1] Signer can select which prior document to compare against if multiple exist
[P2] Side-by-side visual diff view
Signing-page copy
[P0] Copy on the signing page acknowledges the signer as a user (welcoming, explanatory, not transactional)
Use Case 2: Signer forwards a signed document
After signing, the signer can route a copy to pre-configured contacts in one tap. Post-sign copy is rewritten to sell the value of the Countersign account and the forward feature.
Configuring forwarding targets
[P0] Claimed signer can configure up to 3 named forwarding targets in profile settings
[P0] Each target has a label and an email address
[P1] Signer can edit or delete targets
Forwarding after signing
[P0] Post-sign screen shows configured targets as one-tap buttons
[P0] Tap sends signed PDF via Documenso's existing email pipeline
[P0] Confirmation shown after send
[P1] Forward event logged for audit
[P2] Ad-hoc forwarding to addresses not in the pre-configured list
Post-sign and invitation copy
[P0] Rewritten post-sign account prompt — sells the benefit (see all your signed docs, forward easily, free) instead of generic "create account"
[P0] Rewritten signing-invitation email copy — plants the account value proposition before the signer opens the document
Use Case 3: Signer acts on stale pending documents
A signer has documents awaiting their signature. When one sits too long, the dashboard surfaces it. Empty dashboard copy is rewritten to acknowledge the signer as a user.
Nudges
[P0] Documents pending signer's signature > 7 days surface with a visual indicator in the dashboard
[P0] Indicator shows how long the document has been pending
[P1] Optional email reminder after 14 days
[P2] User-configurable nudge thresholds
Empty dashboard copy
[P0] Empty dashboard state rewritten to acknowledge both sending and receiving — no longer sender-centric
Use Case 4: Self-hoster deploys Countersign
[P0] Runs inside the Documenso deployment — no separate service
[P0] AI provider env vars documented; intelligence panel hides gracefully if none configured
[P1] Admin toggle for Countersign features
[P2] Per-team or per-organization settings
Appendix
Technical approach: Extends the existing Documenso codebase (TypeScript, React Router, Prisma, tRPC) as an additive layer. New Prisma models: DocumentReview (cached AI analyses), SignerPreferences (forwarding targets, nudge settings), ForwardEvent (audit log). AI layer uses the Anthropic API with structured JSON output, cached per document hash — prompts ask for both baseline clause analysis and, when a prior document is provided, diff analysis. Forwarding reuses the existing SMTP pipeline — no new infrastructure.
Ground rules for upstream-mergeability:
New files over modified files wherever possible
New routes, new components, new models — don't mutate existing ones
Feature flags on anything that changes default behavior
Schema additions only (new models, optional fields) — no renames or removals
Open questions:
Review panel default-on vs. opt-in (leaning default-on with disclaimer)
How to handle baseline comparison when document type is ambiguous (e.g., a custom contract that doesn't cleanly fit "NDA" or "services agreement")
Forwarding-target behavior on account deletion (default: soft-delete, void pending)
Future (V2):
Counterparty Intelligence — cross-document evolution summaries per counterparty ("You've signed 4 NDAs with Acme Corp; here's how the terms have shifted over time.")
Signer-side webhook and automation layer
Cross-instance signer identity
Resources:
https://github.com/documenso/documenso
https://docs.documenso.com

End of PRD v3.


