# Architecture Decision Records

Format: **Decision** / *Alternatives considered* / **Why** / *Would revisit if…*

Newest last. Each entry should be readable a month later without the code open.

---

## ADR-001 — Build a full-stack product, in TypeScript, on both ends

**Decision:** A spaced-repetition interview-prep system, TypeScript on the server
and in the browser, Postgres for storage, running on localhost.

*Alternatives considered, with the gate that killed each:*

| Candidate | Killed by |
|---|---|
| Distributed KV store + live cluster console | Its strongest oracle (Porcupine, verified v1.3.0) is a Go library; in TypeScript I would write the linearizability checker myself, which removes the only reason it ranked highest. Also retells `redis-clone`'s subject matter. |
| Real-time collaborative board (CRDT) | Genuinely strong, and the runner-up. Lost on the "localhost only" decision — a collaboration tool nobody else opens is a convergence test with a UI attached. |
| Job queue + ops console | Persistence work overlaps `redis-clone` heavily and its oracle would also be self-written. No new axis over the winner. |
| Git server with `git push` support | Best oracle of any candidate (real `git`). Killed on non-redundancy: it tells `redis-clone`'s story ("a real client speaks my hand-rolled protocol") *and* `png-from-scratch`'s story ("binary container, checksums, DEFLATE"). Packfiles are literally zlib. Highest impressiveness-to-differentiation ratio on the list — which is why it lost. |
| Job application tracker / expense tracker / read-later app | Same engineering shape as the winner; lost on which domain I would actually keep using. |

**Why:** Two finished-ish repos prove the same thing — single-process systems
depth in a compiled language, judged by someone else's oracle. Neither contains
a line of HTTP, SQL, auth, UI, or LLM code. `PROJECTS.md:26` scheduled a product
project for Sep 2026 precisely because that is the gap.

TypeScript on both ends because I read it fine, and one language across the wire
means the language costs zero learning budget and all of it goes to the concepts.

**Banned dependencies, specifically:** Next.js (does routing, data fetching and
the auth pattern), Prisma and Drizzle (write the schema and the queries), and any
auth library (does sessions). Each one automates the exact thing this project
exists to teach. This is not a style preference — assembling these layers *is*
the deliverable.

*Would revisit if:* the goal shifted from learning to shipping something real to
users, where Next.js plus a managed auth provider is unambiguously the right call.

---

## ADR-002 — The strongest case against this project, written before any code

Recorded now so it can be judged later against what was actually built.

**The argument:** "Full-stack CRUD app with auth and an AI feature" is the single
most common shape in a junior portfolio in 2026. Nothing in the idea is
differentiating. Worse, this is the first project of the three whose correctness
bar I largely write myself — `pngcheck` and `redis-cli` could both fail me on
subtle wrongness I had not thought of, and neither Zod nor my own eval suite can
do that, because both encode what I already believe.

**Where it lands if the argument is right:** a repo that looks like everyone
else's, with tests that pass because they assert what the code already does.

**What has to be true for it to be wrong:** M5 has to happen. The evals, the
measured cost per generation, the model comparison, and the degradation paths are
the entire differentiation. `PROJECTS.md:87` says thousands of people can call an
API and very few can show a regression test for a prompt change or state their
p95 cost per request. If M5 gets cut, this ADR was right and the resume bullet
should be downgraded rather than dressed up.

**Judge this entry at M5** against what the eval suite actually caught.

---

## ADR-003 — Cut FSRS to a stretch milestone; ship SM-2

**Decision:** M1 implements SM-2. FSRS, and the differential test against
`ts-fsrs`, move to M6 and are explicitly outside the session estimate.

*Alternatives:* Build FSRS as planned and defer the AI generation feature to a
later project; or build all three of full-stack, FSRS, and the LLM layer.

**Why:** Adding AI card generation made three concept domains — full-stack web,
the FSRS memory model, and LLM application engineering.
`next-project-prompt.md:119` names new-domain-plus-new-domain as the most common
way a solo part-time project dies, and three is worse than two. Something had to
go, and FSRS is the one I added rather than the one I asked for.

**What the cut costs, stated plainly:** `ts-fsrs` (v5.4.2, MIT, zero
dependencies, modified 2026-09-01) was the strongest independent oracle available
to this project — a reference implementation written by someone else to
differential-test against. Dropping it leaves the correctness bar resting on Zod,
Postgres constraints, `tsc --strict`, Playwright, and an eval suite I write
myself. That is a materially weaker bar than either previous project had.

SM-2 is roughly twenty lines of real algorithm and is a genuine scheduler, so the
product still works. What is lost is the oracle, not the feature.

*Would revisit if:* M0–M5 land inside the estimate. Then M6 buys the oracle back,
and the comparison between my SM-2 and a reference FSRS becomes its own finding.
