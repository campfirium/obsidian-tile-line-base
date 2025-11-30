class Notice {
	constructor(_message) {}
}

class TFile {
	constructor(init = {}) {
		this.path = '';
		this.basename = '';
		this.extension = 'md';
		this.parent = null;
		Object.assign(this, init);
	}
}

class Modal {
	constructor(app) {
		this.app = app;
		this.titleEl = { setText: () => {} };
		const createEl = () => ({
			createDiv: () => createEl(),
			createEl,
			empty: () => {},
			addClass: () => {},
			setText: () => {},
			setAttribute: () => {}
		});
		this.contentEl = createEl();
		this.containerEl = createEl();
		this.modalEl = createEl();
	}
	open() {}
	close() {}
}

class Setting {
	constructor(parent) {
		const createEl = () => ({
			createDiv: () => createEl(),
			appendChild: () => {},
			addClass: () => {},
			setText: () => {},
			setAttribute: () => {}
		});
		this.settingEl = parent?.createDiv?.() ?? createEl();
		this.controlEl = { appendChild: () => {}, empty: () => {} };
	}
	setName() { return this; }
	setDesc() { return this; }
	addText(fn) { fn({ setValue: () => this, setDisabled: () => this }); return this; }
	addButton(fn) { fn({ setButtonText: () => ({ setCta: () => ({ onClick: () => {} }) }), onClick: () => {} }); return this; }
}

module.exports = { Notice, TFile, Modal, Setting };
