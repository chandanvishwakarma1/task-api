/**
 * Unit tests for src/services/taskService.js
 *
 * Convention used in this file (and in routes.test.js):
 *   - `test(...)`          -> asserts CORRECT behavior and currently passes.
 *   - `test.failing(...)`  -> asserts the CORRECT behavior of a KNOWN, UNFIXED
 *                             bug (see BUG_REPORT.md). Jest reports these as
 *                             passing *because* the assertion fails today. Once
 *                             a bug is fixed, the test will start "failing" –
 *                             that's the signal to change `test.failing` to `test`.
 */
const taskService = require('../src/services/taskService');

const make = (overrides = {}) => taskService.create({ title: 'Task', ...overrides });

// Busy-wait so two ISO timestamps are guaranteed to differ (avoids fake timers).
const tick = (ms = 5) => {
  const start = Date.now();
  while (Date.now() - start < ms);
};

beforeEach(() => {
  taskService._reset();
});

describe('create', () => {
  test('applies defaults for optional fields', () => {
    const task = make();
    expect(task.title).toBe('Task');
    expect(task.description).toBe('');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.dueDate).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.assignee).toBeNull();
    expect(typeof task.id).toBe('string');
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
  });

  test('uses provided values and generates unique ids', () => {
    const a = make({ priority: 'high', status: 'in_progress', description: 'd' });
    const b = make();
    expect(a.priority).toBe('high');
    expect(a.status).toBe('in_progress');
    expect(a.description).toBe('d');
    expect(a.id).not.toBe(b.id);
  });
});

describe('getAll / findById', () => {
  test('getAll returns every task', () => {
    make({ title: 'A' });
    make({ title: 'B' });
    expect(taskService.getAll()).toHaveLength(2);
  });

  test('getAll returns a copy: mutating the array does not affect the store', () => {
    make();
    const list = taskService.getAll();
    list.pop();
    expect(taskService.getAll()).toHaveLength(1);
  });

  test('findById returns the task, or undefined when missing', () => {
    const t = make();
    expect(taskService.findById(t.id)).toEqual(t);
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  test('returns only tasks with exactly that status', () => {
    make({ title: 'a', status: 'todo' });
    make({ title: 'b', status: 'done' });
    make({ title: 'c', status: 'todo' });
    const result = taskService.getByStatus('todo');
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.status === 'todo')).toBe(true);
  });

  test('returns an empty array when nothing matches', () => {
    make({ status: 'todo' });
    expect(taskService.getByStatus('done')).toEqual([]);
  });

  // BUG #2: implementation uses String.includes -> substring match.
  test.failing('does not match on substrings ("do" must not match todo/done)', () => {
    make({ status: 'todo' });
    make({ status: 'done' });
    expect(taskService.getByStatus('do')).toEqual([]);
  });
});

describe('getPaginated', () => {
  beforeEach(() => {
    ['T1', 'T2', 'T3', 'T4', 'T5'].forEach((title) => make({ title }));
  });
  const titles = (list) => list.map((t) => t.title);

  // BUG #1 (FIXED): these used to fail because page 1 skipped the first `limit` items.
  test('page 1 returns the first `limit` tasks', () => {
    expect(titles(taskService.getPaginated(1, 2))).toEqual(['T1', 'T2']);
  });

  test('page 2 returns the next slice', () => {
    expect(titles(taskService.getPaginated(2, 2))).toEqual(['T3', 'T4']);
  });

  test('last page may be partial', () => {
    expect(titles(taskService.getPaginated(3, 2))).toEqual(['T5']);
  });

  test('page past the end returns an empty array', () => {
    expect(taskService.getPaginated(4, 2)).toEqual([]);
  });

  test('a limit larger than the data returns everything', () => {
    expect(taskService.getPaginated(1, 100)).toHaveLength(5);
  });
});

