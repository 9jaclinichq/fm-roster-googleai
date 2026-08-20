# Workspc Product Constitution

Version 1.0 — 2026-08-20 (proposed, unreviewed)

## 0. Purpose and authority

This document is the highest-authority statement of what Workspc *is for* and
*is not for*. It defines product direction and boundaries, not implementation
details, schema, or UI layout.

Where this document and `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` disagree,
**this document governs**. The Living System document is preserved as a
historical/architectural/longer-horizon reference — it remains useful for its
five-layer architecture model, event vocabulary, and module-boundary thinking,
but it no longer sets product direction where it conflicts with this
Constitution. Its self-contained/no-external-system principle (§9 of that
document) is superseded here: Workspc integrates rather than recreates
commodity capability (§6). Its two named reasoning engines belong to a
different, unrelated sibling product and must not be silently imported into
this repository's architecture, code, or documentation.

This Constitution sits above `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` and
below `AGENTS.md`'s source-of-truth ordering rule (implementation reality is
always the top authority on what *exists*; this document is the top authority
on what Workspc is *for*). `docs/REGISTRY.md`, module scoping docs, and
implementation plans must not contradict it without an explicit, reviewed
amendment to this document first.

This is a living document. Amendments follow the same
`DISCOVER → PLAN → HUMAN REVIEW → IMPLEMENT → VERIFY → DIFF REVIEW` workflow
as code, with an incremented version number and a dated changelog entry.

---

## 1. Product category

Workspc is a multi-tenant **professional operations and intelligence
platform for healthcare organisations and their workforce**.

It is not primarily a generic AI productivity workspace, a chatbot, or a
document tool that happens to serve healthcare. Healthcare is the initial
domain. Terminology and platform primitives must not assume that every
member is a doctor, resident, consultant, department, or hospital —
healthcare organisations include departments, training programmes,
professional associations, and teams whose members hold many kinds of
professional roles.

## 2. Customer model: organisation-first / B2B2C

Workspc's initial go-to-market and primary monetisation model is
organisation-first/B2B2C. Healthcare organisations, departments, training
programmes, professional bodies, and teams operate Workspc as tenants, and
this is the primary path by which Workspc is sold and adopted.

Independent professional identities and personal, non-organisational use
remain legitimate. Individual professionals hold persistent identities
independent of any one organisation, and may participate in multiple
organisations or workspaces over time, or use Workspc without belonging to
one at all. An individual's personal identity and an organisation's
institutional data are related but distinct — see §14.

## 3. Multi-professional neutrality

No platform-level concept, table, route, or piece of copy may assume a
single profession. "Doctor" is one instance of "member," not the model
itself. This applies going forward to new platform-level abstractions.

It does **not** require an immediate rename of existing profession-specific
implementation. Existing doctor-specific tables, routes, and working
subsystems may continue operating behind an evolutionary boundary until a
separately scoped, reviewed migration is justified (§17). New platform-level
work must be profession-neutral from the start; old working systems are not
retrofitted on this document's authority alone.

## 4. Business model: Free = Operate, Paid = Automate

The operating platform is substantially free. **Operating Workspc — using
its structured state, forms, workflows, and deterministic intelligence to
run professional operations — is free or fair-use.** AI assistance that a
user actively triggers is not, by itself, a reason to charge.

**Paid value comes from Workspc operating *alongside* the organisation
through persistent, delegated automation**: scheduled monitoring, conditional
monitoring, automatic follow-up, recurring workflow execution, multi-step
automation, and delegated actions taken without the user re-initiating every
execution (see §11 for authority levels).

`Free = Operate / Paid = Automate` is the governing value principle, not a
contractual promise that every manual capability must be unlimited and free
forever. Workspc may place fair-use/resource limits on, or charge for,
enterprise governance, high-cost infrastructure, storage, premium
integrations, support, or similar capabilities without abandoning
persistent automation as the primary paid value.

This is a locked target model. The current billing system, which gates
content creation behind a paid plan, is legacy/transitional relative to this
model. It is not being rewritten as part of adopting this Constitution;
automation-based monetisation requires its own design and a safe migration
path before the current model changes.

## 5. What Workspc owns

Workspc owns professional and organisational state and workflow wherever
ownership is necessary to operate the professional system:

- professional identity
- organisations / workspaces
- memberships
- roles, groups, and permissions
- forms and workflow pipelines
- workforce state
- professional scheduling / roster logic
- training and progression
- assessments and rubrics
- meetings → decisions → actions
- professional projects
- events
- approvals
- audit and history
- organisational rules
- institutional memory
- intelligence and automation layered over the above

## 6. What Workspc integrates rather than recreates

Where mature commodity capability already exists, Workspc integrates it
instead of rebuilding it natively:

