# Sparse Storage Workflow

## Scope
- Branch: `0046`
- Source: Markdown documents parsed by TileLineBase TableView
- Goal: retain sparse storage while keeping visible columns consistent with the schema block

## Schema Definition
- The first `H2` data block acts as both a real row and the schema block
- Column order follows the property order in the schema block
- Later blocks that introduce new properties must extend the schema block; the new properties append in discovery order
- Even if every later block omits a property, the column stays visible as long as the schema block contains it

## Parsing Rules
- Collect properties from all `H2` blocks; treat missing keys, empty strings, empty arrays, `null`, or `undefined` as empty values only for rendering
- Keep `0`, `false`, and other falsy-but-meaningful values intact
- Render sparse rows by leaving absent values empty while preserving the full column set defined by the schema block

## Persistence Rules
- When new properties are found, update the schema block in the Markdown file and refresh in-memory caches
- Column reordering in the grid must immediately reflect in the schema block and cached schema, ideally with debouncing and clear failure reporting
- If the original schema block is removed, the next block becomes the schema block; it will inherit all collected properties on the next parse
- Future column deletion must remove the property from every block and update the schema block

## Hidden Column Placeholder
- Hidden-column support can store its flag alongside column metadata inside the schema block; implementation is deferred but interfaces should allow adding that flag later
