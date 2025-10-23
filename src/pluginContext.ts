import type TileLineBasePlugin from './main';

let pluginInstance: TileLineBasePlugin | null = null;

export function setPluginContext(plugin: TileLineBasePlugin | null): void {
	pluginInstance = plugin;
}

export function getPluginContext(): TileLineBasePlugin | null {
	return pluginInstance;
}
