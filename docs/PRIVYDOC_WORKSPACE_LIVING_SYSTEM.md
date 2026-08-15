# PrivyDoc Workspace
## Living professional workspace for doctors: architecture context for Claude Code

Read this before touching any file in this repo. It explains what PrivyDoc Workspace is trying to be, how the parts relate, and the rules every fix must respect. Treat it like the exploded-view drawing in a patent: one unit, many components, every component numbered and wired to the whole.

---

## 1. What this system is

PrivyDoc Workspace is the professional home of a doctor, and of any doctor-led organisation. Not the patient, not the clinical encounter: the working life around it — scheduling, forms, records, academic and research work, communication, administration, billing. It is built to serve any kind of doctor organisation, not one specialty or one training structure: a hospital department, a residency programme, a private clinic, a group practice, a diagnostic centre, a telemedicine outfit, a professional association, a research unit, or a single doctor with no organisation at all. The first live tenant happens to be a hospital family medicine department; the product is not shaped around that tenant, and no module should assume hospital, residency or any other single setting.

It serves two kinds of doctor:

- **Organisational members**: doctors inside an organisation. The organisation configures the workspace, provisions members, and owns the org's module instances (its scheduling patterns, its forms, its submissions, its meetings, whatever its own workflow needs).
- **Individual doctors**: solo users with no affiliation. They get a personal workspace (their own writing space, research tracks, scheduling/forms for themselves, learning log) and can opt in to an organisation later, or belong to several.

Everything a doctor does here is watched over by two engines that behave like a mentor and a coordinator: **PrivyBrain-2** (academic and clinical-writing mind) and **BabsBrain-2** (operational mind). Their job is to turn what the doctor records into what the doctor needs next.

Operator: 9JaClinic Limited. Product owner: Dr Babatunde Olanipekun. Domain: workspace.privydoc.com.ng (open question: fold into privydoc.com.ng; see section 10). Stack: Vite/React frontend, Node/Express backend, Supabase, Flutterwave.

Design intent, in one line: **from the smallest form field to the whole organisation, from static AI helpers to autonomous learning agents, everything runs as one living professional workspace — configurable to whatever kind of doctor or doctor organisation is using it.**

---

## 2. Tenancy: the skeleton

Get this right first; every module hangs off it.

```
Platform (PrivyDoc Workspace, operated by 9JaClinic)
 └── Organisation (hospital dept, clinic, practice, association, any structure) tenant
      ├── Org admin(s)                                role
      ├── Groups (org-defined: units, roles, teams, seniority bands — org admin names these) groups
      ├── Members (doctors)                           identity
      └── Enabled modules + module instances + config per-tenant
 └── Individual doctor (self-tenant)                   tenant of one
      └── Enabled modules (limited set) + opt-in link to an org
```

Rules:
- Every row in every table carries `tenant_id`. RLS enforces it. No cross-tenant reads, ever.
- An individual doctor is a tenant of one. Opting in to an org creates a membership; it does not move their personal data.
- The tenant's name and branding are org-configured and appear only after a tenant is selected or a member is signed in, never on the neutral landing.
- Names in the sign-in dropdown come from the tenant's member list, provisioned by an org admin. Individuals register themselves.
- Access codes are per member, masked on entry, rate-limited, hashed at rest. Loose enough for members on the move, tight enough that the member list is not a directory anyone can browse.
- Groups are org-defined vocabulary, not a fixed hierarchy. An org admin names and structures its own groups (e.g. "registrars/SRs/consultants" for a hospital department, "associates/partners" for a practice, "north branch/south branch" for a multi-site clinic). No module hard-codes a group name.

---

## 3. Anatomy: the body plan

Think in five layers. Every file in the repo belongs to exactly one layer and speaks to adjacent layers through defined contracts, never by reaching across.

```
┌──────────────────────────────────────────────────────────────┐
│ L5  FACES      landing | doctor workspace | org admin |      │
│                platform operator admin (/#admin)             │
├──────────────────────────────────────────────────────────────┤
│ L4  ORGANS     the 10 workspace modules (section 7)         │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ L3  SPINE      event bus + unified doctor record (UDR) +     │
│                tenant config + rules + audit                 │
├──────────────────────────────────────────────────────────────┤
│ L2  ENGINES    PrivyBrain-2 (academic) | BabsBrain-2 (ops)   │
├──────────────────────────────────────────────────────────────┤
│ L1  AGENTS     static → reasoning → acting → deciding →      │
│                learning autonomous                           │
└──────────────────────────────────────────────────────────────┘
```

