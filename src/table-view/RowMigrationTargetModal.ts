import { SuggestModal, type App, type TFile } from 'obsidian';
import { t } from '../i18n';

interface RowMigrationTargetModalOptions {
	onChoose: (file: TFile) => void;
	onCancel: () => void;
}

export class RowMigrationTargetModal extends SuggestModal<TFile> {
	private didChoose = false;
	private readonly candidates: TFile[];

	constructor(
		app: App,
		private readonly currentFile: TFile,
		candidates: TFile[],
		private readonly options: RowMigrationTargetModalOptions
	) {
		super(app);
		this.candidates = candidates;
		this.setPlaceholder(t('gridInteraction.migrateSelectFilePlaceholder'));
	}

	public override getSuggestions(query: string): TFile[] {
		const normalized = query.trim().toLowerCase();
		const filtered = this.candidates.filter((file) => file.path !== this.currentFile.path);
		if (!normalized) {
			return filtered.slice(0, 50);
		}
		return filtered.filter(
			(file) => file.basename.toLowerCase().includes(normalized) || file.path.toLowerCase().includes(normalized)
		);
	}

	public override renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createEl('div', { text: file.basename });
		el.createEl('div', { text: file.path, cls: 'tlb-row-migration-target__path' });
	}

	public override onChooseSuggestion(file: TFile): void {
		this.didChoose = true;
		this.options.onChoose(file);
	}

	override onClose(): void {
		if (!this.didChoose) {
			this.options.onCancel();
		}
	}
}
