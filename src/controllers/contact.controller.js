const contactService = require('../services/contact.service');
const asyncHandler = require('../utils/asyncHandler');

const submit = asyncHandler(async (req, res) => {
  const submission = await contactService.submit(req.body.topic, req.body, req.user);
  res.status(201).json(submission);
});

const listSubmissions = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const result = await contactService.listSubmissions({
    topic: req.query.topic || undefined,
    status: req.query.status || undefined,
    page,
    pageSize,
  });
  res.status(200).json(result);
});

const getSubmission = asyncHandler(async (req, res) => {
  const submission = await contactService.getSubmission(Number(req.params.id));
  res.status(200).json(submission);
});

const updateSubmission = asyncHandler(async (req, res) => {
  const submission = await contactService.updateSubmission(Number(req.params.id), {
    status: req.body.status,
    adminNotes: req.body.adminNotes,
  });
  res.status(200).json(submission);
});

module.exports = { submit, listSubmissions, getSubmission, updateSubmission };
