(() => {
	const rules = [
		{
			id: 1,
			selector: ".tlb-filter-view-bar .tlb-filter-view-icon-nav, .tlb-gallery-toolbar .tlb-filter-view-icon-nav, .tlb-kanban-toolbar .tlb-filter-view-icon-nav, button.tlb-filter-view-icon-nav.tlb-filter-view-icon-nav",
			props: ["border", "background", "color"]
		},
		{
			id: 2,
			selector: ".tlb-filter-view-bar .tlb-filter-view-icon-nav:not(:disabled):hover, .tlb-gallery-toolbar .tlb-filter-view-icon-nav:not(:disabled):hover, .tlb-kanban-toolbar .tlb-filter-view-icon-nav:not(:disabled):hover, button.tlb-filter-view-icon-nav.tlb-filter-view-icon-nav:not(:disabled):hover, .tlb-filter-view-bar .tlb-filter-view-icon-nav:not(:disabled):focus-visible, .tlb-gallery-toolbar .tlb-filter-view-icon-nav:not(:disabled):focus-visible, .tlb-kanban-toolbar .tlb-filter-view-icon-nav:not(:disabled):focus-visible, button.tlb-filter-view-icon-nav.tlb-filter-view-icon-nav:not(:disabled):focus-visible",
			props: ["border-color", "background", "color"]
		},
		{ id: 3, selector: ".tlb-filter-view-search__clear[hidden]", props: ["display"] },
		{ id: 4, selector: ".tlb-filter-view-search__icon svg", props: ["width", "height"] },
		{ id: 5, selector: ".tlb-filter-view-search__clear svg", props: ["width", "height"] },
		{
			id: 6,
			selector: ".tlb-filter-view-bar .tlb-filter-view-button, .tlb-gallery-toolbar .tlb-filter-view-button, .tlb-kanban-toolbar .tlb-filter-view-button, .tlb-filter-view-button",
			props: ["border", "background", "color", "box-shadow"]
		},
		{
			id: 7,
			selector: ".tlb-filter-view-bar .tlb-filter-view-button:hover, .tlb-gallery-toolbar .tlb-filter-view-button:hover, .tlb-kanban-toolbar .tlb-filter-view-button:hover, button.tlb-filter-view-button.tlb-filter-view-button:hover",
			props: ["background", "color", "border-color", "box-shadow"]
		},
		{
			id: 8,
			selector: ".tlb-filter-view-actions button.tlb-filter-view-button--append-clipboard:hover, .tlb-filter-view-actions button.tlb-filter-view-button--settings:hover",
			props: ["background", "border-color", "box-shadow"]
		},
		{
			id: 9,
			selector: ".tlb-filter-view-bar .tlb-filter-view-button.is-active, .tlb-gallery-toolbar .tlb-filter-view-button.is-active, .tlb-kanban-toolbar .tlb-filter-view-button.is-active, .tlb-filter-view-button.is-active",
			props: ["background", "color", "border-color", "box-shadow"]
		},
		{ id: 10, selector: ".tlb-filter-view-actions .tlb-filter-view-button--settings", props: ["border-color", "background", "box-shadow"] },
		{ id: 11, selector: ".tlb-filter-view-actions .tlb-filter-view-button--append-clipboard", props: ["border-color", "background", "box-shadow"] },
		{ id: 12, selector: ".tlb-filter-view-button--append-clipboard svg", props: ["width", "height"] },
		{ id: 13, selector: ".tlb-filter-view-button--settings svg", props: ["width", "height"] },
		{ id: 14, selector: ".tlb-filter-view-button__icon svg", props: ["width", "height"] },
		{ id: 15, selector: "button.tlb-filter-view-button--settings .tlb-filter-view-button__icon > svg", props: ["width", "height"] },
		{ id: 16, selector: ".tlb-filter-view-button .tlb-filter-view-button__close > svg", props: ["width", "height"] },
		{ id: 17, selector: ".ag-dnd-ghost", props: ["background", "color", "border", "border-radius", "box-shadow"] },
		{ id: 18, selector: ".ag-dnd-ghost-icon", props: ["color"] },
		{ id: 19, selector: ".tlb-table-container.tlb-force-odd-row-stripe .ag-row.ag-row-odd:not(.ag-row-hover):not(.ag-row-selected) .ag-cell", props: ["background-color"] },
		{ id: 20, selector: ".ag-popup-editor", props: ["border", "box-shadow"] },
		{ id: 21, selector: ".tlb-new-card-modal", props: ["padding"] },
		{ id: 22, selector: ".tlb-new-card-modal-container", props: ["width", "padding"] },
		{ id: 23, selector: ".tlb-new-card-modal .tlb-modal-content", props: ["padding"] },
		{ id: 24, selector: ".tlb-new-card-modal-container .modal-close-button", props: ["right"] },
		{ id: 25, selector: ".tlb-modal-content", props: ["padding"] },
		{ id: 26, selector: ".tlb-kanban-add-card-modal__input, .tlb-field-input, .tlb-field-textarea", props: ["background-color", "border", "color", "padding"] },
		{ id: 27, selector: ".tlb-kanban-add-card-modal__input:focus, .tlb-field-input:focus, .tlb-field-textarea:focus", props: ["border-color"] },
		{ id: 28, selector: ".modal-close-button", props: ["position"] },
		{ id: 29, selector: ".tlb-slide-full__btn", props: ["background"] },
		{ id: 30, selector: ".tlb-slide-full__btn svg", props: ["width", "height"] },
		{ id: 31, selector: "input.tlb-color-input[type=\"color\"]", props: ["display"] },
		{
			id: 32,
			selector: ".tlb-gallery-card__slide.tlb-gallery-edit .tlb-slide-full__editable-title.tlb-gallery-edit__title, .tlb-gallery-card__slide.tlb-gallery-edit .tlb-slide-full__editable-block.tlb-gallery-edit__block",
			props: ["font-size", "line-height", "font-weight", "text-align"]
		},
		{
			id: 33,
			selector: ".tlb-gallery-card__slide.tlb-gallery-edit .tlb-slide-full__editable-body.tlb-gallery-edit__body, .tlb-gallery-card__slide.tlb-gallery-edit .tlb-slide-full__editable-block.tlb-gallery-edit__block",
			props: ["font-size", "line-height", "font-weight", "text-align", "padding", "margin"]
		},
		{ id: 34, selector: ".tlb-gallery-card__slide.tlb-gallery-edit .tlb-slide-full__editable-input", props: ["font-size", "line-height"] }
	];

	const capture = () => ({
		schemaVersion: 1,
		capturedAt: new Date().toISOString(),
		href: location.href,
		userAgent: navigator.userAgent,
		rules: rules.map((rule) => {
			const nodes = Array.from(document.querySelectorAll(rule.selector));
			return {
				id: rule.id,
				selector: rule.selector,
				props: rule.props,
				matched: nodes.length,
				samples: nodes.slice(0, 25).map((node, index) => {
					const computed = getComputedStyle(node);
					const style = Object.fromEntries(rule.props.map((prop) => [prop, computed.getPropertyValue(prop)]));
					return {
						index,
						tag: node.tagName,
						className: String(node.className),
						text: node.textContent?.trim().slice(0, 80) ?? "",
						style
					};
				})
			};
		})
	});

	const snapshot = capture();
	const json = JSON.stringify(snapshot, null, "\t");
	const stamp = snapshot.capturedAt.replace(/[:.]/g, "-");
	const filename = `tlb-style-snapshot-${stamp}.json`;
	let savedPath = null;

	try {
		const req = typeof require === "function" ? require : null;
		if (req) {
			const fs = req("fs");
			const path = req("path");
			const dir = process.platform === "win32" ? "D:\\T" : "/mnt/d/T";
			if (fs.existsSync(dir)) {
				savedPath = path.join(dir, filename);
				fs.writeFileSync(savedPath, json, "utf8");
			}
		}
	} catch (error) {
		console.warn("[TLB style snapshot] Could not write file directly.", error);
	}

	try {
		copy(json);
	} catch {
		// Some DevTools contexts do not expose copy().
	}

	console.log(`[TLB style snapshot] ${filename}`);
	if (savedPath) {
		console.log(`[TLB style snapshot] saved: ${savedPath}`);
	} else {
		console.log("[TLB style snapshot] JSON copied to clipboard; save it as a .json file.");
	}
	console.table(snapshot.rules.map((rule) => ({
		id: rule.id,
		matched: rule.matched,
		props: rule.props.join(", "),
		selector: rule.selector
	})));
	return snapshot;
})();
