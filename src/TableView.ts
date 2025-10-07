import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

export class TableView extends ItemView {
	file: TFile | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename || "TileLineBase 表格";
	}

	async setState(state: TableViewState, result: any): Promise<void> {
		// 根据文件路径获取文件对象
		const file = this.app.vault.getAbstractFileByPath(state.filePath);
		if (file instanceof TFile) {
			this.file = file;
			await this.render();
		}
	}

	getState(): TableViewState {
		return {
			filePath: this.file?.path || ""
		};
	}

	async onOpen(): Promise<void> {
		// 初始化容器
		const container = this.containerEl.children[1];
		container.addClass("tile-line-base-view");
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		if (!this.file) {
			container.createDiv({ text: "未选择文件" });
			return;
		}

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: "tlb-table-container" });

		// 读取文件内容
		const content = await this.app.vault.read(this.file);
		const lines = content.split('\n');

		// 创建表格 - 暂时显示每行内容
		const table = tableContainer.createEl("table", { cls: "tlb-table" });

		// 创建表头
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "行号" });
		headerRow.createEl("th", { text: "内容" });

		// 创建表体 - 显示文件每一行
		const tbody = table.createEl("tbody");
		lines.forEach((line, index) => {
			const tr = tbody.createEl("tr");
			tr.createEl("td", { text: String(index + 1) });
			tr.createEl("td", { text: line || "(空行)" });
		});

		console.log(`TileLineBase 表格视图已加载：${this.file.path}`);
	}

	async onClose(): Promise<void> {
		// 清理工作
	}
}
