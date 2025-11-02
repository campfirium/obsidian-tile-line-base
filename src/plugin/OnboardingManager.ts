import { App, Notice, TAbstractFile, TFile, TFolder, WorkspaceLeaf, normalizePath } from 'obsidian';
import type { SettingsService } from '../services/SettingsService';
import type { ViewSwitchCoordinator } from './ViewSwitchCoordinator';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';

interface OnboardingManagerDeps {
	app: App;
	settingsService: SettingsService;
	viewSwitch: ViewSwitchCoordinator;
}

export class OnboardingManager {
	private readonly logger = getLogger('plugin:onboarding');
	private readonly app: App;
	private readonly settingsService: SettingsService;
	private readonly viewSwitch: ViewSwitchCoordinator;

	constructor(deps: OnboardingManagerDeps) {
		this.app = deps.app;
		this.settingsService = deps.settingsService;
		this.viewSwitch = deps.viewSwitch;
	}

	async runInitialOnboarding(): Promise<void> {
		const state = this.settingsService.getOnboardingState();
		if (state.completed) {
			this.logger.debug('onboarding: already completed');
			return;
		}
		try {
			const file = await this.ensureHelpFile();
			if (!file) {
				this.logger.warn('onboarding: help file unavailable after creation attempt');
				return;
			}
			await this.settingsService.updateOnboardingState({
				completed: true,
				helpFilePath: file.path
			});
			await this.settingsService.setFileViewPreference(file.path, 'table');
			this.scheduleOpen(file);
		} catch (error) {
			this.logger.error('onboarding: failed to run initial onboarding', error);
			new Notice(t('onboarding.createHelpFailed'));
		}
	}

	async openHelpDocument(): Promise<void> {
		try {
			const file = await this.getExistingHelpFile();
			if (file) {
				await this.ensurePreference(file);
				await this.openInWorkspace(file);
				return;
			}
			const created = await this.createHelpFile();
			if (!created) {
				new Notice(t('onboarding.openHelpFailed'));
				return;
			}
			await this.settingsService.updateOnboardingState({ helpFilePath: created.path });
			await this.ensurePreference(created);
			await this.openInWorkspace(created);
		} catch (error) {
			this.logger.error('onboarding: failed to open help document', error);
			new Notice(t('onboarding.openHelpFailed'));
		}
	}

	private async ensureHelpFile(): Promise<TFile | null> {
		const existing = await this.getExistingHelpFile();
		if (existing) {
			return existing;
		}
		return this.createHelpFile();
	}

	private async getExistingHelpFile(): Promise<TFile | null> {
		const state = this.settingsService.getOnboardingState();
		if (!state.helpFilePath) {
			return null;
		}
		const file = this.lookupFile(state.helpFilePath);
		return file instanceof TFile ? file : null;
	}

	private async createHelpFile(): Promise<TFile | null> {
		const baseName = t('onboarding.helpFileName').trim() || 'TileLineBase Getting Started';
		const filename = `${baseName}.md`;
		const folder = this.resolveDefaultFolder();
		const targetPath = folder ? `${folder}/${filename}` : filename;
		const uniquePath = this.generateUniquePath(targetPath);
		const content = this.buildHelpContent();

		try {
			await this.ensureContainingFolder(uniquePath);
			const file = await this.app.vault.create(uniquePath, content);
			this.logger.info('onboarding: help file created', { path: uniquePath });
			await this.settingsService.updateOnboardingState({ helpFilePath: file.path });
			return file;
		} catch (error) {
			this.logger.error('onboarding: failed to create help file', { path: uniquePath, error });
			new Notice(t('onboarding.createHelpFailed'));
			return null;
		}
	}

	private resolveDefaultFolder(): string {
		try {
			const location = this.getVaultConfig<string>('newFileLocation');
			if (location === 'folder') {
				const folderPath = this.getVaultConfig<string>('newFileFolderPath');
				if (typeof folderPath === 'string' && folderPath.trim().length > 0) {
					const normalized = normalizePath(folderPath.trim());
					return normalized;
				}
			}
			if (location === 'current') {
				const active = this.app.workspace.getActiveFile();
				const parentPath = active?.parent?.path;
				if (parentPath && parentPath.trim().length > 0) {
					return normalizePath(parentPath);
				}
			}
		} catch (error) {
			this.logger.warn('onboarding: failed to resolve default folder', error);
		}
		return '';
	}