**L5 Faces** render and dispatch intents. No business logic.
**L4 Organs** are modules with one job, one contract, one registry entry. Modules never import each other. They publish and subscribe.
**L3 Spine** is the single source of truth: unified doctor record, tenant configuration, rules, notifications, audit.
**L2 Engines**: PrivyBrain-2 reads the doctor's academic and clinical-writing state and produces guidance (writing structure, research/academic-track progress, learning gaps, feedback on drafts). BabsBrain-2 reads operational state and produces action (scheduling gaps, overdue submissions, meeting items, payment status, compliance).
**L1 Agents** live inside engines and only ever write to the spine.

---

## 4. The intelligence ladder

Every AI-touching component must declare its rung. Do not let a component quietly climb rungs; that is how autonomy leaks into places without guardrails.

| Rung | Name | Example here | Human gate |
|---|---|---|---|
| 0 | Static AI | Draft a case write-up section from notes | Doctor edits before save |
| 1 | Reasoning | Score a write-up against a chosen structure/standard; detect a scheduling conflict | Shown as suggestion |
| 2 | Acting | Send a reminder to members with an unfilled monthly form; propose a roster swap | Approve/deny |
| 3 | Deciding | Auto-assign a duty slot under org policy; escalate an overdue audit to HOD | Policy defines auto vs gated |
| 4 | Learning | Tune reminder timing from response rates | Admin reviews policy diffs |

Rules: rung is declared in the agent manifest; rungs 2 to 4 emit `agent.action.proposed` before `agent.action.executed`; cooldowns live on the agent record, not the UI; nothing above rung 1 acts across tenants.

---

## 5. Unified doctor record

The UDR is the bloodstream. Modules do not keep private copies of a doctor's group, schedule, submissions or academic progress.

```
udr.identity      (id, name, group/role labels (org-defined), org memberships[], verified flags)
udr.tenant        (active tenant, role, enabled modules)
udr.instances[]   (module_id, instance_id, tenant_id, config)   one row per form/track/roster created
udr.entries[]     (instance_id, member_id, payload, status, ts, agent_ref)   submissions and records
udr.pipelines[]   (instance_id, pipeline_id, input, output_ref, ran_at)   e.g. form → roster
udr.academic      (tracks[] with stages, cases[], CME credits[])
udr.meetings[]    (meeting_id, items raised, actions owed)
udr.billing       (plan, tenant or individual, invoices[], flutterwave refs[])
udr.insights[]    (agent_id, rung, text, action, cooldown_until, dismissed_at)
udr.audit[]       (who, what, when, why)
```

Every module writes here with `source` and `agent_ref`. Every insight anywhere is a `udr.insights[]` row.

---

## 6. Event vocabulary

```
member.provisioned          member.signed_in         member.opted_in_org
instance.created            instance.configured      pipeline.ran
entry.submitted             entry.overdue            entry.reviewed
roster.published            roster.swap.requested    roster.conflict.detected
track.stage.advanced        writing.draft.saved      writing.reviewed
cme.credit.logged           meeting.item.raised      meeting.action.owed
payment.succeeded           plan.changed
insight.generated           insight.dismissed        insight.acted
agent.action.proposed       agent.action.executed    agent.policy.updated
tenant.created               module.enabled           module.configured
```

---

## 7. Component registry

Every module, face component and agent gets an entry in `docs/REGISTRY.md` (create it if absent). When you touch a file that is not in the registry, add it. When you split a module, split the entry. When you delete, remove it.

Registry entry shape:

```
### <ID> <Name>
layer:        L1 | L2 | L3 | L4 | L5
face:         landing | doctor | org-admin | operator-admin | shared
path:         src/...
owner engine: privybrain-2 | babsbrain-2 | none
rung:         0..4 (agents only)
tenant scope: platform | org | individual | any
consumes:     [events or UDR fields it reads]
emits:        [events it publishes]
udr fields:   [fields it reads/writes]
gates:        [human approvals required]
status:       stable | fixing | fragmented | stub
```

Seed it with the parts below. Confirm paths against the codebase before writing them.

**Landing / sign-in**: tenant selector (orgs + "I am not affiliated"), member selector, access-code entry, "Access my workspace", "Organisational Admin Portal", "Create a new organisation".

