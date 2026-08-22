const contactSubmissionModel = require('../models/contactSubmission.model');
const notificationModel = require('../models/notification.model');
const db = require('../config/db');
const ApiError = require('../utils/apiError');

// The set of contact surfaces the storefront can submit from. Kept in sync
// with the `topic` enum in 036_create_contact_submissions.js and with
// TOPICS in the frontend's ContactForm config — adding a surface means
// touching all three deliberately, rather than letting an arbitrary string
// reach the database and fail as a driver-level enum error.
const TOPICS = {
  installer: 'Become a Luma Light Installer',
  designer: 'Speak with a Designer',
};

const STATUSES = ['new', 'in_progress', 'closed'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  name: 255,
  email: 255,
  phone: 50,
  company: 255,
  message: 5000,
  adminNotes: 5000,
};

function requireText(value, field, max) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw ApiError.badRequest(`${field} is required`);
  if (trimmed.length > max) {
    throw ApiError.badRequest(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

function optionalText(value, field, max) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw ApiError.badRequest(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

// Phone is required on every contact surface — the business follows these
// enquiries up by calling. The column itself stays NULLABLE (no migration):
// the requirement is a rule about what a *new* submission must carry, and
// keeping the column permissive means an older row, or one written by some
// future path that genuinely has no phone number, is still representable.
async function submit(topic, payload, user) {
  if (!TOPICS[topic]) {
    throw ApiError.badRequest('Unknown contact topic', { topic });
  }

  const name = requireText(payload.name, 'Name', LIMITS.name);
  const email = requireText(payload.email, 'Email', LIMITS.email).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw ApiError.badRequest('A valid email address is required');
  }
  const message = requireText(payload.message, 'Message', LIMITS.message);
  const phone = requireText(payload.phone, 'Phone', LIMITS.phone);
  const company = optionalText(payload.company, 'Company', LIMITS.company);

  // The submission row and its admin notification are written together —
  // an enquiry the admin never gets alerted about is the failure mode this
  // feature exists to prevent, so neither is allowed to land without the
  // other.
  return db.transaction(async (trx) => {
    const submission = await contactSubmissionModel.insert(
      { topic, userId: user.id, name, email, phone, company, message },
      trx
    );

    await notificationModel.insertNotification(
      {
        type: 'contact_submission',
        message: `New "${TOPICS[topic]}" enquiry from ${name}.`,
      },
      trx
    );

    return submission;
  });
}

async function listSubmissions({ topic, status, page = 1, pageSize = 25 } = {}) {
  if (topic && !TOPICS[topic]) throw ApiError.badRequest('Unknown contact topic', { topic });
  if (status && !STATUSES.includes(status)) throw ApiError.badRequest('Unknown status', { status });

  const limit = Math.min(100, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  const [items, countRow, summaryRows] = await Promise.all([
    contactSubmissionModel.list({ topic, status, limit, offset }),
    contactSubmissionModel.count({ topic, status }),
    contactSubmissionModel.countsByTopicAndStatus(),
  ]);

  return { items, total: Number(countRow.count), summary: buildSummary(summaryRows) };
}

// Collapses the grouped topic/status counts into one entry per known topic,
// always including topics with no submissions yet so the admin filter bar
// renders a stable set of tabs rather than appearing/disappearing ones.
function buildSummary(rows) {
  const summary = Object.keys(TOPICS).map((topic) => ({
    topic,
    label: TOPICS[topic],
    total: 0,
    new: 0,
  }));
  const byTopic = new Map(summary.map((entry) => [entry.topic, entry]));

  for (const row of rows) {
    const entry = byTopic.get(row.topic);
    if (!entry) continue; // a topic retired from TOPICS but still in old rows
    const count = Number(row.count);
    entry.total += count;
    if (row.status === 'new') entry.new += count;
  }

  return summary;
}

async function getSubmission(id) {
  const submission = await contactSubmissionModel.findById(id);
  if (!submission) throw ApiError.notFound('Submission not found');
  return submission;
}

async function updateSubmission(id, { status, adminNotes }) {
  await getSubmission(id); // 404s before we attempt a no-op update

  const fields = {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw ApiError.badRequest('Unknown status', { status });
    fields.status = status;
  }
  if (adminNotes !== undefined) {
    fields.admin_notes = optionalText(adminNotes, 'Notes', LIMITS.adminNotes);
  }
  if (Object.keys(fields).length === 0) {
    throw ApiError.badRequest('Nothing to update');
  }

  return contactSubmissionModel.update(id, fields);
}

module.exports = { submit, listSubmissions, getSubmission, updateSubmission, TOPICS, STATUSES };
