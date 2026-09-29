# Submission Notes

## What I did
- **Tests** (`task-api/tests/`): unit tests for `taskService` and `validators`, plus
  Supertest integration tests for every endpoint (happy path, 404s, validation failures,
  pagination/filter edge cases).
- **Bug report:** [`BUG_REPORT.md`](./BUG_REPORT.md) — 9 bugs with location, cause, how I
  found each, and a proposed fix.
- **Fix (Part B):** Bug #1, pagination offset. I picked it because it made an entire feature
  (page 1) unreachable and is a one-line, low-risk fix with clear expected behavior.
  The other bugs are documented with `test.failing` tests.
- **Feature (Part C):** `PATCH /tasks/:id/assign`.

## Testing approach
Tests assert *intended* behavior, not current behavior. For known-but-unfixed bugs I used
`test.failing` so the suite stays green yet every bug stays visible in the code; whoever
fixes a bug is forced to flip that test to a normal `test`.

Coverage: run `npm run coverage` (paste the summary here before submitting).
The only code I expect to be uncovered is the `app.listen` block in `app.js`.

## `assign` design decisions
| Question | Decision | Why |
|---|---|---|
| Empty / whitespace-only string | 400 | An empty assignee is meaningless; the endpoint has no "unassign" semantics. |
| Non-string / missing | 400 | Explicit type check; no silent coercion of `123`. |
| Length | Max 100 chars (after trim) | Bounds what a client can store. Arbitrary number, easy to change. |
| Whitespace | Trimmed before storing | `" Alice "` and `"Alice"` shouldn't be different assignees. |
| Already assigned | **Allowed**, overwrites (200) | Reassignment is a normal workflow; 409 would force an unassign step that doesn't exist. Same-name repeat is idempotent. |
| Unknown task | 404 | Per the brief. |
| Order of checks | Validate → lookup | Matches existing `PUT` behavior. (So bad body + unknown id gives 400.) |
| Task shape | New `assignee: string \| null`, default `null` | Existing tasks/clients see one extra nullable field. |

Not done: checking the assignee against a user list. There's no users concept yet, so
`assignee` is a free-text name, as the brief specifies.

## What I'd test next
- Fix bugs #2–#9 and flip their `test.failing` to `test`.
- Property-style tests for pagination (all pages concatenated == full list, no overlap).
- Concurrency / ordering: rapid create+delete, since the store is module-level mutable state.
- Contract test that response bodies match the documented task shape exactly.
- Time-dependent behavior (`overdue`) with fake timers around the boundary instant.

## What surprised me
- `completeTask` resetting `priority` — the kind of bug that only shows up if you compare
  the whole object before and after.
- The README and ASSIGNMENT.md list different status values.
- `getAll` returns a copied array, but the task objects inside are shared references with
  the store, and `create` returns the stored object itself, so callers can mutate store state.

## Questions I'd ask before production
1. Should `PUT` be a true full replace, or a partial update? (Today it's a partial merge.)
2. What are the real status transitions? Can `done` go back to `todo`, and should that clear `completedAt`?
3. Should tasks belong to a user/tenant? There is no auth or ownership at all.
4. Is in-memory storage acceptable? All data is lost on restart and it can't scale past one instance.
5. Pagination contract: max `limit`, and should the response include `total`?
6. Should `assignee` reference a user ID rather than a free-text name?
