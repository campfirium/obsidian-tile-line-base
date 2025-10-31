import { SuggestModal, type App, type TFile } from 'obsidian';
import { t } from '../i18n';

interface RowMigrationTargetModalOptions {
	onChoose: (file: TFile) => void;
	onCancel: () => void;
}

export class RowMigrationTargetModal extends SuggestModal<TFile> {
	private didChoose = false;
	private readonly candidates: TFile[];
	private isResolving = false;

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
		const choose = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.resolveSelection(file);
		};
		el.createEl('div', { text: file.basename });
		el.createEl('div', { text: file.path, cls: 'tlb-row-migration-target__path' });
		el.addEventListener('click', choose);
		el.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				this.resolveSelection(file);
			}
		});
	}

	public override onChooseSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.resolveSelection(file);
	}

	override onClose(): void {
		super.onClose();
		if (!this.didChoose) {
			this.options.onCancel();
		}
	}

	private resolveSelection(file: TFile): void {
		if (this.isResolving) {
			return;
		}
		this.isResolving = true;
		this.didChoose = true;
		this.options.onChoose(file);
		this.close();
	}
}
