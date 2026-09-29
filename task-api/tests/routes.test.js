/**
 * Integration tests for the HTTP API (Supertest against the Express app).
 * See the header of taskService.test.js for the `test` vs `test.failing` convention.
 */
const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

// Seed via the service (fast, and keeps route tests independent of POST /tasks).
const seed = (overrides = {}) => taskService.create({ title: 'Seeded', ...overrides });

beforeEach(() => {
  taskService._reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /tasks', () => {
  test('creates a task and returns 201 with the full task shape', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write tests',
      priority: 'high',
      status: 'todo',
      description: '',
      dueDate: null,
      completedAt: null,
      assignee: null,
    });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
  });

  test('the created task is visible via GET /tasks', async () => {
    await request(app).post('/tasks').send({ title: 'Persisted' });
    const res = await request(app).get('/tasks');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Persisted');
  });

  test.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace-only title', { title: '   ' }],
    ['invalid status', { title: 'x', status: 'pending' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['invalid dueDate', { title: 'x', dueDate: 'tomorrow-ish' }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(taskService.getAll()).toHaveLength(0);
  });
});

describe('GET /tasks', () => {
  test('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    seed();
    seed();
    const res = await request(app).get('/tasks');
    expect(res.body).toHaveLength(2);
  });

  describe('?status filter', () => {
    test('returns only tasks with that status', async () => {
      seed({ title: 'a', status: 'todo' });
      seed({ title: 'b', status: 'done' });
      const res = await request(app).get('/tasks?status=done');
      expect(res.status).toBe(200);
      expect(res.body.map((t) => t.title)).toEqual(['b']);
    });

    test('returns [] for a status nobody has', async () => {
      seed({ status: 'todo' });
      const res = await request(app).get('/tasks?status=in_progress');
      expect(res.body).toEqual([]);
    });

    // BUG #2
    test.failing('a partial status like "do" does not match todo/done', async () => {
      seed({ status: 'todo' });
      seed({ status: 'done' });
      const res = await request(app).get('/tasks?status=do');
      expect(res.body).toEqual([]);
    });

    // BUG #7
    test.failing('status filter can be combined with pagination', async () => {
      ['a', 'b', 'c'].forEach((title) => seed({ title, status: 'todo' }));
      const res = await request(app).get('/tasks?status=todo&page=1&limit=2');
      expect(res.body).toHaveLength(2);
    });
  });

  describe('pagination', () => {
    beforeEach(() => {
      ['T1', 'T2', 'T3', 'T4', 'T5'].forEach((title) => seed({ title }));
    });
    const titles = (res) => res.body.map((t) => t.title);

    // BUG #1 (FIXED)
    test('page 1 returns the first `limit` tasks', async () => {
      const res = await request(app).get('/tasks?page=1&limit=2');
      expect(res.status).toBe(200);
      expect(titles(res)).toEqual(['T1', 'T2']);
    });

    test('page 2 returns the following tasks', async () => {
      const res = await request(app).get('/tasks?page=2&limit=2');
      expect(titles(res)).toEqual(['T3', 'T4']);
    });

    test('a page past the end returns an empty array', async () => {
      const res = await request(app).get('/tasks?page=10&limit=2');
      expect(res.body).toEqual([]);
    });

    test('only `limit` given -> defaults to page 1', async () => {
      const res = await request(app).get('/tasks?limit=3');
      expect(titles(res)).toEqual(['T1', 'T2', 'T3']);
    });

    test('only `page` given -> default limit of 10', async () => {
      const res = await request(app).get('/tasks?page=1');
      expect(res.body).toHaveLength(5);
    });

    test('non-numeric page/limit fall back to defaults', async () => {
      const res = await request(app).get('/tasks?page=abc&limit=xyz');
      expect(res.body).toHaveLength(5);
    });

    // BUG #6: negative values reach Array.slice and produce nonsense.
    test.failing('a negative page is rejected with 400', async () => {
      const res = await request(app).get('/tasks?page=-1&limit=2');
      expect(res.status).toBe(400);
    });

    test.failing('a negative limit is rejected with 400', async () => {
      const res = await request(app).get('/tasks?page=1&limit=-2');
      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /tasks/:id', () => {
  test('updates the given fields and returns the task', async () => {
    const t = seed({ title: 'old' });
    const res = await request(app).put(`/tasks/${t.id}`).send({ title: 'new', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: 'new', status: 'in_progress' });
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/does-not-exist').send({ title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test.each([
    ['empty title', { title: '' }],
    ['invalid status', { status: 'nope' }],
    ['invalid priority', { priority: 'nope' }],
    ['invalid dueDate', { dueDate: 'nope' }],
  ])('returns 400 for %s and does not change the task', async (_label, body) => {
    const t = seed({ title: 'stay' });
    const res = await request(app).put(`/tasks/${t.id}`).send(body);
    expect(res.status).toBe(400);
    expect(taskService.findById(t.id).title).toBe('stay');
  });

  // BUG #4 / #5
  test.failing('cannot overwrite the task id via the body', async () => {
    const t = seed();
    const res = await request(app).put(`/tasks/${t.id}`).send({ id: 'hijacked' });
    expect(res.body.id).toBe(t.id);
  });

  test.failing('rejects an empty-string status', async () => {
    const t = seed();
    const res = await request(app).put(`/tasks/${t.id}`).send({ status: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes the task and returns 204 with no body', async () => {
    const t = seed();
    const res = await request(app).delete(`/tasks/${t.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(taskService.findById(t.id)).toBeUndefined();
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('deleting twice: second call is 404', async () => {
    const t = seed();
    await request(app).delete(`/tasks/${t.id}`);
    const res = await request(app).delete(`/tasks/${t.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks the task done and sets completedAt', async () => {
    const t = seed();
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(Number.isNaN(Date.parse(res.body.completedAt))).toBe(false);
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/complete');
    expect(res.status).toBe(404);
  });

  // BUG #3
  test.failing('keeps the original priority', async () => {
    const t = seed({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.body.priority).toBe('high');
  });
});

describe('GET /tasks/stats', () => {
  test('returns zeros when empty', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts by status and reports overdue tasks', async () => {
    seed({ status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' });
    seed({ status: 'in_progress' });
    seed({ status: 'done', dueDate: '2000-01-01T00:00:00.000Z' });
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  test('is not shadowed by the /:id routes', async () => {
    // "stats" must route to the stats handler, not be treated as a task id.
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toHaveProperty('overdue');
  });
});

describe('PATCH /tasks/:id/assign (new feature)', () => {
  test('assigns the task and returns the updated task', async () => {
    const t = seed();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, assignee: 'Alice' });
  });

  test('the assignment is persisted', async () => {
    const t = seed();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const list = await request(app).get('/tasks');
    expect(list.body[0].assignee).toBe('Alice');
  });

  test('trims whitespace around the name', async () => {
    const t = seed();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: '  Bob ' });
    expect(res.body.assignee).toBe('Bob');
  });

  test('does not change any other field', async () => {
    const t = seed({ title: 'keep', priority: 'high', status: 'in_progress' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.body).toEqual({ ...t, assignee: 'Alice' });
  });

  test('returns 404 when the task does not exist', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/assign').send({ assignee: 'Alice' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });

  test('re-assigning an already-assigned task is allowed and overwrites the assignee', async () => {
    const t = seed();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Bob' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Bob');
  });

  test('assigning the same person twice is idempotent', async () => {
    const t = seed();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Alice');
  });

  test.each([
    ['missing assignee', {}],
    ['empty string', { assignee: '' }],
    ['whitespace-only string', { assignee: '   ' }],
    ['null', { assignee: null }],
    ['a number', { assignee: 42 }],
    ['an object', { assignee: { name: 'Alice' } }],
    ['a name over 100 characters', { assignee: 'a'.repeat(101) }],
  ])('returns 400 for %s and leaves the task unassigned', async (_label, body) => {
    const t = seed();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(taskService.findById(t.id).assignee).toBeNull();
  });

  test('validation runs before lookup: bad body on unknown id is 400, not 404', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/assign').send({ assignee: '' });
    expect(res.status).toBe(400);
  });
});

describe('error handling', () => {
  // BUG #9: body-parser errors carry status 400, but the global error handler
  // always answers 500.
  test.failing('malformed JSON body returns 400', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
  });

  test('errors are returned as a JSON body with an `error` field', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(typeof res.body.error).toBe('string');
  });

  test('unknown routes return 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
