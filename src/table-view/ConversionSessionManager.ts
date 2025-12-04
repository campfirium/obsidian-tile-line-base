import type { TFile } from 'obsidian';
import { getLogger } from '../utils/logger';
import { getPluginContext } from '../pluginContext';
import type { TableView } from '../TableView';

const logger = getLogger('table-view:conversion-session');

export class ConversionSessionManager {
	private baseline: string | null = null;
	private filePath: string | null = null;
	private baselinePersisted = false;
	private sessionHasMutations = false;

	constructor(private readonly view: TableView) {}

	prepare(file: TFile | null): void {
		const nextPath = file?.path ?? null;
		if (this.filePath !== nextPath) {
			this.baseline = null;
			this.baselinePersisted = false;
		}
		this.filePath = nextPath;
		this.sessionHasMutations = false;
	}

	captureBaseline(content: string): void {
		const file = this.view.file;
		if (!file) {
			return;
		}
		if (this.baseline && this.filePath === file.path) {
			return;
		}
		this.baseline = content;
		this.filePath = file.path;
		this.sessionHasMutations = false;
		this.baselinePersisted = false;
		logger.debug('capture', { file: file.path });
	}

	markUserMutation(reason?: string): void {
		if (this.sessionHasMutations) {
			return;
		}
		this.sessionHasMutations = true;
		logger.debug('mutation', { reason });
		void this.persistBaselineBackup();
	}

	hasUserMutations(): boolean {
		return this.sessionHasMutations;
	}

	async restoreBaselineIfEligible(): Promise<boolean> {
		const file = this.view.file;
		const baseline = this.baseline;
		if (!file || !baseline || this.filePath !== file.path || this.sessionHasMutations) {
			return false;
		}
		this.view.persistenceService?.cancelScheduledSave();
		try {
			try {
				const current = await this.view.app.vault.read(file);
				if (current === baseline) {
					logger.debug('restore: skipped (content unchanged)', { file: file.path });
					return false;
				}
			} catch (error) {
				logger.warn('restore: failed to read current content, falling back to write', error);
			}
			logger.debug('restore', { file: file.path });
			await this.view.app.vault.modify(file, baseline);
			return true;
		} catch (error) {
			logger.error('restore-failed', error);
			return false;
		} finally {
			this.baseline = null;
			this.baselinePersisted = false;
		}
	}

	private async persistBaselineBackup(): Promise<void> {
		const file = this.view.file;
		if (this.baselinePersisted || !this.baseline || !file || this.filePath !== file.path) {
			return;
		}
		const plugin = getPluginContext();
		const manager = plugin?.getBackupManager();
		if (!manager) {
			return;
		}
		try {
			this.baselinePersisted = true;
			await manager.ensureInitialBackup(file, this.baseline);
			logger.debug('initial-backup-recorded', { file: file.path });
		} catch (error) {
			this.baselinePersisted = false;
			logger.warn('backup-failed', error);
		} finally {
			this.baseline = null;
		}
	}
}
