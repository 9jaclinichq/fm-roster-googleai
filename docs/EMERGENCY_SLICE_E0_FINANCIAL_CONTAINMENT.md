# Emergency Slice E0 — Financial Endpoint Containment

Date: 2026-08-20
Status: source containment applied and **live containment deployment completed
2026-08-20**. Both affected functions are confirmed `ACTIVE` running the
contained source (see "Live deployment status" below).

- Source containment commit: `24045df`
- Documentation correction commit: `bb76e2b`

## Vulnerability class

Unauthenticated, unattributed access to financial-side-effect-capable Edge
Functions. Both affected functions' own source headers document an
*intended* `--no-verify-jwt` deployment (a manual CLI instruction in a
comment, not an enforced or automatically-applied setting) — **current live
deployment status is unknown, not confirmed by source alone** (see "Live
deployment status" below). Regardless of live deployment status, the source
as written performs no independent server-side verification of caller
identity, tenant/workforce ownership, or platform-operator authority before
taking action.

## Affected functions

- `supabase/functions/platform-operator-subaccount/index.ts` — creates a
  live Paystack subaccount (a financial payout/settlement destination)
  using caller-supplied bank account details, with no verification that the
  caller is an authorised platform operator.
- `supabase/functions/payment-checkout/index.ts` — initialises a live
  Paystack/Flutterwave checkout session and inserts a `pending`
  `user_subscriptions` row against a caller-supplied `tenant_id`/
  `workforce_id`, with no verification that the caller owns or represents
  that target.

## Containment decision

Both functions now return an unconditional fail-closed response —
`{"error": "financial_feature_temporarily_unavailable"}`, HTTP 503 — as the
first statement reached after standard method/OPTIONS handling, before any
credential read, input parsing, service-role client creation, provider
`fetch`, or database mutation. This is **containment, not a fix**: no
temporary shared-code, custom-token, or client-side gate was introduced: no
new security mechanism was added at all — the functions are simply disabled
for financial side effects until real server-verifiable authorization
exists.

`src/lib/databaseService.ts`'s three wrapper functions
(`provisionTenantWithSubaccount`, `initiatePaymentCheckout`,
`initiateTenantPlanCheckout`) were updated to surface a fixed neutral
message on any failure of these specific calls (`Payment setup is
temporarily unavailable.` / `Payments are temporarily unavailable.`)
instead of attempting to parse the Edge Function's response body — the
exact `supabase-js` non-2xx response shape was not verified during
DISCOVER, so no code here depends on it. This mapping is explicitly marked
`E0 TRANSITIONAL` in-line and should be reverted (restoring real
error-detail surfacing) once containment is lifted.

## Live deployment status

**Live containment deployment completed 2026-08-20.** Performed manually
from Windows PowerShell (the Git-Bash `supabase` CLI in the primary
development sandbox was non-functional — segfaulted on every invocation,
including a no-network `--version` check — so deployment was carried out
from a working PowerShell environment instead, using the reviewed contained
source from commit `24045df`). No tooling was reinstalled or upgraded to
accomplish this.

| Function | Status | Version | Updated at (UTC) |
|---|---|---|---|
| `platform-operator-subaccount` | `ACTIVE` | 2 | 2026-08-20 05:31:34 |
| `payment-checkout` | `ACTIVE` | 7 | 2026-08-20 05:31:51 |

`payment-webhook` was **not** redeployed and remains unchanged at version 5,
updated 2026-08-14 22:24:10 UTC — confirming this containment action did not
touch it.

**Containment was verified through Supabase deployment metadata only** (the
status/version/timestamp table above) — **no function URL was invoked and
no provider request was made** as part of this verification, consistent
with this record's and Slice E0's own constraints throughout.

**Source containment and this live deployment are the same fail-closed
behaviour now in effect live** — both functions return
`{"error": "financial_feature_temporarily_unavailable"}` (HTTP 503) before
any credential read, input parsing, service-role client creation, provider
`fetch`, or database mutation, for every caller, unconditionally.

## What remains unresolved

- **The underlying authentication vulnerability remains unresolved.** Live
  containment stops the financial side effects; it does not add real
  caller/tenant/operator verification. That remains the subject of
  `docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md` (Slice 6, paused pending this
  emergency work).
- **Re-enablement remains prohibited until real, server-verifiable
  authorization exists** — see "Requirement for re-enablement" below,
  unchanged by this deployment.
- `payment-webhook` was explicitly not touched, redeployed, or reviewed for
  changes in this slice.
- The `databaseService.ts` neutral-message mapping is a deliberate,
  temporary simplification (any failure of these specific calls reads as
  "unavailable") and should be reverted to precise error surfacing once
  containment lifts.
- Whether the pre-containment live versions (prior to version 2 / version 7
  above) were ever actually exposed/exploited remains unverified and out of
  this record's scope — this record documents the containment action taken,
  not an incident forensic analysis.

## Requirement for re-enablement

**Neither function may be restored to its prior (uncontained) behaviour
until real, server-verifiable authorization exists** — a verified Supabase
Auth principal (or an equivalent mechanism reviewed and approved on its own
merits) checked server-side before any credential read, provider call, or
database mutation, per the target model in
`docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md`. Re-enablement is not permitted
via a shared code, a client-side gate, or any other mechanism this record's
own containment decision already rejected.

No secret values are recorded in this document. No exploit or attack
walkthrough is recorded in this document.

## Addendum — containment-scope correction (2026-08-30)

`scripts/verify-e0-containment.cjs`'s static tripwire originally included a
"no other Edge Function changed" check scoped to the entire
`supabase/functions/` tree — failing if *any* file changed anywhere under
it besides these two functions' own `index.ts`. Re-reading this record in
full during a separate governance task found no basis in the actual E0
decision above for that breadth: the "Requirement for re-enablement"
section is explicit that it is these two functions, not Edge Functions as a
category, that may not be restored/changed without formal review. The
directory-wide form meant a genuinely unrelated new Edge Function (e.g. a
roster-management feature with no connection to payments) could never pass
this check for the life of the deployment freeze, which was never this
record's intent.

The check now derives its protected paths from
`.workspc-engineering/protected-surfaces.json`'s `e0-financial-containment`
entry (`supabase/functions/payment-checkout/**` and
`supabase/functions/platform-operator-subaccount/**`) and fails only on a
change matching one of those two paths — modified, deleted, or a new file
introduced inside either directory. It still passes/fails independently of,
and in addition to, the two per-file fail-closed-ordering checks this
script has always performed. The deployment freeze
(`.workspc-engineering/freeze.json`) and push guardrail (`.githooks/pre-push`)
are unrelated, separate concerns and were not touched by this correction —
see `scripts/verify-e0-containment.cjs`'s own header and
`scripts/verify-e0-containment-scope.cjs` for the deterministic tests
proving both the narrowed scope and that nothing else here was weakened.

Nothing in this addendum changes the "Requirement for re-enablement" above,
the affected-functions list, or the containment decision itself.
