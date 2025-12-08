import {
	getDefaultBodyLayout,
	getDefaultTitleLayout,
	normalizeSlideViewConfig
} from '../../types/slide';

export function ensureLayoutDefaults(config: ReturnType<typeof normalizeSlideViewConfig>): typeof config {
	const template = config.template;
	return {
		...config,
		template: {
			mode: template.mode ?? 'single',
			textColor: template.textColor ?? '',
			backgroundColor: template.backgroundColor ?? '',
			single: {
				withImage: {
					...template.single.withImage,
					titleLayout: template.single.withImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.single.withImage.bodyLayout ?? getDefaultBodyLayout(),
					imageLayout: template.single.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: {
					...template.single.withoutImage,
					titleLayout: template.single.withoutImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.single.withoutImage.bodyLayout ?? getDefaultBodyLayout()
				}
			},
			split: {
				withImage: {
					...template.split.withImage,
					textPage: {
						...template.split.withImage.textPage,
						titleLayout: template.split.withImage.textPage.titleLayout ?? getDefaultTitleLayout(),
						bodyLayout: template.split.withImage.textPage.bodyLayout ?? getDefaultBodyLayout()
					},
					imageLayout: template.split.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: {
					...template.split.withoutImage,
					titleLayout: template.split.withoutImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.split.withoutImage.bodyLayout ?? getDefaultBodyLayout()
				}
			}
		}
	};
}

export function buildRenderConfig(options: {
	config: ReturnType<typeof normalizeSlideViewConfig>;
}): {
	normalizedConfig: ReturnType<typeof normalizeSlideViewConfig>;
	renderConfig: ReturnType<typeof normalizeSlideViewConfig>;
	templateTouched: boolean;
	allowAutoFillNext: boolean;
	appliedDefaults: boolean;
} {
	const baseConfig = ensureLayoutDefaults(normalizeSlideViewConfig(options.config));
	const renderConfig = baseConfig;
	return {
		normalizedConfig: baseConfig,
		renderConfig,
		templateTouched: true,
		allowAutoFillNext: false,
		appliedDefaults: false
	};
}