**The 10 workspace modules (L4).** The current names and tabs live in the dashboard of the running app; confirm against `src/` and keep the count at 10. Each is one organ with one registry entry.

**The one rule that matters most: a module is a capability, never a use case, and never named after one organisation's workflow.** A monthly schedule form that parses into a duty roster is *one instance* of the Forms & pipelines module, the way one Google Form is one instance of Google Forms. A dissertation tracker is *one instance* of the Research & academic tracks module. A private clinic's shift form, a diagnostic centre's equipment log, a professional association's membership renewal form are equally valid instances of the same modules. If a module is hard-wired to a single use case or a single kind of organisation, that is the fragmentation to fix: lift the use case out into a configurable instance and leave the module generic underneath. No module name, field label, or default template may assume hospital, residency, or any other specific setting — those live in instance config, supplied by the org admin or the individual, never in the module's code.

Every module therefore ships four things:

```
builder      org admin (or individual) creates and configures instances
             (a new form, a new research track, a new roster pattern)
instances    the concrete things members interact with
data         submissions / entries, always in the UDR with tenant + instance ids
pipelines    parsers, computations and outputs attached to an instance
             (form → roster is one pipeline; form → attendance,
             form → audit tally, form → CME credit are others)
agent hooks  what PrivyBrain-2 / BabsBrain-2 read from and write to
```

| # | Module (capability) | Example instances across different org types (not limits) | Owner engine |
|---|---|---|---|
| 1 | Dashboard | insight strips, module tiles, tenant switcher — same shell for a hospital dept, a clinic, or a solo doctor | both |
| 2 | Forms & pipelines | hospital: monthly schedule form → duty roster; clinic: shift request → staffing plan; practice: intake audit; association: membership renewal; any org: feedback, incident report, leave request | BabsBrain-2 |
| 3 | Scheduling | duty roster, on-call, clinic sessions, branch coverage, equipment/room booking — whatever unit of time or resource the org schedules | BabsBrain-2 |
| 4 | Clinical & professional writing | case write-ups, clerking templates, SOPs, protocols, referral letters, any structured clinical document a doctor drafts | PrivyBrain-2 |
| 5 | Research & academic tracks | a dissertation, an audit/QI project, a publication, a grant, an exam or viva track — any staged piece of academic or research work | PrivyBrain-2 |
| 6 | Learning & development | CME/CPD log, journal club, exam prep, onboarding checklist, skills sign-off | PrivyBrain-2 |
| 7 | Meetings & actions | departmental meetings, partner meetings, committee meetings, board meetings, with an action tracker for any of them | BabsBrain-2 |
| 8 | Messages & broadcasts | announcements, reminders, organisation-wide or group-targeted notices | BabsBrain-2 |
| 9 | Profile & memberships | identity, org-defined group/role labels, org links, verification | none |
| 10 | Billing & plans | Flutterwave, org and individual plans, seat management | BabsBrain-2 |

Individual tenants get a limited subset (forms and scheduling for self, professional writing, research tracks, learning log, profile, billing). Org tenants can enable any of the 10, create as many instances per module as they need, and configure each instance's fields, labels, workflow stages and outputs to fit their own kind of practice.

### Customisation tooling (who configures what)

Two distinct toolsets, both built on the same builder/instance/pipeline model in section 7:

- **Org admin customisation**: create and edit module instances for the whole org (new form, new schedule pattern, new research-track template, new meeting series); define the org's own groups and role labels; set which modules are enabled; set per-group or per-member permissions on each instance; brand the tenant; configure org-wide pipelines and integrations (below).
- **Individual customisation**: create and edit their own instances (personal forms, personal research tracks, personal scheduling); connect their own integrations (their own reference manager account, their own writing space); set personal notification and privacy preferences. Individual customisation never edits or is visible to an org unless the individual is a member and explicitly shares an instance into that org.

Both toolsets are UI over the same registry-backed instance model — there is one customisation engine, exposed with different scopes (`tenant scope: org` vs `tenant scope: individual`).

### External and native tool integrations

Several modules are stronger with a connected tool than reinvented from scratch. Build these as an **integrations layer**, not baked into a module:

```
integrations.catalog[]      (integration_id, name, category, native|external, auth type)
integrations.connections[]  (tenant_id or member_id, integration_id, scope, status, ref)
```

