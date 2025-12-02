export const THUMBNAIL_STYLES = `
.tlb-slide-thumb {
	position: absolute;
	inset: 0;
	display: none;
	padding: 28px 28px 30px;
	background: var(--background-primary);
	overflow: hidden;
	z-index: 8;
	opacity: 0;
	transition: opacity 0.2s ease;
	align-items: center;
	justify-content: center;
	flex-direction: column;
}

.tlb-slide-thumb--visible {
	display: flex;
	opacity: 1;
}

.tlb-slide-thumb--centered {
	justify-content: center;
}

.tlb-slide-thumb__grid {
	display: grid;
	/* 初始占位，实际列宽/间距由 JS layoutGrid 写入 */
	grid-template-columns: repeat(5, minmax(0, 1fr));
	column-gap: var(--tlb-thumb-gap-x, 12px);
	row-gap: var(--tlb-thumb-gap-y, 12px);
	grid-auto-rows: var(--tlb-thumb-card-height, auto);
	width: auto;
	max-width: 100%;
	margin: 0 auto;
	padding: 20px 20px 28px 12px;
	overflow: hidden;
	justify-items: stretch;
	align-items: start;
	position: relative;
}

.tlb-slide-thumb__grid--scrollable {
	overflow-y: auto;
	scroll-snap-type: y proximity;
	overscroll-behavior: contain;
	scrollbar-width: thin;
	scrollbar-color: transparent transparent;
	scrollbar-gutter: stable both-edges;
}

.tlb-slide-thumb__grid--scrollable::before,
.tlb-slide-thumb__grid--scrollable::after {
	content: '';
	position: absolute;
	left: 0;
	right: 0;
	height: 14px;
	pointer-events: none;
}

.tlb-slide-thumb__grid--scrollable::before {
	top: 0;
	background: linear-gradient(to bottom, var(--background-primary) 0%, color-mix(in srgb, var(--background-primary) 0%, transparent 100%) 100%);
}

.tlb-slide-thumb__grid--scrollable::after {
	bottom: 0;
	background: linear-gradient(to top, var(--background-primary) 0%, color-mix(in srgb, var(--background-primary) 0%, transparent 100%) 100%);
}

.tlb-slide-thumb__grid--scrollable::-webkit-scrollbar {
	width: 5px;
}

.tlb-slide-thumb__grid--scrollable::-webkit-scrollbar-track {
	background: transparent;
	margin-block: 6px;
}

.tlb-slide-thumb__grid--scrollable::-webkit-scrollbar-thumb {
	background: transparent;
	border-radius: 999px;
}

.tlb-slide-thumb__grid--scrollable:hover::-webkit-scrollbar-thumb {
	background: color-mix(in srgb, var(--background-modifier-border) 50%, transparent 50%);
}

.tlb-slide-thumb__grid--scrollable:hover {
	scrollbar-color: color-mix(in srgb, var(--background-modifier-border) 50%, transparent 50%) transparent;
}

.tlb-slide-thumb__item {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	scroll-snap-align: start;
	box-sizing: border-box;
	appearance: none;
	border: none;
	background: transparent;
	padding: 0;
	cursor: pointer;
	transition: transform 0.1s ease;
}

.tlb-slide-thumb__item:hover {
	transform: translateY(-4px);
}

.tlb-slide-thumb__item:focus-visible {
	outline: 2px solid var(--interactive-accent);
	outline-offset: 4px;
	border-radius: 8px;
}
.tlb-slide-thumb__item:focus { outline: none; }

/* 缩略图画布：强制 16:9 */
.tlb-slide-thumb__canvas {
	position: relative;
	width: 100%;
	height: 100%;
	aspect-ratio: 16 / 9;
	background: color-mix(in srgb, var(--background-secondary) 88%, transparent 12%);
	border-radius: 10px;
	overflow: hidden;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
	border: 1px solid var(--background-modifier-border);
}

.tlb-slide-thumb__item--active .tlb-slide-thumb__canvas {
	border-color: var(--interactive-accent);
	box-shadow: 0 0 0 2px var(--interactive-accent);
}

/* 缩略图内容容器：绝对定位，通过 scale 适应画布 */
.tlb-slide-thumb__root {
	position: absolute;
	top: 0;
	left: 0;
	/* 这里的宽高必须与 JS 中的 baseWidth/baseHeight 一致 */
	width: 1200px;
	height: 675px;
	transform-origin: top left;
	transform: scale(var(--tlb-thumb-scale, 1));
	pointer-events: none; /* 禁止缩略图内部交互 */
}

.tlb-slide-thumb__slide {
	width: 100%;
	height: 100%;
	max-width: none;
	max-height: none;
	aspect-ratio: 16 / 9;
	padding: 36px 48px;
	box-sizing: border-box;
	transform: none;
	display: flex;
	flex-direction: column;
	justify-content: flex-start;
}

.tlb-slide-thumb__slide .tlb-slide-full__content {
	gap: 14px;
}

.tlb-slide-thumb__block--text {
	white-space: normal;
}

.tlb-slide-thumb__block--text p:last-child {
	margin-bottom: 0;
}

.tlb-slide-thumb__block--image {
	align-items: center;
}
`;
