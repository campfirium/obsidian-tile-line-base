# Status CSS Snippet Guide

This guide explains how to use the status CSS snippet for TileLineBase.  
You can paste the full snippet or copy only the sections you need.

## Quick start
1) Create a new Obsidian CSS snippet.
2) Paste the full snippet or only the sections you want.
3) Enable the snippet and reload the plugin if needed.

## Full snippet (copy-paste)
```css
/* Copy-paste this entire file into a single Obsidian CSS snippet. */
/* Beginner tips:
   - To disable a block: wrap it with comment markers (start comment, end comment).
   - To change colors: replace the #RRGGBB values.
   - To change icons: replace the URL(...) links.
   - To hide an item: set it to "display: none;".
*/

/* ========== 1) Status icon colors (6 states) ========== */
/* If you don't want colors, comment out this whole section. */
/* Replace the hex colors below to your favorite colors. */
/* Use CSS var so icon color works with mask-based icons */
.tlb-status-cell[data-status="todo"]       { --tlb-status-icon-color: #5b7cfa; }
.tlb-status-cell[data-status="done"]       { --tlb-status-icon-color: #35b15b; }
.tlb-status-cell[data-status="inprogress"] { --tlb-status-icon-color: #f2a93b; }
.tlb-status-cell[data-status="onhold"]     { --tlb-status-icon-color: #8b8f97; }
.tlb-status-cell[data-status="someday"]    { --tlb-status-icon-color: #8a63d2; }
.tlb-status-cell[data-status="canceled"]   { --tlb-status-icon-color: #e44d4d; }

.tlb-status-cell .tlb-status-icon {
  background-color: var(--tlb-status-icon-color, currentColor);
}

/* ========== 2) Status icon images (online, copy to see results) ========== */
/* If you don't want custom icons, comment out this whole section. */
/* Hide built-in SVG first (so your custom icon shows) */
.tlb-status-cell[data-status] .tlb-status-icon svg { display: none; }

/* Mask-based icons (color comes from --tlb-status-icon-color) */
.tlb-status-cell[data-status="todo"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/square.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/square.svg") center/16px 16px no-repeat;
}
.tlb-status-cell[data-status="done"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/check-square.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/check-square.svg") center/16px 16px no-repeat;
}
.tlb-status-cell[data-status="inprogress"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/loader-circle.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/loader-circle.svg") center/16px 16px no-repeat;
  animation: tlb-status-spin 1.2s linear infinite;
}
.tlb-status-cell[data-status="onhold"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/pause-circle.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/pause-circle.svg") center/16px 16px no-repeat;
}
.tlb-status-cell[data-status="someday"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/circle-dashed.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/circle-dashed.svg") center/16px 16px no-repeat;
}
.tlb-status-cell[data-status="canceled"] .tlb-status-icon {
  -webkit-mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/x-square.svg") center/16px 16px no-repeat;
  mask: url("https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/x-square.svg") center/16px 16px no-repeat;
}

@keyframes tlb-status-spin {
  to { transform: rotate(360deg); }
}

/* ========== 3) Row background colors (6 states) ========== */
/* If you don't want row colors, comment out this whole section. */
/* Use CSS var + !important to override theme/hover */
.tlb-row-status-todo       .ag-cell { --tlb-row-bg: #f2f6ff; }
.tlb-row-status-done       .ag-cell { --tlb-row-bg: #effaf1; }
.tlb-row-status-inprogress .ag-cell { --tlb-row-bg: #fff6e9; }
.tlb-row-status-onhold     .ag-cell { --tlb-row-bg: #f5f6f8; }
.tlb-row-status-someday    .ag-cell { --tlb-row-bg: #f4f0ff; }
.tlb-row-status-canceled   .ag-cell { --tlb-row-bg: #fff1f1; }

.tlb-row-status-todo       .ag-cell,
.tlb-row-status-done       .ag-cell,
.tlb-row-status-inprogress .ag-cell,
.tlb-row-status-onhold     .ag-cell,
.tlb-row-status-someday    .ag-cell,
.tlb-row-status-canceled   .ag-cell {
  background-color: var(--tlb-row-bg, transparent) !important;
}
```

## What each section does
- Status icon colors: set different colors per status.
- Status icon images: replace the icon with your own image or SVG.
- Row background colors: color the entire row based on status.

## Customization tips
- Change a color: replace the hex value (e.g. `#35b15b`).
- Change an icon: replace the URL inside `url("...")`.
- Disable a section: remove it or wrap the block with comment markers.
- Hide an item: set it to `display: none;`.

## Important notes
- If you use custom icons, the built-in SVG is hidden in that section.
- If colors do not appear, ensure the icon section is not overriding them.
- Some themes may override colors; you can add `!important` if needed.
