// contact.service.js — the shared backend behind every storefront contact
// form (Become a Luma Light Installer, Speak with a Designer). The two
// behaviours worth pinning down are the ones a future contact surface could
// silently break:
//   1. submit() writes the submission AND its admin notification atomically —
//      an enquiry nobody is alerted about is the failure this feature exists
//      to prevent.
//   2. the topic whitelist is enforced in the service, so an unknown topic is
//      a 400 rather than a driver-level enum error at insert time.
//
// submit() calls `db.transaction(...)` on the module-level `db` from
// config/db, so this uses isolateDb() the same way customNeonDesign.service
// .test.js does, rather than mocking — see tests/helpers/isolateDb.js for why.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the service below
const contactService = require('../src/services/contact.service');

const TABLES = ['contact_submissions', 'notifications'];

const USER = { id: 7, email: 'account@example.com', name: 'Account Name' };

function payload(overrides = {}) {
  return {
    name: 'Dana Reed',
    email: 'dana@reedelectrical.com',
    phone: '555-0100',
    company: 'Reed Electrical',
    message: 'We install permanent lighting across the county and want dealer pricing.',
    ...overrides,
  };
}

beforeEach(async () => {
  for (const table of TABLES) {
    await db.schema.dropTableIfExists(table);
  }
  // Only the two tables this suite touches are (re)built here — testDb's
  // applySchema builds every table in the app, which would collide with the
  // ones other suites sharing this isolated db instance have already created.
  await db.schema.createTable('contact_submissions', (t) => {
    t.increments('id');
    t.string('topic');
    t.integer('user_id').nullable();
    t.string('name');
    t.string('email');
    t.string('phone').nullable();
    t.string('company').nullable();
    t.text('message');
    t.string('status').defaultTo('new');
    t.text('admin_notes').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });
  await db.schema.createTable('notifications', (t) => {
    t.increments('id');
    t.string('type');
    t.integer('product_id').nullable();
    t.string('message');
    t.boolean('is_read').defaultTo(false);
    t.datetime('created_at');
  });
});

afterAll(async () => {
  if (db) await db.destroy();
});

