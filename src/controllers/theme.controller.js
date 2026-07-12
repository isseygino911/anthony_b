const themeService = require('../services/theme.service');
const uploadService = require('../services/upload.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const getTheme = asyncHandler(async (req, res) => {
  const theme = await themeService.getTheme();
  res.status(200).json(theme);
});

const updateTheme = asyncHandler(async (req, res) => {
  const theme = await themeService.updateTheme(req.body);
  res.status(200).json(theme);
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  const logoUrl = await uploadService.uploadLogo(req.file);
  res.status(201).json({ logo_url: logoUrl });
});

module.exports = { getTheme, updateTheme, uploadLogo };
