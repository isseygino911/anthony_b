const siteThemeModel = require('../models/siteTheme.model');
const { PALETTES, PALETTE_IDS } = require('../config/palettes');
const ApiError = require('../utils/apiError');

// architecture.md §5.1 — resolves palette_id/custom_colors -> {primary, secondary}.
function resolveColors(themeRow) {
  if (themeRow.palette_id === 'custom') {
    const custom = themeRow.custom_colors || {};
    return { primary: custom.primary, secondary: custom.secondary };
  }
  const palette = PALETTES[themeRow.palette_id];
  return { primary: palette.accent, secondary: palette.accentSecondary };
}

function parseJsonColumn(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function getTheme() {
  const row = await siteThemeModel.getRow();
  if (!row) throw ApiError.notFound('Site theme not configured');
  const themeRow = { ...row, custom_colors: parseJsonColumn(row.custom_colors) };
  return {
    brand_name: row.brand_name,
    tagline: row.tagline,
    logo_url: row.logo_url,
    palette_id: row.palette_id,
    custom_colors: themeRow.custom_colors,
    resolvedColors: resolveColors(themeRow),
    section_styles: parseJsonColumn(row.section_styles),
    default_mode: row.default_mode,
  };
}

function validateThemeInput(data) {
  if (data.palette_id !== undefined) {
    if (data.palette_id !== 'custom' && !PALETTE_IDS.includes(data.palette_id)) {
      throw ApiError.badRequest('Unknown palette_id', { palette_id: data.palette_id });
    }
    if (data.palette_id === 'custom') {
      const colors = data.custom_colors;
      if (!colors || !colors.primary || !colors.secondary) {
        throw ApiError.badRequest('custom_colors {primary, secondary} required when palette_id is custom');
      }
    }
  }
}

async function updateTheme(data) {
  validateThemeInput(data);

  const patch = {};
  if (data.brand_name !== undefined) patch.brand_name = data.brand_name;
  if (data.tagline !== undefined) patch.tagline = data.tagline;
  if (data.logo_url !== undefined) patch.logo_url = data.logo_url;
  if (data.palette_id !== undefined) patch.palette_id = data.palette_id;
  if (data.custom_colors !== undefined) {
    patch.custom_colors = data.custom_colors ? JSON.stringify(data.custom_colors) : null;
  }
  if (data.section_styles !== undefined) patch.section_styles = JSON.stringify(data.section_styles);
  if (data.default_mode !== undefined) patch.default_mode = data.default_mode;

  const row = await siteThemeModel.upsertRow(patch);
  return {
    ...row,
    custom_colors: parseJsonColumn(row.custom_colors),
    section_styles: parseJsonColumn(row.section_styles),
  };
}

module.exports = { getTheme, updateTheme };
