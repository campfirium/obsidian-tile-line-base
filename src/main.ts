import { Plugin } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';

export default class TileLineBasePlugin extends Plugin {
	async onload() {
		console.log('加载 TileLineBase 插件');

		// 注册表格视图
		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => new TableView(leaf)
		);

		// 注册命令：打开表格视图
		this.addCommand({
			id: 'open-table-view',
			name: '打开 TileLineBase 表格',
			callback: () => {
				this.activateView();
			}
		});

		// 添加功能区图标
		this.addRibbonIcon('table', 'TileLineBase 表格', () => {
			this.activateView();
		});
	}

	async onunload() {
		console.log('卸载 TileLineBase 插件');
	}

	async activateView() {
		const { workspace } = this.app;

		// 检查是否已经打开
		let leaf = workspace.getLeavesOfType(TABLE_VIEW_TYPE)[0];

		if (!leaf) {
			// 在右侧边栏打开
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) {
				return;
			}
			leaf = rightLeaf;
			await leaf.setViewState({
				type: TABLE_VIEW_TYPE,
				active: true,
			});
		}

		// 激活视图
		workspace.revealLeaf(leaf);
	}
}
