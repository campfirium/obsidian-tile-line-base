import { ItemView, WorkspaceLeaf } from "obsidian";

export const TABLE_VIEW_TYPE = "tile-line-base-table";

export class TableView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "TileLineBase 表格";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("tile-line-base-view");

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: "tlb-table-container" });

		// 假数据
		const headers = ["列1", "列2"];
		const data = [
			["任务1", "进行中"],
			["任务2", "已完成"]
		];

		// 创建表格
		const table = tableContainer.createEl("table", { cls: "tlb-table" });

		// 创建表头
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headers.forEach(header => {
			headerRow.createEl("th", { text: header });
		});

		// 创建表体
		const tbody = table.createEl("tbody");
		data.forEach(row => {
			const tr = tbody.createEl("tr");
			row.forEach(cell => {
				tr.createEl("td", { text: cell });
			});
		});

		console.log("TileLineBase 表格视图已加载！");
	}

	async onClose(): Promise<void> {
		// 清理工作
	}
}
