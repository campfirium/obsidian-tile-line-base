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
		if (this.filePath !== nextPath) this.sessionHasMutations = false;
		this.filePath = nextPath;
	}

	captureBaseline(content: string): void {
		const file = this.view.file;
		if (!file) {
			return;
		}
		if (this.sessionHasMutations) {
			return;
		}
		this.baseline = content;
		this.filePath = file.path;
		this.baselinePersisted = false;
		logger.debug('capture', { file: file.path });
	}

	replaceBaseline(content: string): void {
		const file = this.view.file;
		if (!file) {
			return;
		}
		this.baseline = content;
		this.filePath = file.path;
		this.sessionHasMutations = false;
		this.baselinePersisted = false;
		logger.debug('replace', { file: file.path });
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
		const baseline = this.baseline;
		try {
			this.baselinePersisted = true;
			await manager.ensureInitialBackup(file, baseline);
			logger.debug('initial-backup-recorded', { file: file.path });
		} catch (error) {
			this.baselinePersisted = false;
			logger.warn('backup-failed', error);
		} finally {
			if (this.view.file === file && this.baseline === baseline) this.baseline = null;
		}
	}
}
