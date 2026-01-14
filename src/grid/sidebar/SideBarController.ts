import type { GridApi } from 'ag-grid-community';
import { ModuleRegistry } from 'ag-grid-community';
import { getLogger } from '../../utils/logger';

type AvailabilityState = 'unknown' | 'available' | 'unavailable';

export interface SideBarControllerDeps {
	getGridApi(): GridApi | null;
}

const SIDEBAR_MODULE_NAME = 'SideBarModule';
const logger = getLogger('grid:sidebar-control');

export class SideBarController {
	private availability: AvailabilityState = 'unknown';

	constructor(private readonly deps: SideBarControllerDeps) {}

	reset(): void {
		this.availability = 'unknown';
	}

	setVisible(visible: boolean): void {
		if (this.availability === 'unavailable') {
			return;
		}

		const api = this.deps.getGridApi();
		if (!api) {
			return;
		}

		if (this.availability === 'unknown' && !this.hasSideBarModule(api)) {
			this.availability = 'unavailable';
			return;
		}

		const gridApi = api as GridApi & {
			setSideBarVisible?: (flag: boolean) => void;
			closeToolPanel?: () => void;
		};

		if (typeof gridApi.setSideBarVisible !== 'function') {
			this.availability = 'unavailable';
			return;
		}

		try {
			gridApi.setSideBarVisible(visible);
			this.availability = 'available';
		} catch (error) {
			if (this.isSideBarModuleMissing(error)) {
				this.availability = 'unavailable';
				return;
			}
			logger.warn('Unexpected error while toggling sidebar visibility.', error);
			return;
		}

		if (!visible && typeof gridApi.closeToolPanel === 'function') {
			try {
				gridApi.closeToolPanel();
			} catch (error) {
				if (this.isSideBarModuleMissing(error)) {
					this.availability = 'unavailable';
					return;
				}
				logger.warn('Unexpected error while closing the sidebar.', error);
			}
		}
	}

	private hasSideBarModule(api: GridApi): boolean {
		const registry = ModuleRegistry as unknown as {
			_getAllRegisteredModules?: () => Set<unknown> | undefined;
			_getGridRegisteredModules?: (gridId: string | undefined, rowModel: string | undefined) => unknown[];
		};

		const allModules = registry?._getAllRegisteredModules?.();
		if (allModules && this.modulesSetHasSidebar(allModules)) {
			return true;
		}

		const gridId = this.extractGridId(api);
		const rowModel = this.extractRowModel(api);
		if (!registry?._getGridRegisteredModules || !gridId) {
			return false;
		}

		const scopedModules = registry._getGridRegisteredModules(gridId, rowModel ?? 'clientSide');
		return Array.isArray(scopedModules) && scopedModules.some((module) => this.moduleMatches(module));
	}

	private modulesSetHasSidebar(modules: Set<unknown>): boolean {
		for (const module of modules) {
			if (this.moduleMatches(module)) {
				return true;
			}
		}
		return false;
	}

	private moduleMatches(module: unknown): boolean {
		if (!module || typeof module !== 'object') {
			return false;
		}
		const moduleRecord = module as { moduleName?: unknown };
		return moduleRecord.moduleName === SIDEBAR_MODULE_NAME;
	}

	private extractGridId(api: GridApi): string | undefined {
		const apiWithContext = api as GridApi & { __getContext?: () => { gridId?: string } | null; ctx?: { gridId?: string } | null; gridId?: string; gridOptionsService?: { gridId?: string; _gridId?: string } };
		const context = apiWithContext.__getContext?.() ?? apiWithContext.ctx ?? null;
		if (context && typeof context.gridId === 'string') {
			return context.gridId;
		}
		const gridId = apiWithContext.gridId;
		if (typeof gridId === 'string') {
			return gridId;
		}
		const gridOptionsService = apiWithContext.gridOptionsService;
		const fromService = gridOptionsService?.gridId ?? gridOptionsService?._gridId;
		return typeof fromService === 'string' ? fromService : undefined;
	}

	private extractRowModel(api: GridApi): string | undefined {
		const apiWithModel = api as GridApi & { getModel?: () => { getType?: () => string } | null };
		const rowModel = apiWithModel.getModel?.()?.getType?.();
		return typeof rowModel === 'string' ? rowModel : undefined;
	}

	private isSideBarModuleMissing(error: unknown): boolean {
		if (!(error instanceof Error) || typeof error.message !== 'string') {
			return false;
		}
		return error.message.includes('SideBarModule is not registered');
	}
}
