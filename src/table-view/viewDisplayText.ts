import { TFile, type WorkspaceLeaf } from 'obsidian';
import { buildTableViewTabTitle } from '../utils/viewTitle';
import type { TableView } from '../TableView';

type ExplorerView = {
	revealFile?: (file: TFile) => void;
	revealInFolder?: (file: TFile) => void;
};

export function refreshTableViewDisplayText(view: TableView): void {
	const tabTitle = buildTableViewTabTitle({
		file: view.file,
		filePath: view.file?.path ?? null
	});
	const leafWithTab = view.leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement | null };
	setElementText(leafWithTab?.tabHeaderInnerTitleEl ?? null, tabTitle);

	const leafEl = view.containerEl.closest('.workspace-leaf');
	const headerTitleEl = (leafEl?.querySelector('.view-header-title') as HTMLElement | null) ?? null;
	renderHeaderTitle(view, headerTitleEl);
}

function setElementText(element: HTMLElement | null | undefined, text: string): void {
	if (!element) {
		return;
	}
	const setText = (element as { setText?: (text: string) => void }).setText;
	if (typeof setText === 'function') {
		setText.call(element, text);
		return;
	}
	element.textContent = text;
}

function renderHeaderTitle(view: TableView, headerTitleEl: HTMLElement | null): void {
	if (!headerTitleEl) {
		return;
	}

	const file = view.file;
	if (!file) {
		setElementText(headerTitleEl, view.getDisplayText());
		headerTitleEl.removeAttribute('title');
		return;
	}

	const path = file.path;
	const segments = path.split(/[\\/]/).filter(Boolean);
	clearElement(headerTitleEl);
	headerTitleEl.setAttr('title', path);

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (!segment) {
			continue;
		}

		const isLast = index === segments.length - 1;
		const label = isLast ? file.basename : segment;
		const currentPath = segments.slice(0, index + 1).join('/');

		const span = headerTitleEl.createSpan({
			cls: 'tlb-header-breadcrumb',
			text: label
		});
		span.addClass(isLast ? 'tlb-header-breadcrumb--file' : 'tlb-header-breadcrumb--folder');
		span.setAttr('tabindex', '0');
		span.setAttr('role', 'button');
		span.setAttr('aria-label', currentPath);
		if (isLast) {
			span.addEventListener('mousedown', (event: MouseEvent) => {
				if (event.button !== 0) return;
				enterInlineRename(span, view, file, { fromPointer: true });
			});
		}
		const onActivate = (event: Event) => {
			event.preventDefault();
			if (isLast) {
				enterInlineRename(span, view, file);
				return;
			}
			handleBreadcrumbActivate(view, currentPath, isLast);
		};
		span.addEventListener('click', onActivate);
		span.addEventListener('dblclick', onActivate);
		span.addEventListener('keydown', (event: KeyboardEvent) => {
			if (span.getAttribute('data-tlb-editing') === 'true') {
				return;
			}
			if (event.key === 'Enter' || event.key === ' ') {
				onActivate(event);
			}
			if (event.key === 'F2' && isLast) {
				event.preventDefault();
				enterInlineRename(span, view, file);
			}
		});

		if (!isLast) {
			headerTitleEl.createSpan({
				cls: 'tlb-header-breadcrumb-separator',
				text: ' / '
			});
		}
	}
}

function clearElement(element: HTMLElement): void {
	while (element.firstChild) {
		element.removeChild(element.firstChild);
	}
}

function handleBreadcrumbActivate(view: TableView, targetPath: string, _isFile: boolean): void {
	const target = view.app.vault.getAbstractFileByPath(targetPath);
	if (target) {
		const explorer = view.app.workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerView | null;
		const reveal =
			typeof explorer?.revealFile === 'function'
				? explorer.revealFile
				: typeof explorer?.revealInFolder === 'function'
					? explorer.revealInFolder
					: null;
		if (reveal) {
			reveal.call(explorer, target);
		}
	}
}

function enterInlineRename(
	element: HTMLElement,
	view: TableView,
	file: TFile,
	options?: { fromPointer?: boolean }
): void {
	if (element.getAttribute('data-tlb-editing') === 'true') {
		return;
	}
	element.setAttribute('data-tlb-editing', 'true');
	element.contentEditable = 'true';
	const original = element.textContent ?? file.basename;
	if (!options?.fromPointer) {
		element.focus({ preventScroll: true });
	}

	let finalized = false;
	const finalize = async (commit: boolean) => {
		if (finalized) {
			return;
		}
		finalized = true;
		element.removeEventListener('keydown', onKeydown);
		element.removeEventListener('blur', onBlur);
		element.removeAttribute('data-tlb-editing');
		element.contentEditable = 'false';
		if (!commit) {
			element.textContent = original;
			return;
		}
		const next = (element.textContent ?? '').trim().replace(/\.md$/i, '');
		if (!next || next === file.basename) {
			element.textContent = file.basename;
			return;
		}
		const parent = file.parent?.path ?? '';
		const newPath = parent ? `${parent}/${next}.md` : `${next}.md`;
		try {
			await view.app.fileManager.renameFile(file, newPath);
			const nextFile = view.app.vault.getAbstractFileByPath(newPath);
			if (nextFile instanceof TFile) {
				view.file = nextFile;
				view.refreshDisplayText();
			}
		} catch (error) {
			console.warn('Inline rename failed', error);
			element.textContent = original;
		}
	};

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void finalize(true);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			void finalize(false);
		}
	};
	const onBlur = () => {
		void finalize(true);
	};
	element.addEventListener('keydown', onKeydown);
	element.addEventListener('blur', onBlur);
}
