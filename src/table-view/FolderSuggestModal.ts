import { App, TFolder, SuggestModal } from 'obsidian';

interface FolderSuggestOptions {
	app: App;
	initial?: string;
	onSelect: (folder: TFolder) => void;
	onCancel: () => void;
}

export class FolderSuggestModal extends SuggestModal<TFolder> {
	private readonly options: FolderSuggestOptions;
	private readonly folders: TFolder[];
	private readonly initialValue: string | null;

	constructor(options: FolderSuggestOptions) {
		super(options.app);
		this.options = options;
		const root = options.app.vault.getRoot();
		this.folders = this.collectFolders(root);
		this.initialValue = this.resolveInitialValue(options.initial);
	}

	onOpen(): void {
		void super.onOpen();
		if (this.initialValue) {
			this.inputEl.value = this.initialValue;
			this.inputEl.dispatchEvent(new Event('input'));
		}
	}

	getSuggestions(query: string): TFolder[] {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return this.folders;
		}
		return this.folders.filter((folder) => folder.path.toLowerCase().includes(normalized));
	}

	renderSuggestion(value: TFolder, el: HTMLElement): void {
		el.addClass('tlb-folder-suggest-item');
		el.createSpan({ text: value.path });
	}

	onChooseSuggestion(item: TFolder): void {
		this.options.onSelect(item);
		this.close();
	}

	onClose(): void {
		this.options.onCancel();
		super.onClose();
	}

	private collectFolders(root: TFolder): TFolder[] {
		const result: TFolder[] = [];
		const stack: TFolder[] = [root];
		while (stack.length > 0) {
			const current = stack.pop()!;
			result.push(current);
			for (const child of current.children) {
				if (child instanceof TFolder) {
					stack.push(child);
				}
			}
		}
		return result.sort((a, b) => a.path.localeCompare(b.path));
	}

	private resolveInitialValue(initial?: string): string | null {
		const trimmed = initial?.trim();
		if (!trimmed) {
			return null;
		}
		const match = this.folders.find((folder) => folder.path === trimmed);
		return match ? match.path : trimmed;
	}
}

export function selectFolder(app: App, initial?: string): Promise<TFolder | null> {
	return new Promise((resolve) => {
		const modal = new FolderSuggestModal({
			app,
			initial,
			onSelect: (folder) => resolve(folder),
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
