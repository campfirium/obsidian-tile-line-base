import { Plugin, TFile, Menu } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';

export default class TileLineBasePlugin extends Plugin {
	async onload() {
		// 注册表格视图
		console.log('=== 注册 TableView ===');
		console.log('TABLE_VIEW_TYPE:', TABLE_VIEW_TYPE);
		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => {
				console.log('=== 创建 TableView 实例 ===');
				console.log('leaf:', leaf);
				console.log('leaf.view?.containerEl:', leaf.view?.containerEl);
				console.log('leaf.view?.containerEl.ownerDocument:', leaf.view?.containerEl?.ownerDocument);
				console.log('ownerDocument === document:', leaf.view?.containerEl?.ownerDocument === document);
				return new TableView(leaf);
			}
		);

		// 添加文件菜单项：右键点击文件时显示
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
				menu.addItem((item) => {
					item
						.setTitle('以 TileLineBase 表格打开')
						.setIcon('table')
						.onClick(async () => {
							await this.openTableView(file);
						});
				});
			})
		);

		// 添加命令：切换表格视图
		this.addCommand({
			id: 'toggle-table-view',
			name: '切换 TileLineBase 表格视图',
			checkCallback: (checking: boolean) => {
				console.log('=== toggle-table-view 命令触发 ===');
				console.log('checking:', checking);

				// 使用 activeWindow 获取当前活动窗口
				const activeLeaf = this.app.workspace.activeLeaf;
				console.log('activeLeaf:', activeLeaf);

				if (!activeLeaf) {
					console.log('没有 activeLeaf');
					return false;
				}

				if (!checking) {
					this.toggleTableView(activeLeaf);
				}
				return true;
			}
		});
	}

	async onunload() {
		// 关闭所有该类型的视图
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
	}

	async openTableView(file: TFile) {
		console.log('=== openTableView 开始 ===');
		console.log('file:', file);

		const { workspace } = this.app;
		console.log('workspace:', workspace);

		// 在当前活动的 leaf 打开（主编辑区）
		const leaf = workspace.getLeaf(false);
		console.log('leaf:', leaf);
		console.log('leaf.view:', leaf.view);

		await leaf.setViewState({
			type: TABLE_VIEW_TYPE,
			active: true,
			state: {
				filePath: file.path
			}
		});

		console.log('setViewState 完成');

		// 激活视图
		workspace.revealLeaf(leaf);

		console.log('=== openTableView 完成 ===');
	}

	async toggleTableView(leaf: any) {
		const currentView = leaf.view;

		// 如果当前是表格视图，切换回 Markdown 视图
		if (currentView.getViewType() === TABLE_VIEW_TYPE) {
			const tableView = currentView as TableView;
			const file = tableView.file;

			if (file) {
				await leaf.setViewState({
					type: 'markdown',
					state: {
						file: file.path
					}
				});
			}
		} else {
			// 如果当前是其他视图（如 Markdown），切换到表格视图
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				await leaf.setViewState({
					type: TABLE_VIEW_TYPE,
					active: true,
					state: {
						filePath: activeFile.path
					}
				});
			}
		}
	}
}