- Google/Microsoft documents and cloud storage
- email
- general-purpose calendars
- video conferencing
- reference managers and literature services
- advanced statistical environments
- payment rails
- foundation AI models
- external communication platforms

A native fallback inside a Workspc-owned workflow is justified only when it
directly supports state or process that Workspc itself owns (§5) — never as
a parallel general-purpose version of a commodity tool.

## 7. What Workspc deliberately does not build

Workspc is deliberately **not**:

- a generic AI chatbot
- a generic task manager
- a generic notes application
- a word processor
- a cloud drive
- an email client
- a general messenger or social network
- a video-conferencing platform
- a full HR/payroll system
- an EHR/EMR or patient-management system
- a reference-manager clone
- a generic LMS
- a foundation-model company
- a generic Zapier clone

Any existing or proposed capability that reads as one of the above is a
boundary conflict and must be reassessed (kept only with a specific
professional-workflow justification, integrated, hidden, or retired) — not
grown further by default.

## 8. System-of-record / workflow / state positioning

Workspc is the authoritative system of record for the professional and
organisational state it owns (§5): who belongs to which organisation, in
what role, doing what work, with what history. Commodity tools it integrates
(§6) may hold content, but Workspc holds the workflow state, permissions,
and audit trail that make that content meaningful in a professional context.
If an external integration is disconnected, Workspc must preserve the
authoritative workflow state, relationships, status, permissions, and audit
record it owns for that work — losing the integration should degrade
convenience, not destroy that record. Workspc does not need to duplicate
the externally owned document/content bytes themselves merely to keep the
external content permanently available; content ownership can remain with
the integrated system while Workspc's own state about it survives.

## 9. AI as replaceable reasoning infrastructure

AI is reasoning infrastructure, not the moat. Workspc's durable value is:

**structured professional state + workflows + organisational rules + events
+ permissions + longitudinal institutional memory + safe automation.**

