import type { TFile } from 'obsidian';
import { t } from '../i18n';

export type TableViewMode = 'table' | 'kanban';

export interface TableViewTitleBaseOptions {
	file: TFile | null;
	filePath: string | null;
}

export interface BuildTableViewTitleOptions extends TableViewTitleBaseOptions {
	mode: TableViewMode | null | undefined;
}

export function buildTableViewTabTitle(options: TableViewTitleBaseOptions): string {
	return resolveFileBaseName(options.file, options.filePath) ?? t('tableView.displayName');
}

export function buildTableViewTitle(options: BuildTableViewTitleOptions): string {
	const baseTitle = buildTableViewTabTitle(options);
	const modeLabel = resolveModeLabel(options.mode);
	return modeLabel ? `${baseTitle} (${modeLabel})` : baseTitle;
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
