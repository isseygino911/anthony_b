/**
 * Seeds one demo admin user for local/dev testing of admin-only routes.
 *
 * Plaintext dev password (NOT stored in the DB — see NOTES to the CEO/team):
 *   email:    admin@demo-store.test
 *   password: DemoAdmin123!
 *
 * Only the bcrypt hash is persisted.
 */
exports.seed = async function seed(knex) {
  await knex('users').where({ email: 'admin@demo-store.test' }).del();

  const now = knex.fn.now();

  await knex('users').insert({
    email: 'admin@demo-store.test',
    // bcrypt hash of "DemoAdmin123!" (10 salt rounds) — plaintext never
    // stored; see the comment above / NOTES for the CEO for the plaintext.
    password_hash:
      '$2b$10$66EEK6/YzXmom8jO5LJheucsJV3Q4COHayzfJIzGdQkWXK0WduLNG',
    provider: 'local',
    provider_id: null,
    name: 'Demo Admin',
    role: 'admin',
    created_at: now,
    updated_at: now,
  });
};