The architecture should allow Workspc eventually to be operated through
external interfaces (a general-purpose assistant, a chat client, another
vendor's model) without surrendering authoritative state, permissions,
actions, or audit history. No feature should be designed such that it only
works with one specific model provider.

## 10. Intelligence philosophy: deterministic-first, ambient

Prefer deterministic software and rules over LLM reasoning wherever a
deterministic answer exists. Reserve AI for genuine reasoning, drafting, and
pattern-recognition tasks it is actually suited to.

Workspc's intelligence should primarily be **ambient and contextual**, not
chatbot-first: surfaced as state and actions inside the work someone is
already doing, not as a conversation someone has to start. Examples of the
target shape: "8 workforce submissions outstanding," "potential Saturday
coverage gap," "3 assessments awaiting review," "4 meeting actions overdue."
A chat interface may exist as one entry point among several, not the primary
one.

## 11. Automation authority: A0–A3, and human-reserved actions

A Workspc Automation is a persistent instruction that observes authorised
professional state and/or time, evaluates conditions, and prepares or
performs actions without the user initiating every execution. Persistent
delegated automation is the principal paid capability described in §4.

The A0–A3 authority model below is a conceptual capability ladder, not a
billing construct — it applies regardless of billing status. Free and paid
tiers may draw the line at different authority levels, but the levels
themselves are not defined by price.

Conceptual authority levels, from least to most autonomous:

- **A0 Observe** — surfaces state; takes no action.
- **A1 Recommend** — surfaces a specific suggested action; a human acts.
- **A2 Prepare and request approval** — drafts/stages the action; a human
  approves before it takes effect.
- **A3 Execute within explicitly delegated rules** — acts autonomously,
  strictly within rules a human has explicitly delegated in advance.

Consequential professional decisions remain human-controlled. Automation
acts through authorised domain capabilities/actions, never by writing
directly to underlying tables or bypassing the permission and event model.
Every automated execution must be attributable to the automation that
performed it and auditable after the fact — an execution with no
attributable actor is not a permitted shape, regardless of authority level.

## 12. First wedge and future domains

The first production focus is **Workforce Operations**. The free workflow
this wedge must ultimately support, end to end:

```
organisation/membership
  → workforce collection
  → submissions
  → availability/leave/posting state
  → follow-up
  → roster creation/editing
  → review/publication
  → history
```

Paid automation can later automate recurring collection, reminders,
escalation, exception detection, roster preparation, and other delegated
steps in this same chain.

Research, training/professional development, meetings → decisions → actions,
and other professional workflows are legitimate future horizontal domains.
They must be built by reusing horizontal platform primitives (§13), not by
becoming independent mini-apps that each duplicate their own identity, task,
file, permission, AI, deadline, and automation systems. Workforce is the
first wedge, not the whole of Workspc's architecture.

## 13. Conceptual platform primitives

The following are conceptual targets for reasoning about the platform, not a
mandate to create new tables or a single mega-schema. Map existing and new
work against these concepts; consolidate opportunistically, not by big-bang
rewrite (§17).

**Identity** — Person, Organisation, Membership, Role, Group, Workspace.

**Professional workflow** — Workflow, Workflow Instance, Form/Submission,
Action, Assignment, Rule, Deadline, Status.

**Governance/state** — Event, Permission, Approval, Audit Record.

**Knowledge** — Artifact, Comment/reference relationship.

**Automation** — Trigger, Condition, Automation, Execution.

A unified professional state is a conceptual model for reasoning about
consistency across domains — it is not a requirement to merge domain-specific
tables that are working well as they are.

## 14. Data ownership, tenancy, and privacy principles

- One persistent person can belong to multiple organisations.
- Organisation membership is contextual and temporal.
- **Organisation boundaries are hard backend security boundaries** — this is
  a product requirement, not an eventual nice-to-have, and is a prerequisite
  for onboarding any second real paying organisation (see the tenancy
  recovery specification called for under §17).
- Roles and permissions are contextual; role *names* are not a substitute
  for explicit capabilities.
- Organisation/workspace data remains with the organisation when a member
  leaves it. Personal data remains with the person.
- Some professional achievements may eventually have controlled, portable
  representations that travel with the person across organisations.
- Visibility and ownership are different concepts and must not be conflated
  in access logic.
- Personal integrations (§6) do not automatically become organisation
  integrations, and vice versa.
- AI receives the minimum necessary authorised context for the task at hand.
  Cross-organisation reasoning must never leak one organisation's state into
  another's.
- Workspc minimises patient/clinical data and must not casually evolve into
  an EHR (§7).
- Automation authority derives from explicit human or organisational
  delegation (§11); it is never assumed.
- Audit history must survive ordinary membership changes — a person leaving
  or a role changing must not erase the record of what happened while they
  held it.

## 15. V1 discipline

Not every existing module belongs in V1. The likely V1 production focus is:

- Home / Needs Attention
- Workforce
- Roster
- minimal operational Announcements
- Organisation administration
- the underlying forms/workflows that support the above
- the identity/membership/permission/event/audit foundations necessary to
  run them safely across more than one tenant
- an eventual Automation entry point

Every other existing module must be explicitly assessed against this V1
focus, not assumed in or out. Non-V1 capabilities are deliberately parked,
not deleted by default, and require explicit review before further
development. The specific classification taxonomy used to assess and track
that disposition belongs to the Registry/V1 reconciliation work, not to
this Constitution.

## 16. Responsive UX direction

Follow `docs/UI_UX_PRINCIPLES.md` for durable UI constraints. In summary:

- mobile-first, not mobile-only; one responsive component system spans
  phone, tablet, and desktop.
- The product reads as professional and operational, not playful or
  decorative.
- A premium dark/glass/electric visual language may differentiate the
  experience, but immersive effects are restrained and never at the cost of
  routine work.
- Routine forms, tables, and administration stay fast, clear, and
  information-dense — this is operational software first.
- Intelligence surfaces as useful state and actions (§10), not decorative
  AI chrome.
- No hardcoded single-tenant or single-profession assumptions anywhere in
  the UI layer, per §3.

## 17. Evolutionary, not big-bang

Every gap between current implementation and this Constitution is closed
evolutionarily:

- Prefer additive scaffolding and adapters over rewriting working systems.
- A working system stays authoritative and in production until its
  replacement is reviewed, scoped, and proven — not deprecated the moment a
  better model is agreed on.
- Cross-cutting changes that touch schema, RLS, auth, tenancy, or billing
  are scoped as their own dedicated specification and reviewed separately
  from the product-direction decision that motivated them. Naming a target
  direction here does not itself authorize the schema/RLS/auth/billing work
  needed to reach it.
- Where this Constitution implies a boundary an existing subsystem doesn't
  yet meet (profession-neutral naming, contextual roles, hard tenant
  isolation, automation-based billing), the existing subsystem may continue
  operating unchanged behind that boundary until its own reviewed migration
  lands.
- **Evolutionary preservation does not override security, privacy,
  data-integrity, or regulatory blockers. A subsystem identified as unsafe
  for a proposed use must be remediated before that use proceeds.** In
  particular, the existing institutional tenant-isolation gap (§14) must be
  resolved before onboarding a second real organisation — evolutionary
  preservation does not extend to continuing to sell or operate multi-tenant
  isolation that is already known not to hold.

---

## Changelog

- **v1.0 (2026-08-20)** — Initial draft, encoding the locked business
  foundation and its associated human decisions. Proposed; not yet reviewed
  or committed.
