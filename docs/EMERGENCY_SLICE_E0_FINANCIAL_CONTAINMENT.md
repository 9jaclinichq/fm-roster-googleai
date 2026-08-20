# Emergency Slice E0 — Financial Endpoint Containment

Date: 2026-08-20
Status: source containment applied; **live deployment status UNKNOWN, not yet performed by this change**.

## Vulnerability class

Unauthenticated, unattributed access to financial-side-effect-capable Edge
Functions. Both affected functions are deployed (per their own header
comments) with `--no-verify-jwt` and perform no independent server-side
verification of caller identity, tenant/workforce ownership, or
platform-operator authority before taking action.

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

**UNKNOWN.** This change edits source only. No `supabase functions deploy`
command was run, and none of this change's contents change what is
currently live. **Source containment does not imply live containment** —
the live, previously-deployed versions of these two functions (if
currently deployed) remain exactly as they were, with no server-side
verification, until someone explicitly runs:

```
npx supabase@2.112.0 functions deploy platform-operator-subaccount --project-ref <ref> --no-verify-jwt --use-api
npx supabase@2.112.0 functions deploy payment-checkout --project-ref <ref> --no-verify-jwt --use-api
```

or otherwise redeploys via the Supabase dashboard. Whether these functions
are currently deployed and reachable at all was not established during
DISCOVER and is not established by this record — repository evidence
(detailed header comments referencing a live secret key, and
`payment-checkout`'s pricing being explicitly described as confirmed by the
product owner) is suggestive but not proof of current live state. This
record does not assume exposure, and does not assume safety.

## What remains unresolved

- Live deployment of this containment change has not occurred and requires
  separate, explicit approval.
- Whether the live environment is currently exposed at all remains
  unverified.
- The underlying vulnerability class — no server-verifiable caller/tenant/
  operator identity for privileged or cost-bearing Edge Functions — is not
  fixed by this containment. It is the subject of
  `docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md` (Slice 6, paused pending this
  emergency work).
- `payment-webhook` was explicitly not touched or reviewed for changes in
  this slice.
- The `databaseService.ts` neutral-message mapping is a deliberate,
  temporary simplification (any failure of these specific calls reads as
  "unavailable") and should be reverted to precise error surfacing once
  containment lifts.

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
