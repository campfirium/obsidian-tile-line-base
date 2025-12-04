import fs from "fs";
import path from "path";

const ENV_KEYS = ["PLUGIN_DIR", "OBSIDIAN_PLUGIN_DIR"];
const FILES_TO_COPY = [
	{ source: "dist/main.js", target: "main.js" },
	{ source: "manifest.json", target: "manifest.json" },
	{ source: "styles.css", target: "styles.css" }
];

function isWSL() {
	if (process.platform !== "linux") {
		return false;
	}

	try {
		const release = fs.readFileSync("/proc/sys/kernel/osrelease", "utf-8");
		return release.toLowerCase().includes("microsoft");
	} catch {
		return false;
	}
}

function windowsPathToWsl(pathString) {
	const normalized = pathString.replace(/\\/g, "/");
	const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
	if (!match) {
		return normalized;
	}

	const drive = match[1].toLowerCase();
	const rest = match[2];
	return `/mnt/${drive}/${rest}`;
}

function readEnvConfig() {
	const envPath = path.resolve(process.cwd(), ".env");
	if (!fs.existsSync(envPath)) {
		return {};
	}

	const result = {};
	const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, eqIndex).trim();
		const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
		if (key) {
			result[key] = value;
		}
	}
	return result;
}

function resolvePluginDir() {
	const envConfig = readEnvConfig();
	for (const key of ENV_KEYS) {
		const candidate = process.env[key] || envConfig[key];
		if (candidate && candidate.trim().length > 0) {
			if (isWSL()) {
				return windowsPathToWsl(candidate);
			}
			return candidate;
		}
	}

	console.log("⚠️ 未检测到插件目录配置。");
	console.log("💡 请在环境变量或 .env 中设置 PLUGIN_DIR 或 OBSIDIAN_PLUGIN_DIR，用于指向 Obsidian 插件目录。");
	process.exit(1);
}

const pluginDir = resolvePluginDir();

console.log("🚀 开始部署插件到 Obsidian (WSL)...\n");
console.log(`🎯 目标目录: ${pluginDir}\n`);

if (!fs.existsSync(pluginDir)) {
	console.log(`📁 目标目录不存在，尝试创建: ${pluginDir}`);
	fs.mkdirSync(pluginDir, { recursive: true });
}

console.log("📦 复制文件...");
for (const { source, target } of FILES_TO_COPY) {
	const sourcePath = path.join(process.cwd(), source);
	const targetPath = path.join(pluginDir, target);

	if (fs.existsSync(sourcePath)) {
		fs.copyFileSync(sourcePath, targetPath);
		console.log(`  ✅ ${target} ← ${source}`);
	} else {
		console.log(`  ⚠️ ${source} 不存在，跳过`);
	}
}

console.log("\n✅ 文件复制完成。");
console.log("\n🎉 部署完成！请在 Obsidian 中重载插件。");