Seed categories, mapped to the module(s) that consume them:

| Integration | Category | Feeds |
|---|---|---|
| Statistical analyser (native or connected, e.g. R/Python backend, or a hosted stats tool) | analysis | Research & academic tracks |
| Literature search tool | research | Research & academic tracks, Clinical & professional writing |
| Literature/evidence matrix builder | research | Research & academic tracks |
| Reference manager (e.g. Zotero/Mendeley-style, native or connected) | citation | Clinical & professional writing, Research & academic tracks |
| Word-processing / long-form writing space (native rich-text editor, or connected to an external doc tool) | writing | Clinical & professional writing, Research & academic tracks |
| Calendar / video conferencing | scheduling | Scheduling, Meetings & actions |
| E-signature | documents | Forms & pipelines, Clinical & professional writing |
| Payment processor (Flutterwave, already integrated) | billing | Billing & plans |

Rules for integrations:
- An integration is never required to use the module it feeds; the module degrades to a native basic version without it (e.g. a plain text field stands in for the writing space until a doc tool is connected).
- Auth and API keys are stored per connection (`integrations.connections`), scoped to the tenant or member that authorised them — never shared across tenants.
- An integration writes into the UDR through the same `udr.entries[]` / `udr.pipelines[]` shape as any native module output, tagged with the `integration_id`, so PrivyBrain-2 and BabsBrain-2 can read its output without knowing it came from outside the app.
- New integrations register in `integrations.catalog` and get a registry entry like any other component (section 7), with `owner engine` set to whichever engine consumes their output.

