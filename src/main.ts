import { Plugin, TFile, Menu } from 'obsidian';
import { TableView, TABLE_VIEW_TYPE } from './TableView';

export default class TileLineBasePlugin extends Plugin {
	async onload() {
		console.log('加载 TileLineBase 插件');

		// 注册表格视图
		this.registerView(
			TABLE_VIEW_TYPE,
			(leaf) => new TableView(leaf)
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

		// 添加命令：对当前活动文件打开表格视图
		this.addCommand({
			id: 'open-current-file-as-table',
			name: '以 TileLineBase 表格打开当前文件',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					if (!checking) {
						this.openTableView(activeFile);
					}
					return true;
				}
				return false;
			}
		});
	}

	async onunload() {
		console.log('卸载 TileLineBase 插件');

		// 关闭所有该类型的视图
		this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
	}

	async openTableView(file: TFile) {
		const { workspace } = this.app;

		// 在当前活动的 leaf 打开（主编辑区）
		const leaf = workspace.getLeaf(false);

		await leaf.setViewState({
			type: TABLE_VIEW_TYPE,
			active: true,
			state: {
				filePath: file.path
			}
		});

		// 激活视图
		workspace.revealLeaf(leaf);
	}
}