describe('getStats', () => {
  test('returns zeros when empty', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status and counts overdue only for non-done tasks with a past dueDate', () => {
    make({ status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' }); // overdue
    make({ status: 'in_progress', dueDate: '2000-01-01T00:00:00.000Z' }); // overdue
    make({ status: 'done', dueDate: '2000-01-01T00:00:00.000Z' }); // done -> not overdue
    make({ status: 'todo', dueDate: '2999-01-01T00:00:00.000Z' }); // future
    make({ status: 'todo' }); // no due date
    expect(taskService.getStats()).toEqual({ todo: 3, in_progress: 1, done: 1, overdue: 2 });
  });
});

describe('update', () => {
  test('merges fields and persists the change', () => {
    const t = make({ title: 'old' });
    const updated = taskService.update(t.id, { title: 'new', priority: 'high' });
    expect(updated.title).toBe('new');
    expect(updated.priority).toBe('high');
    expect(taskService.findById(t.id).title).toBe('new');
  });

  test('leaves untouched fields alone', () => {
    const t = make({ description: 'keep me' });
    const updated = taskService.update(t.id, { title: 'x' });
    expect(updated.description).toBe('keep me');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG #4: `{...task, ...fields}` lets callers overwrite server-managed fields.
  test.failing('cannot overwrite the id', () => {
    const t = make();
    const updated = taskService.update(t.id, { id: 'hijacked' });
    expect(updated.id).toBe(t.id);
  });

  test.failing('cannot overwrite createdAt', () => {
    const t = make();
    const updated = taskService.update(t.id, { createdAt: '1999-01-01T00:00:00.000Z' });
    expect(updated.createdAt).toBe(t.createdAt);
  });
});

describe('remove', () => {
  test('deletes an existing task and returns true', () => {
    const t = make();
    expect(taskService.remove(t.id)).toBe(true);
    expect(taskService.getAll()).toHaveLength(0);
  });

  test('returns false for an unknown id and leaves the store intact', () => {
    make();
    expect(taskService.remove('nope')).toBe(false);
    expect(taskService.getAll()).toHaveLength(1);
  });
});

describe('completeTask', () => {
  test('marks the task done and sets completedAt', () => {
    const t = make();
    const done = taskService.completeTask(t.id);
    expect(done.status).toBe('done');
    expect(Number.isNaN(Date.parse(done.completedAt))).toBe(false);
    expect(taskService.findById(t.id).status).toBe('done');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });

  // BUG #3: completeTask hard-codes priority: 'medium'.
  test.failing('preserves the existing priority', () => {
    const t = make({ priority: 'high' });
    expect(taskService.completeTask(t.id).priority).toBe('high');
  });

  // BUG #8: completing twice overwrites the original completion time.
  test.failing('completing an already-completed task keeps the original completedAt', () => {
    const t = make();
    const first = taskService.completeTask(t.id);
    tick();
    const second = taskService.completeTask(t.id);
    expect(second.completedAt).toBe(first.completedAt);
  });
});

describe('assignTask (new feature)', () => {
  test('stores the assignee and returns the updated task', () => {
    const t = make();
    const result = taskService.assignTask(t.id, 'Alice');
    expect(result.assignee).toBe('Alice');
    expect(taskService.findById(t.id).assignee).toBe('Alice');
  });

  test('trims surrounding whitespace', () => {
    const t = make();
    expect(taskService.assignTask(t.id, '  Bob  ').assignee).toBe('Bob');
  });

  test('re-assigning overwrites the previous assignee', () => {
    const t = make();
    taskService.assignTask(t.id, 'Alice');
    expect(taskService.assignTask(t.id, 'Bob').assignee).toBe('Bob');
  });

  test('does not modify any other field', () => {
    const t = make({ title: 'keep', priority: 'high' });
    const result = taskService.assignTask(t.id, 'Alice');
    expect(result).toEqual({ ...t, assignee: 'Alice' });
  });

  test('returns null for an unknown id', () => {
    expect(taskService.assignTask('nope', 'Alice')).toBeNull();
  });
});
