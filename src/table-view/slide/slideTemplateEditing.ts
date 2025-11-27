import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlidePage } from './SlidePageBuilder';
import type { ComputedLayout } from './slideLayout';

export type TemplateSegment = { type: 'text'; value: string } | { type: 'field'; field: string; value: string };
export interface EditableTemplateState {
	title: TemplateSegment[];
	body: TemplateSegment[][];
}

interface RenderEditFormOptions {
	container: HTMLElement;
	row: RowData;
	page: SlidePage;
	fields: string[];
	reservedFields: Set<string>;
	editingValues: Record<string, string>;
	fieldInputs: Record<string, HTMLElement[]>;
	position: (el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement) => void;
	onCancel: () => void;
	onSave: (payload: { titleTemplate: string; bodyTemplate: string; values: Record<string, string> }) => void;
}

const renderTemplateSegments = (
	container: HTMLElement,
	template: string,
	row: RowData,
	fields: string[],
	reserved: Set<string>,
	editingValues: Record<string, string>,
	fieldInputs: Record<string, HTMLElement[]>,
	collect: TemplateSegment[]
): void => {
	const orderedFields = fields.filter((field) => field && !reserved.has(field));
	const values: Record<string, string> = {};
	for (const field of orderedFields) {
		if (field === 'status') continue;
		const raw = row[field];
		values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
	}

	const segments: TemplateSegment[] = [];
	const regex = /\{([^{}]+)\}/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(template)) !== null) {
		const before = template.slice(lastIndex, match.index);
		if (before) {
			segments.push({ type: 'text', value: before });
		}
		const fieldName = match[1].trim();
		if (fieldName && !reserved.has(fieldName)) {
			const value = editingValues[fieldName] ?? values[fieldName] ?? '';
			segments.push({ type: 'field', field: fieldName, value });
		} else {
			segments.push({ type: 'text', value: '' });
		}
		lastIndex = regex.lastIndex;
	}
	if (lastIndex < template.length) {
		segments.push({ type: 'text', value: template.slice(lastIndex) });
	}

	for (const segment of segments) {
		if (segment.type === 'text') {
			if (segment.value) {
				const input = container.createEl('span', {
					text: segment.value,
					cls: 'tlb-slide-full__editable-input tlb-slide-full__editable-text',
					attr: { contenteditable: 'true' }
				});
				input.addEventListener('input', () => {
					segment.value = input.textContent ?? '';
				});
				collect.push(segment);
			}
		} else {
			const input = container.createEl('span', {
				text: segment.value,
				cls: 'tlb-slide-full__editable-input tlb-slide-full__editable-input--field',
				attr: { contenteditable: 'true' }
			});
			const field = segment.field;
			if (!fieldInputs[field]) {
				fieldInputs[field] = [];
			}
			fieldInputs[field].push(input);
			input.addEventListener('input', () => {
				editingValues[field] = input.textContent ?? '';
				for (const peer of fieldInputs[field]) {
					if (peer !== input) {
						peer.textContent = input.textContent;
					}
				}
			});
			collect.push({ type: 'field', field, value: editingValues[field] ?? '' });
		}
	}
};

const renderSegments = (segments: TemplateSegment[]): string =>
	segments.map((seg) => (seg.type === 'text' ? seg.value : `{${seg.field}}`)).join('');

export function renderEditForm(options: RenderEditFormOptions): EditableTemplateState {
	const editingTemplate: EditableTemplateState = { title: [], body: [] };

	const titleLine = options.container.createDiv({
		cls: 'tlb-slide-full__title tlb-slide-full__editable-title'
	});
	titleLine.style.lineHeight = `${options.page.titleLayout.lineHeight}`;
	titleLine.style.fontSize = `${options.page.titleLayout.fontSize}rem`;
	titleLine.style.fontWeight = String(options.page.titleLayout.fontWeight);
	options.position(titleLine, options.page.titleLayout, options.container);
	renderTemplateSegments(
		titleLine,
		options.page.templateRef.titleTemplate,
		options.row,
		options.fields,
		options.reservedFields,
		options.editingValues,
		options.fieldInputs,
		editingTemplate.title
	);

	const bodyContainer = options.container.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__editable-body' });
	const bodyBlock = bodyContainer.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__editable-block' });
	bodyBlock.style.lineHeight = `${options.page.textLayout.lineHeight}`;
	bodyBlock.style.fontSize = `${options.page.textLayout.fontSize}rem`;
	bodyBlock.style.fontWeight = String(options.page.textLayout.fontWeight);
	bodyBlock.style.textAlign = options.page.textLayout.align;
	const bodyLines = options.page.templateRef.bodyTemplate.split(/\r?\n/);
	if (bodyLines.length === 0) {
		bodyLines.push('');
	}
	bodyLines.forEach((line, index) => {
		const segments: TemplateSegment[] = [];
		renderTemplateSegments(
			bodyBlock,
			line,
			options.row,
			options.fields,
			options.reservedFields,
			options.editingValues,
			options.fieldInputs,
			segments
		);
		editingTemplate.body.push(segments);
		if (index < bodyLines.length - 1) {
			bodyBlock.createEl('br');
		}
	});
	options.position(bodyContainer, options.page.textLayout, options.container);

	const actions = options.container.createDiv({ cls: 'tlb-slide-full__actions' });
	const cancel = actions.createEl('button', { attr: { type: 'button' }, text: t('slideView.templateModal.cancelLabel') });
	cancel.addEventListener('click', (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		options.onCancel();
	});
	const save = actions.createEl('button', { cls: 'mod-cta', attr: { type: 'button' }, text: t('slideView.templateModal.saveLabel') });
	save.addEventListener('click', (evt) => {
		evt.preventDefault();
		evt.stopPropagation();
		const titleTemplate = renderSegments(editingTemplate.title);
		const bodyTemplate = editingTemplate.body.map(renderSegments).join('\n');
		void options.onSave({
			titleTemplate,
			bodyTemplate,
			values: { ...options.editingValues }
		});
	});

	return editingTemplate;
}
