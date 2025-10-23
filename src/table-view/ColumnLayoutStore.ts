import { clampColumnWidth } from '../grid/columnSizing';
import { getPluginContext } from '../pluginContext';

/**
 * 管理单个文件的列宽偏好，统一桥接配置块与插件设置。
 */
export class ColumnLayoutStore {
	private filePath: string | null;
	private columnWidths: Record<string, number>;
	private settingsLoaded = false;

	constructor(filePath: string | null) {
		this.filePath = filePath ?? null;
		this.columnWidths = {};
	}

	reset(filePath: string | null): void {
		this.filePath = filePath ?? null;
		this.columnWidths = {};
		this.settingsLoaded = false;
	}

	applyConfig(columnWidths: Record<string, number> | null | undefined): void {
		if (!columnWidths) {
			return;
		}
		const sanitized: Record<string, number> = {};
		for (const [field, width] of Object.entries(columnWidths)) {
			if (typeof width === 'number' && Number.isFinite(width)) {
				sanitized[field] = width;
			}
		}
		this.columnWidths = sanitized;
	}

	getWidth(field: string): number | undefined {
		this.ensureSettingsLoaded();
		return this.columnWidths[field];
	}

	updateWidth(field: string, width: number): boolean {
		if (!field || Number.isNaN(width)) {
			return false;
		}
		this.ensureSettingsLoaded();
		const clamped = clampColumnWidth(width);
		if (this.columnWidths[field] === clamped) {
			return false;
		}
		this.columnWidths[field] = clamped;
		const plugin = getPluginContext();
		if (plugin && this.filePath) {
			plugin.updateColumnWidthPreference(this.filePath, field, clamped);
		}
		return true;
	}

	remove(field: string): void {
		this.ensureSettingsLoaded();
		if (field in this.columnWidths) {
			delete this.columnWidths[field];
		}
	}

	clone(fromField: string, toField: string): void {
		if (!fromField || !toField) {
			return;
		}
		this.ensureSettingsLoaded();
		if (Object.prototype.hasOwnProperty.call(this.columnWidths, fromField)) {
			this.columnWidths[toField] = this.columnWidths[fromField];
		}
	}

	rename(oldField: string, newField: string): void {
		if (!oldField || !newField || oldField === newField) {
			return;
		}
		this.ensureSettingsLoaded();
		if (Object.prototype.hasOwnProperty.call(this.columnWidths, oldField)) {
			this.columnWidths[newField] = this.columnWidths[oldField];
			delete this.columnWidths[oldField];
		}
	}

	exportPreferences(): Record<string, number> {
		this.ensureSettingsLoaded();
		return { ...this.columnWidths };
	}

	private ensureSettingsLoaded(): void {
		if (this.settingsLoaded) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin || !this.filePath) {
			this.settingsLoaded = true;
			return;
		}
		const stored = plugin.getColumnLayout(this.filePath);
		if (stored) {
			for (const [field, width] of Object.entries(stored)) {
				if (typeof width !== 'number' || Number.isNaN(width)) {
					continue;
				}
				if (!(field in this.columnWidths)) {
					this.columnWidths[field] = width;
				}
			}
		}
		this.settingsLoaded = true;
	}
}