**Org admin**: members & groups, module enablement & config, instance builder (forms/schedules/tracks/meetings), submissions & audits, broadcasts, integrations, org billing.
**Individual customisation**: personal instance builder, personal integrations, notification & privacy preferences.
**Platform operator admin (/#admin)**: organisations, individual users, module catalog, integrations catalog, plans & pricing, system status, audit, feature flags.
**Spine**: event bus, UDR, tenant config service, rules console, notification dispatcher, audit stream, access-code service, integrations service.
**Engines**: PrivyBrain-2 (writing structurer, academic-track tracker, learning-gap finder, writing reviewer), BabsBrain-2 (submission chaser, schedule analyser, meeting-action tracker, payment watcher, compliance checker).

---

## 8. Seeded templates and integrations catalog

Claude Code asked what to seed the template library and integrations catalog with. Answer: seed it wide and generically, then layer one account's real, in-progress work on top as *instance data*, never as module code. The two are answered separately below and must stay separated in the repo.

### 8.1 A reusable primitive: the scored rubric

Several very different documents in professional life turn out to be the same shape: a sectioned form where each item is graded on a fixed scale, sections total to a threshold, and a final score maps to a recommendation. Fellowship dissertation and proposal assessments are one example; so are OSCE mark sheets, credentialing checklists, competency sign-offs, audit scorecards, and peer-review forms in any field. Build this once as a **Scored Rubric** primitive inside Forms & pipelines, not as a one-off "dissertation form":

```
rubric.template     (id, name, sections[], scale definition, pass logic)
rubric.section       (name, items[], max points, pass threshold, "all items required" flag)
rubric.item          (label, guidance text, scale (e.g. 0-3, 0-2, 0-10), weight)
rubric.instance       (rubric_template_id, subject_ref, assessor, scores[], section_totals, final_score, recommendation)
```

Pipeline: `rubric.instance` submitted → BabsBrain-2 computes section totals, applies pass thresholds, flags any zero-scored required item, proposes the recommendation band → org admin or assessor confirms. This one primitive, configured differently, covers a dissertation proposal assessor's guide, a full dissertation assessment (with per-chapter word-count checks and a defence sub-score), an OSCE station, a credentialing audit, or a journal's peer-review form. None of that domain knowledge lives in code; it lives in the rubric template's sections and items, supplied as seed data (8.2) or authored by any org admin.

### 8.2 Global seed template library (available to every tenant, exhaustive over time)

These ship as default, editable instances of existing modules — not new modules, not hard-coded logic. An org admin or individual can use one as-is, clone and edit it, or ignore it. Keep this library growing; it is meant to be broad, not scoped to any one specialty.

**Research & academic tracks**
- Fellowship/postgraduate dissertation track: proposal → corrections → data collection → write-up → defence, as a staged track with a title-page template, a corrections-synopsis template, and a scored-rubric instance at each review point.
- Case-based portfolio / casebook: a multi-case container (title page, declaration, certification, list of cases by theme, abbreviations, reference values) holding many individual case instances.
- Individual clinical case template: presenting complaint → history (presenting complaint, review of systems, past medical/surgical, drug/allergy, family & social history with genogram/ecomap) → examination by system → provisional and differential diagnosis → management → dated follow-up entries. Usable for any specialty, any training programme, any case-based learning requirement — not specific to one college or one discipline.
- Case-selection guide: a short structured prompt set (why this patient, what clinical area, what evidence guided the intervention, family/social context, illness experience, relevant discipline-specific tools, relevant interventions) plus an optional case-mix planner (a table of theme vs. count) for programmes that require a spread of cases across domains.
- Generic audit / QI project track, generic publication track, generic grant track — staged, lighter-weight versions of the same pattern.
- Generic scored-rubric templates: proposal assessment, full-work assessment (with defence scoring), OSCE/skills sign-off, credentialing/audit checklist, peer-review form — all built on 8.1.

**Scheduling**
- Duty roster template: a combined roster covering multiple staff bands on the same grid, with per-cadre/per-band colour coding, weekday vs. weekend/holiday rules, and configurable "special coverage" rows for an outstation or satellite site.
- Priority/on-call/supervision list, generated as a pipeline output from a duty roster's data rather than entered separately.
- Emergency/urgent-coverage roster and satellite/outstation coverage roster, each realignable month to month from a prior month's pattern.
- Clinic/session allocation roster (non-emergency), booking/room roster.

**Forms & pipelines**
- Leave/absence request, incident/audit report, feedback form, membership/credential renewal, generic intake/checklist form — org admin edits fields and destination pipeline per instance.

**Clinical & professional writing**
- Structured clerking template (shared with the case template above), referral letter, SOP/protocol template.

**Meetings & actions**: standing meeting template with agenda, minutes, and action-tracker pipeline, usable for any recurring meeting type.

None of the above should be readable in code as "WACP" or "dissertation" or "roster" logic — they are named, seeded rows in `rubric.template` / module instance tables. A future org in a different specialty or country should be able to delete every seed above and start from zero without touching a module.

The integrations catalog (section 7) should be seeded just as exhaustively and just as generically: statistical analyser, literature search, literature/evidence matrix builder, reference manager, and a word-processing/long-form writing space are the immediate asks, feeding the Research & academic tracks and Clinical & professional writing modules exactly as described in section 7. Add to that catalog over time — citation-style checkers, plagiarism/similarity checkers, survey/data-collection tools, transcription tools — using the same additive, non-required pattern. None of these are specific to Dr. Olanipekun's account or to Family Medicine; they are catalog rows any tenant can connect.

### 8.3 Personal instances (one account, not the seed library)

Dr. Babatunde Olanipekun (Senior Registrar) is using his own individual account to continue real, in-progress work, using the seed templates above as starting points. This is instance data under his `member_id`, private to him unless he shares it into an org:

- **Dissertation track** (Research & academic tracks, fellowship track instance): title "Association between Sexual Communication and Erectile Function among Married Men at UCH GOPD"; currently at the corrections stage after proposal review, with a proposal-assessment and full-assessment rubric instance attached (built on 8.1, seeded from the two WACP scoring guides supplied).
- **Casebook** (Research & academic tracks, case-based portfolio instance): an in-progress multi-case container. One reference casebook (a completed, corrected fifteen-case example from another candidate) was supplied purely as a formatting/structure sample — it is not his data and should seed the *template*, not appear as his content. His own casebook currently holds roughly five individual case instances in progress, one of which (a stroke case in a hypertensive farmer) is fully drafted through several follow-ups and can seed the individual case template's field structure.
- **Case-selection support**: the seven-step guideline and the specialty/case-count distribution table (both supplied) become the case-selection guide and case-mix planner seed content, attached to his casebook instance so PrivyBrain-2 can flag gaps in his specialty spread as he adds cases.
- **Scheduling**: he has prior, detailed working knowledge of building combined duty rosters (floor + priority/on-call + emergency-coverage + outstation rows, cadre-based colour coding, month-to-month realignment from a prior month, fairness rules such as no back-to-back duty). This should inform the *seed* duty-roster template's configurability (colour coding, per-row rules, realign-from-prior-month pipeline step), not be entered as his personal roster data unless he chooses to run his department's roster through his own account.

Keep 8.2 and 8.3 in different tables/seed files in the repo (e.g. `seed/templates/*.json` vs a normal member-scoped instance) so a template-library reset or export never touches his personal records, and so his personal records are never mistaken for platform defaults.

## 9. Working rules for Claude Code

1. **Surgical fixes.** Smallest change that resolves the issue.
2. **Tenant first.** Any new table, route or query starts with `tenant_id`. If you cannot say which tenant owns a piece of data, stop.
3. **Modules never import modules.** Wire through the spine.
4. **Faces display, engines compute.** Overdue status, roster conflicts, billing amounts and academic progress are engine outputs.
5. **Every input feeds an agent; every insight names its fields and cooldown.**
6. **Neutral until known.** No institutional branding, member names or module set is rendered before a tenant is resolved.
7. **Gates before autonomy.** Nothing above rung 1 executes without an approve/deny path and audit row.
8. **Mobile, tablet, desktop from one component tree** with layout props; portrait must never bleed.
9. **Never hard-code a use case into a module.** If a module can only do one thing (one form, one schedule, one dissertation), it is a use case wearing a module's clothes. Refactor to builder + instances + pipelines.
10. **Never hard-code an organisation type, a group name, or a specialty.** "Resident", "ward", "consultant", "department" are instance-level labels an org admin sets, not module vocabulary. Write modules for "an organisation" and "a member", not for a hospital.
11. **Integrations are additive, never required.** Every module has a native fallback with no integration connected. Wire external tools through the integrations layer (section 7), not with direct calls from a module.
12. **Update the registry in the same change.**
13. **Do not import from, call, or reference any system outside this repo.** The workspace is self-contained.

---

## 10. Domain and identity

Whether this stays on workspace.privydoc.com.ng or folds into privydoc.com.ng is a routing decision, not an architecture one. Either way, the neutral landing resolves tenant first, then renders the tenant's face.

Reserve a `privydoc_doctor_id` field on `udr.identity`. Leave it null. It exists so a doctor's PrivyDoc identity can be linked in future without a schema change. Do not build anything on it now.

---

## 11. Backlog framing (from the current sign-in screenshots)

- Portal is for doctors, not "residents": rename headings, helper text and copy throughout.
- Login order: tenant → member → code, with the individual path visible at the top level.
- Button "Access my workspace", not "Access my form"; the monthly form is one module of many.
- Link "Organisational Admin Portal", not "Chief Resident"; add "Create a new organisation".
- `/#admin` opens the platform operator panel (organisations, individuals, modules), distinct from org admin.
- Institutional label appears only after tenant resolution.
- Access-code entry masked; member list not enumerable without tenant context.
- Responsive across mobile, tablet, desktop.
- Forms module currently equals one monthly schedule form; generalise into builder + instances + pipelines, with the current schedule-to-roster flow kept as one pipeline among many.
- Research module currently equals one dissertation flow; generalise into academic tracks, with the current dissertation kept as one track template among many.
- Add the integrations layer (statistical analyser, literature search, literature/evidence matrix, reference manager, writing space) as connectable, optional tools feeding the Research and Clinical & professional writing modules — not built into either module directly.
- Audit every module, label and default template repo-wide for hospital/residency-specific wording (e.g. "resident", "ward", "consultant", "department") and move it into instance config rather than code or copy.
- Build the scored-rubric primitive (8.1) and seed it with the supplied dissertation proposal and full-dissertation assessment guides as the first two rubric templates.
- Seed the case-based portfolio, individual case, and case-selection templates (8.2/8.3) from the supplied casebook and case documents, keeping the reference casebook as template-structure input only.
- Seed the duty-roster template's configurability (colour coding, per-row rules, month realignment pipeline) from known roster-building rules, without entering any specific month's roster as seed data.
- Stand up the integrations catalog with the five requested integrations (statistical analyser, literature search, literature/evidence matrix, reference manager, writing space) as connectable, optional, not-yet-required entries.

---

## 12. The test

Can this component be drawn as one numbered part on the exploded view, with a tenant on it, an arrow in and an arrow out — and would it still make sense drawn for a solo doctor, a private clinic, and a hospital department alike? If yes, it belongs to the living workspace. If not, it is dead tissue or it is scoped too narrowly.