	private generateUniquePath(candidatePath: string): string {
		const normalized = normalizePath(candidatePath);
		if (!this.lookupFile(normalized)) {
			return normalized;
		}

		const slashIndex = normalized.lastIndexOf('/');
		const directory = slashIndex >= 0 ? normalized.substring(0, slashIndex) : '';
		const baseName = slashIndex >= 0 ? normalized.substring(slashIndex + 1) : normalized;
		const dotIndex = baseName.lastIndexOf('.');
		const stem = dotIndex >= 0 ? baseName.substring(0, dotIndex) : baseName;
		const ext = dotIndex >= 0 ? baseName.substring(dotIndex) : '';

		for (let index = 1; index < 100; index++) {
			const name = `${stem} (${index})${ext}`;
			const path = directory ? `${directory}/${name}` : name;
			const normalizedCandidate = normalizePath(path);
			if (!this.lookupFile(normalizedCandidate)) {
				return normalizedCandidate;
			}
		}

		const fallback = `${normalized}-${Date.now()}`;
		this.logger.warn('onboarding: exhausted unique path attempts, using fallback', { normalized, fallback });
		return fallback;
	}

	private getVaultConfig<T = unknown>(key: string): T | undefined {
		const vault = this.app.vault as unknown as { getConfig?: (configKey: string) => unknown };
		if (vault && typeof vault.getConfig === 'function') {
			try {
				return vault.getConfig(key) as T;
			} catch (error) {
				this.logger.warn('onboarding: getConfig threw error', { key, error });
			}
		}
		return undefined;
	}

	private lookupFile(path: string): TAbstractFile | null {
		try {
			return this.app.vault.getAbstractFileByPath(path);
		} catch (error) {
			this.logger.warn('onboarding: lookup failed', { path, error });
			return null;
		}
	}

	private async ensureContainingFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const slashIndex = normalized.lastIndexOf('/');
		if (slashIndex < 0) {
			return;
		}
		const folderPath = normalized.substring(0, slashIndex);
		if (!folderPath) {
			return;
		}
		const existing = this.lookupFile(folderPath);
		if (existing instanceof TFolder) {
			return;
		}
		if (existing) {
			this.logger.warn('onboarding: target folder occupied by file', { folderPath });
			return;
		}
		try {
			await this.app.vault.createFolder(folderPath);
		} catch (error) {
			if ((error as { message?: string } | undefined)?.message?.includes('already exists')) {
				return;
			}
			this.logger.warn('onboarding: failed to create folder', { folderPath, error });
		}
	}

	private buildHelpContent(): string {
		const content = t('onboarding.helpFileContent');
		return content.endsWith('\n') ? content : `${content}\n`;
	}

	private scheduleOpen(file: TFile): void {
		const open = () => {
			void this.openInWorkspace(file);
		};
		this.app.workspace.onLayoutReady(open);
	}

	private async ensurePreference(file: TFile): Promise<void> {
		try {
			await this.settingsService.setFileViewPreference(file.path, 'table');
		} catch (error) {
			this.logger.warn('onboarding: failed to mark help file preference', { path: file.path, error });
		}
	}

	private async openInWorkspace(file: TFile): Promise<void> {
		try {
			let leaf: WorkspaceLeaf | null = this.app.workspace.getLeaf(true);
			if (!leaf) {
				leaf = this.app.workspace.getMostRecentLeaf();
			}
			if (leaf) {
				await leaf.openFile(file);
				await this.viewSwitch.openTableView(file, {
					leaf,
					preferredWindow: window,
					workspace: this.app.workspace
				});
				return;
			}
		} catch (error) {
			this.logger.warn('onboarding: failed to open help file in leaf, falling back to direct open', { path: file.path, error });
		}

		try {
			await this.viewSwitch.openTableView(file, {
				preferredWindow: window,
				workspace: this.app.workspace
			});
		} catch (error) {
			this.logger.error('onboarding: failed to open help file in table view', { path: file.path, error });
			new Notice(t('onboarding.openHelpFailed'));
		}
	}
}
