# Bug Report — Task API

Found by reading `src/` and then writing tests for the *intended* behavior.
Each bug below has a test in `task-api/tests/`. Tests for **unfixed** bugs use
Jest's `test.failing`, which keeps the suite green while documenting the bug;
when someone fixes a bug, its `test.failing` will start failing, which is the
cue to flip it to a normal `test`.

| # | Severity | Status | Bug |
|---|----------|--------|-----|
| 1 | High   | **FIXED** | Pagination skips the first page |
| 2 | High   | open | `?status=` filter does substring matching |
| 3 | Medium | open | Completing a task silently resets `priority` to `medium` |
| 4 | Medium | open | `PUT` can overwrite server-managed fields (`id`, `createdAt`, `completedAt`) |
| 5 | Medium | open | Empty-string `status` / `priority` bypass validation |
| 6 | Medium | open | Negative `page` / `limit` are not validated |
| 7 | Low    | open | `?status=` silently ignores `page` / `limit` |
| 8 | Low    | open | Completing an already-completed task overwrites `completedAt` |
| 9 | Low    | open | Malformed JSON returns 500 instead of 400 |
| 10 | Info  | open | README and ASSIGNMENT disagree on status values |

---

## 1. Pagination skips the first page — FIXED

- **Where:** `src/services/taskService.js` → `getPaginated`
- **Expected:** `GET /tasks?page=1&limit=2` returns the first two tasks; `page=2` the next two.
- **Actual:** `page=1&limit=2` returned tasks 3–4; page 1 of results was unreachable, and a
  request for the last page of data returned `[]`.
- **Why:** `const offset = page * limit;`. The route treats pages as 1-indexed (it defaults
  `page` to `1`), so the offset must be `(page - 1) * limit`. The original code is
  0-indexed math applied to a 1-indexed API.
- **How found:** Seeded 5 tasks and asserted `getPaginated(1, 2)` returns `[T1, T2]`. It
  returned `[T3, T4]`.
- **Fix:** `const offset = (page - 1) * limit;` (one line, commented in code). Tests:
  `getPaginated` (unit) and `GET /tasks > pagination` (integration). I confirmed these fail
  against the original code and pass with the fix.

## 2. `?status=` filter does substring matching

- **Where:** `taskService.js` → `getByStatus`: `t.status.includes(status)`.
- **Expected:** Only tasks whose status equals the query value.
- **Actual:** `?status=do` returns every `todo` *and* `done` task; `?status=o` matches
  `todo`, `done`, and `in_progress`.
- **Why:** `String.prototype.includes` is used where strict equality was meant.
- **How found:** Edge-case test with a partial status value.
- **Fix:** `tasks.filter((t) => t.status === status)`. Consider also returning 400 for a
  status that isn't in `VALID_STATUSES`.

## 3. Completing a task resets `priority` to `medium`

- **Where:** `taskService.js` → `completeTask` (`priority: 'medium'` inside the update).
- **Expected:** `PATCH /:id/complete` changes `status` and `completedAt` only.
- **Actual:** A `high`-priority task comes back as `medium` (data loss; also corrupts any
  future "completed tasks by priority" reporting).
- **Why:** A hard-coded `priority: 'medium'` in the object literal, which looks like a
  leftover from copy-paste. Nothing in the spec asks for it.
- **How found:** Created a `high` task, completed it, compared all fields before/after.
- **Fix:** Delete that line.

## 4. `PUT` can overwrite server-managed fields (mass assignment)

- **Where:** `taskService.js` → `update` (`{ ...tasks[index], ...fields }`) combined with
  `routes/tasks.js` passing `req.body` straight through.
- **Expected:** Clients can change `title`, `description`, `status`, `priority`, `dueDate`.
  `id`, `createdAt`, `completedAt` are server-owned.
- **Actual:** `PUT /tasks/:id {"id":"x"}` changes the task's id (it can then no longer be
  addressed by its original id, and can collide with another task's id). Arbitrary extra
  keys are also stored. Related: setting `status: "done"` via PUT does *not* set
  `completedAt`, and moving a task out of `done` does not clear it, so `status` and
  `completedAt` can disagree.
- **Why:** Spread of unfiltered user input over the stored object.
- **How found:** Reading `update` and testing a body containing `id`.
- **Fix:** Whitelist the updatable keys in `update`, and derive `completedAt` from status
  transitions in one place (ideally `completeTask` and `update` share a helper).

## 5. Empty-string `status` / `priority` bypass validation

- **Where:** `utils/validators.js` — `if (body.status && !VALID_STATUSES.includes(...))`.
- **Expected:** `status: ""` is rejected with 400.
- **Actual:** `""` is falsy, so the check is skipped and `""` is stored (on `PUT`; on `POST`
  the default parameter only kicks in for `undefined`, so it is stored there too). Such tasks
  are then invisible to `getStats`, which only counts known statuses.
- **Why:** Truthiness check used as an "is provided" check.
- **How found:** Reading the validators; confirmed by test.
- **Fix:** Use `body.status !== undefined && !VALID_STATUSES.includes(body.status)`.
  (Same for `priority`, and `dueDate` — where `0` / `""` also skip the check.)

## 6. Negative `page` / `limit` are not validated

- **Where:** `routes/tasks.js` GET handler: `parseInt(page) || 1`.
- **Expected:** 400 (or clamp to defaults) for values below 1.
- **Actual:** `||` only rescues `0` and `NaN`. `page=-1` and `limit=-2` pass through to
  `Array.slice` with negative indexes, which counts from the end and returns arbitrary
  slices with a 200. There is also no upper bound on `limit`.
- **Fix:** Validate `page >= 1` and `1 <= limit <= MAX_LIMIT`; return 400 otherwise.

## 7. `?status=` ignores `page` / `limit`

- **Where:** `routes/tasks.js` GET handler — the `if (status)` branch returns early.
- **Expected:** Filters compose: `?status=todo&page=2&limit=10`.
- **Actual:** Pagination params are silently dropped when `status` is present.
- **Fix:** Filter first, then paginate the filtered list.
  Related design gap: paginated responses are a bare array with no `total`, so clients can't
  build a pager.

## 8. Completing an already-completed task overwrites `completedAt`

- **Where:** `taskService.js` → `completeTask` always sets `new Date().toISOString()`.
- **Expected:** Idempotent: the original completion time is preserved (or 409).
- **Actual:** Each call moves `completedAt` forward.
- **Fix:** `if (task.status === 'done') return task;`

## 9. Malformed JSON returns 500

- **Where:** `src/app.js` global error handler.
- **Expected:** 400 for a client error.
- **Actual:** `express.json()` raises an error with `status: 400`, but the handler always
  answers 500 (and logs a stack trace for a client mistake).
- **Fix:** `res.status(err.status || 500)`, and only expose the generic message for 5xx.

## 10. Docs inconsistency (not a code bug)

`README.md` documents statuses `pending | in-progress | completed`; the code and
`ASSIGNMENT.md` use `todo | in_progress | done`. I followed the code. README corrected.
