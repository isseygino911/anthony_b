const customNeonDesignService = require('../services/customNeonDesign.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

// requireAuth (routes/customNeonDesigns.routes.js) guarantees req.user is set
// for every route in this controller — no anonymous/session-based identity.
function identityFromReq(req) {
  return { user: req.user, anonSessionId: null };
}

function parseStrokes(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw ApiError.badRequest('strokes must be valid JSON');
  }
}

const createDesign = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No design image uploaded');
  const design = await customNeonDesignService.createDesign(identityFromReq(req), {
    designType: req.body.design_type,
    file: req.file,
    strokes: parseStrokes(req.body.strokes),
    text: req.body.text,
    fontFamily: req.body.font_family,
    size: req.body.size,
    neonColor: req.body.neon_color,
  });
  res.status(201).json(design);
});

const getDesign = asyncHandler(async (req, res) => {
  const design = await customNeonDesignService.getDesign(Number(req.params.id), identityFromReq(req));
  res.status(200).json(design);
});

const regenerateDesign = asyncHandler(async (req, res) => {
  const { size, neon_color: neonColor } = req.body;
  const design = await customNeonDesignService.regenerate(Number(req.params.id), identityFromReq(req), {
    size,
    neonColor,
  });
  res.status(200).json(design);
});

const confirmDesign = asyncHandler(async (req, res) => {
  const result = await customNeonDesignService.confirmDesign(Number(req.params.id), identityFromReq(req));
  res.status(200).json(result);
});

const listMine = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await customNeonDesignService.listMine(identityFromReq(req), { page, pageSize });
  res.status(200).json(result);
});

const listShowcase = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
  const items = await customNeonDesignService.listShowcase(limit);
  res.status(200).json({ items });
});

const listDesignsAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await customNeonDesignService.listAdmin(req.query, { page, pageSize });
  res.status(200).json(result);
});

const getDesignAdmin = asyncHandler(async (req, res) => {
  const design = await customNeonDesignService.getAdmin(Number(req.params.id));
  res.status(200).json(design);
});

const updateDesignAdminNotes = asyncHandler(async (req, res) => {
  const design = await customNeonDesignService.updateAdminNotes(Number(req.params.id), req.body.admin_notes ?? '');
  res.status(200).json(design);
});

const listUsageAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await customNeonDesignService.getUsageByUser({ page, pageSize });
  res.status(200).json(result);
});

module.exports = {
  createDesign,
  getDesign,
  regenerateDesign,
  confirmDesign,
  listMine,
  listShowcase,
  listDesignsAdmin,
  getDesignAdmin,
  updateDesignAdminNotes,
  listUsageAdmin,
};
