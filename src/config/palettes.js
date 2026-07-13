// Mirrors client/src/theme/palettes.ts IDs + values (architecture.md §0/§3
// duplication note: this is a validation + resolution list only, not the
// design source of truth — the client file is authoritative for the
// admin-facing palette picker UI). Keep hex values in sync with the client
// file whenever it changes.
//
// 'custom' is intentionally NOT a key here — it is handled separately by
// theme.service.js, which reads site_theme.custom_colors instead.
const PALETTES = {
  ocean: { accent: '#0369a1', accentSecondary: '#06b6d4' },
  sunset: { accent: '#ea580c', accentSecondary: '#db2777' },
  earth: { accent: '#78350f', accentSecondary: '#ca8a04' },
  forest: { accent: '#166534', accentSecondary: '#65a30d' },
  berry: { accent: '#9d174d', accentSecondary: '#7c3aed' },
  slate: { accent: '#334155', accentSecondary: '#64748b' },
  graphite: { accent: '#111111', accentSecondary: '#707072' },
};

const PALETTE_IDS = Object.keys(PALETTES);

module.exports = { PALETTES, PALETTE_IDS };
