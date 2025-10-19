import fs from 'fs';
import path from 'path';

const FILES_TO_COPY = [
	{ source: 'dist/main.js', target: 'main.js' },
	{ source: 'manifest.json', target: 'manifest.json' },
	{ source: 'styles.css', target: 'styles.css' },
];
const WINDOWS_PLUGIN_DIR = 'D:\\C\\obsidian-tile-line-base\\docs\\.obsidian\\plugins\\tile-line-base';

function isWSL() {
	if (process.platform !== 'linux') return false;
	try {
		const release = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf-8');
		return release.toLowerCase().includes('microsoft');
	} catch (error) {
		return false;
	}
}

function windowsPathToWsl(pathString) {
	const normalized = pathString.replace(/\\/g, '/');
	const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
	if (!match) {
		return normalized;
	}

	const drive = match[1].toLowerCase();
	const rest = match[2];
	return `/mnt/${drive}/${rest}`;
}

function resolvePluginDir() {
	const override = process.env.PLUGIN_DIR || process.env.OBSIDIAN_PLUGIN_DIR;
	if (override) {
		return override;
	}

	if (isWSL()) {
		return windowsPathToWsl(WINDOWS_PLUGIN_DIR);
	}

	return WINDOWS_PLUGIN_DIR;
}

const pluginDir = resolvePluginDir();

console.log('🚀 开始部署插件到 Obsidian (WSL)...\n');
console.log(`🎯 目标目录: ${pluginDir}\n`);

if (!fs.existsSync(pluginDir)) {
	console.log(`📁 目标目录不存在，尝试创建: ${pluginDir}`);
	fs.mkdirSync(pluginDir, { recursive: true });
}

console.log('📦 复制文件...');
for (const { source, target } of FILES_TO_COPY) {
	const sourcePath = path.join(process.cwd(), source);
	const targetPath = path.join(pluginDir, target);

	if (fs.existsSync(sourcePath)) {
		fs.copyFileSync(sourcePath, targetPath);
		console.log(`  ✓ ${target} ← ${source}`);
	} else {
		console.log(`  ⚠ ${source} 不存在，跳过`);
	}
}

console.log('\n✅ 文件复制完成！');
console.log('\n🎉 部署完成！请在 Obsidian 中重载插件。');
