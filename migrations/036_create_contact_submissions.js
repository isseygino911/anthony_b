/**
 * contact_submissions — one table behind every contact form on the
 * storefront. The form component is reusable and the surfaces it is dropped
 * into differ only by `topic`, so submissions from all of them land here and
 * the admin panel filters/groups by that column rather than each form
 * getting its own table.
 *
 * Submitting requires a logged-in account (contact.routes.js gates POST
 * with requireAuth), so user_id is always populated on insert — there is no
 * anonymous path to create a row. It is nullable only so that deleting an
 * account can null the FK (ON DELETE SET NULL) without destroying the
 * enquiry history the business works from. name/email are snapshotted onto
 * the row rather than read through the FK at display time for the same
 * reason, and because they are what the sender typed for *this* enquiry (a
 * contractor may use a business address that differs from their account
 * email).
 *
 * `topic` is the categorisation the admin panel groups by. Adding a new
 * contact surface later means extending this enum via a MODIFY COLUMN
 * migration (see 023) plus a new entry in the frontend's TOPIC config — no
 * schema redesign.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('contact_submissions', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.enu('topic', ['installer', 'designer']).notNullable();
    table.integer('user_id').unsigned().nullable();
    table.string('name', 255).notNullable();
    table.string('email', 255).notNullable();
    table.string('phone', 50).nullable();
    table.string('company', 255).nullable();
    table.text('message').notNullable();
    table.enu('status', ['new', 'in_progress', 'closed']).notNullable().defaultTo('new');
    table.text('admin_notes').nullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    // Admin list is "newest first, optionally filtered by topic/status" —
    // these two cover both the unfiltered and the filtered ordering.
    table.index(['created_at']);
    table.index(['topic', 'status', 'created_at']);
    table.index(['user_id']);

    // Deleting an account must not erase the enquiry history the business
    // works from; the name/email snapshot above is what keeps the row
    // readable once the FK is gone.
    table
      .foreign('user_id')
      .references('users.id')
      .onDelete('SET NULL');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('contact_submissions');
};
