import type { TFile } from 'obsidian';
import { t } from '../i18n';

export type TableViewMode = 'table' | 'kanban';

export interface BuildTableViewTitleOptions {
	file: TFile | null;
	filePath: string | null;
	mode: TableViewMode | null | undefined;
}

export function buildTableViewTitle(options: BuildTableViewTitleOptions): string {
	const fileName = resolveFileBaseName(options.file, options.filePath);
	if (!fileName) {
		return t('tableView.displayName');
	}
	const modeLabel = resolveModeLabel(options.mode);
	return modeLabel ? `${fileName} (${modeLabel})` : fileName;
}

function resolveFileBaseName(file: TFile | null, filePath: string | null): string | null {
	if (file?.basename) {
		return file.basename;
	}
	if (!filePath || typeof filePath !== 'string') {
		return null;
	}
	const normalized = filePath.trim();
	if (!normalized) {
		return null;
	}
	const segments = normalized.split(/[\\/]/);
	const last = segments[segments.length - 1] ?? '';
	if (!last) {
		return null;
	}
	return last.replace(/\.md$/i, '') || last;
}

function resolveModeLabel(mode: TableViewMode | null | undefined): string {
	return mode === 'kanban' ? t('tableView.mode.kanban') : t('tableView.mode.table');
}
