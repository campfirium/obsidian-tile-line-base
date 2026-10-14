# Configuration blocks and browsing

Opening a valid TileLineBase note reads its content and builds the view without rewriting the note. Closing the tab or returning to Markdown does not restore an earlier copy of the file.

A valid TLB configuration block is imported into plugin settings when it is first encountered or its configuration content changes. Reopening or refreshing an unchanged block does not import it again, including after an application restart. External edits to the block can be recognized even when its metadata version is unchanged.

Importing does not remove the configuration block from the note. Existing configuration import defaults still apply to partial blocks; import is not a field-by-field merge. Invalid blocks do not replace saved settings. If importing fails, the view uses saved settings and retries on a later load.

Switching the displayed mode, active board, gallery view, filter tab, or tag group saves the necessary local preferences without updating the note. Creating, reusing, or deleting a temporary filter also leaves the note untouched. Automatic layout and default-filter initialization do not write the note. These selections can therefore differ from the last configuration block carried to another device. Saving a temporary filter as a regular definition, or creating, editing, or deleting regular definitions, remains an explicit edit.

When the user edits note content or explicitly saves configuration, the existing “Save config block in note” setting applies. With the setting enabled, the note carries the saved configuration; with it disabled, an existing block can be removed on that save. A configuration save with no change to the note leaves its content untouched.

External file changes continue to refresh active views. Background views refresh when activated. Concurrent unsaved note edits in TileLineBase and another editor still require care; this change does not provide automatic content merging.

The existing initial-backup feature remains available when backups are enabled.