describe('contact.service.submit', () => {
  it('stores the submission with its topic, status and submitting account', async () => {
    const submission = await contactService.submit('installer', payload(), USER);

    expect(submission).toMatchObject({
      topic: 'installer',
      user_id: 7,
      name: 'Dana Reed',
      company: 'Reed Electrical',
      status: 'new',
    });
  });

  it('raises exactly one admin notification naming the topic and sender', async () => {
    await contactService.submit('designer', payload({ name: 'Priya Shah' }), USER);

    const notifications = await db('notifications').select('*');
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('contact_submission');
    expect(notifications[0].message).toContain('Speak with a Designer');
    expect(notifications[0].message).toContain('Priya Shah');
    expect(Boolean(notifications[0].is_read)).toBe(false);
  });

  it('snapshots the typed contact details rather than the account ones — a business address may differ', async () => {
    const submission = await contactService.submit('installer', payload(), USER);

    expect(submission.email).toBe('dana@reedelectrical.com');
    expect(submission.email).not.toBe(USER.email);
  });

  it('normalises the email and trims surrounding whitespace', async () => {
    const submission = await contactService.submit(
      'designer',
      payload({ email: '  Dana@Reed.COM ', name: '  Dana  ' }),
      USER
    );

    expect(submission.email).toBe('dana@reed.com');
    expect(submission.name).toBe('Dana');
  });

  it('stores a blank company as null rather than an empty string', async () => {
    const submission = await contactService.submit('designer', payload({ company: '' }), USER);

    expect(submission.company).toBeNull();
  });

  it('rejects an unknown topic with a 400 before touching the database', async () => {
    await expect(contactService.submit('careers', payload(), USER)).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(await db('contact_submissions').select('*')).toHaveLength(0);
  });

  it.each([
    ['name', { name: '   ' }],
    ['message', { message: '' }],
    ['email', { email: 'not-an-email' }],
    // Phone is required on every surface — the business calls these leads back.
    ['phone', { phone: '' }],
    ['phone', { phone: '   ' }],
  ])('rejects a submission with an invalid %s and writes nothing', async (_field, overrides) => {
    await expect(contactService.submit('installer', payload(overrides), USER)).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(await db('contact_submissions').select('*')).toHaveLength(0);
    expect(await db('notifications').select('*')).toHaveLength(0);
  });

  it('rejects a message longer than the column allows instead of letting MySQL truncate it', async () => {
    await expect(
      contactService.submit('installer', payload({ message: 'x'.repeat(5001) }), USER)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('contact.service.listSubmissions', () => {
  beforeEach(async () => {
    await contactService.submit('installer', payload({ name: 'One' }), USER);
    await contactService.submit('designer', payload({ name: 'Two' }), USER);
    await contactService.submit('designer', payload({ name: 'Three' }), USER);
  });

  it('returns every submission newest-first when no filter is given', async () => {
    const { items, total } = await contactService.listSubmissions();

    expect(total).toBe(3);
    expect(items.map((i) => i.name)).toEqual(['Three', 'Two', 'One']);
  });

  it('filters by topic and reports the filtered total, not the overall one', async () => {
    const { items, total } = await contactService.listSubmissions({ topic: 'designer' });

    expect(total).toBe(2);
    expect(items.every((i) => i.topic === 'designer')).toBe(true);
  });

  it('summarises counts per topic so the admin panel can show categories', async () => {
    const { summary } = await contactService.listSubmissions({ topic: 'installer' });

    // The summary is deliberately unaffected by the active filter — it drives
    // the category tabs, which must keep showing every topic's totals.
    expect(summary).toEqual([
      { topic: 'installer', label: 'Become a Luma Light Installer', total: 1, new: 1 },
      { topic: 'designer', label: 'Speak with a Designer', total: 2, new: 2 },
    ]);
  });

  it('counts only unhandled submissions in the summary "new" tally', async () => {
    const [first] = await contactService.listSubmissions({ topic: 'designer' }).then((r) => r.items);
    await contactService.updateSubmission(first.id, { status: 'closed' });

    const { summary } = await contactService.listSubmissions();
    const designer = summary.find((s) => s.topic === 'designer');

    expect(designer).toMatchObject({ total: 2, new: 1 });
  });

  it('paginates', async () => {
    const { items, total } = await contactService.listSubmissions({ page: 2, pageSize: 2 });

    expect(total).toBe(3);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('One');
  });

  it('rejects an unknown status filter', async () => {
    await expect(contactService.listSubmissions({ status: 'archived' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('contact.service.updateSubmission', () => {
  let id;

  beforeEach(async () => {
    const submission = await contactService.submit('installer', payload(), USER);
    id = submission.id;
  });

  it('moves a submission through the triage statuses', async () => {
    const updated = await contactService.updateSubmission(id, { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
  });

  it('saves admin notes without disturbing the status', async () => {
    const updated = await contactService.updateSubmission(id, { adminNotes: 'Called back Tuesday.' });

    expect(updated.admin_notes).toBe('Called back Tuesday.');
    expect(updated.status).toBe('new');
  });

  it('clears notes when handed an empty string', async () => {
    await contactService.updateSubmission(id, { adminNotes: 'temp' });
    const updated = await contactService.updateSubmission(id, { adminNotes: '' });

    expect(updated.admin_notes).toBeNull();
  });

  it('rejects an unknown status', async () => {
    await expect(contactService.updateSubmission(id, { status: 'spam' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('404s for a submission that does not exist', async () => {
    await expect(contactService.updateSubmission(9999, { status: 'closed' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects an update that carries no changes', async () => {
    await expect(contactService.updateSubmission(id, {})).rejects.toMatchObject({ statusCode: 400 });
  });
});
