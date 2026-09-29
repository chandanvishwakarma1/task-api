/** Unit tests for src/utils/validators.js */
const {
  validateCreateTask,
  validateUpdateTask,
  validateAssign,
  MAX_ASSIGNEE_LENGTH,
} = require('../src/utils/validators');

describe('validateCreateTask', () => {
  test('accepts a minimal valid body', () => {
    expect(validateCreateTask({ title: 'ok' })).toBeNull();
  });

  test('accepts a fully populated valid body', () => {
    const body = { title: 'ok', status: 'done', priority: 'low', dueDate: '2030-01-01T00:00:00.000Z' };
    expect(validateCreateTask(body)).toBeNull();
  });

  test.each([
    ['missing title', {}],
    ['empty title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['non-string title', { title: 42 }],
  ])('rejects %s', (_label, body) => {
    expect(validateCreateTask(body)).toMatch(/title/);
  });

  test('rejects an invalid status', () => {
    expect(validateCreateTask({ title: 'x', status: 'nope' })).toMatch(/status/);
  });

  test('rejects an invalid priority', () => {
    expect(validateCreateTask({ title: 'x', priority: 'urgent' })).toMatch(/priority/);
  });

  test('rejects an unparseable dueDate', () => {
    expect(validateCreateTask({ title: 'x', dueDate: 'not-a-date' })).toMatch(/dueDate/);
  });
});

describe('validateUpdateTask', () => {
  test('accepts an empty body (all fields optional)', () => {
    expect(validateUpdateTask({})).toBeNull();
  });

  test('rejects an empty-string title when title is provided', () => {
    expect(validateUpdateTask({ title: '' })).toMatch(/title/);
  });

  test('rejects an invalid status / priority / dueDate', () => {
    expect(validateUpdateTask({ status: 'x' })).toMatch(/status/);
    expect(validateUpdateTask({ priority: 'x' })).toMatch(/priority/);
    expect(validateUpdateTask({ dueDate: 'x' })).toMatch(/dueDate/);
  });

  // BUG #5: `body.status && ...` skips validation for falsy values like ''.
  test.failing('rejects an empty-string status', () => {
    expect(validateUpdateTask({ status: '' })).not.toBeNull();
  });
});

describe('validateAssign', () => {
  test('accepts a normal name', () => {
    expect(validateAssign({ assignee: 'Alice' })).toBeNull();
  });

  test('accepts a name with surrounding whitespace (it is trimmed on save)', () => {
    expect(validateAssign({ assignee: '  Alice  ' })).toBeNull();
  });

  test('accepts a name exactly at the length limit', () => {
    expect(validateAssign({ assignee: 'a'.repeat(MAX_ASSIGNEE_LENGTH) })).toBeNull();
  });

  test.each([
    ['missing assignee', {}],
    ['null assignee', { assignee: null }],
    ['numeric assignee', { assignee: 123 }],
    ['object assignee', { assignee: { name: 'x' } }],
    ['undefined body', undefined],
  ])('rejects %s', (_label, body) => {
    expect(validateAssign(body)).toMatch(/assignee/);
  });

  test('rejects empty and whitespace-only strings', () => {
    expect(validateAssign({ assignee: '' })).toMatch(/non-empty/);
    expect(validateAssign({ assignee: '   ' })).toMatch(/non-empty/);
  });

  test('rejects names longer than the limit', () => {
    expect(validateAssign({ assignee: 'a'.repeat(MAX_ASSIGNEE_LENGTH + 1) })).toMatch(/at most/);
  });
});
