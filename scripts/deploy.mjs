import fs from "fs";
import path from "path";

const ENV_KEYS = ["PLUGIN_DIR", "OBSIDIAN_PLUGIN_DIR"];
const DIST_DIR = path.resolve(process.cwd(), "dist");
const ROOT_FILES = [
	{ source: "manifest.json", label: "manifest.json" },
];

const isLinux = process.platform === "linux";

function isWSL() {
	if (!isLinux) {
		return false;
	}
	try {
		const release = fs.readFileSync("/proc/sys/kernel/osrelease", "utf8");
		return release.toLowerCase().includes("microsoft");
	} catch {
		return false;
	}
}

function normalizeTargetPath(rawPath) {
	const effective = rawPath.trim();
	if (!isLinux) {
		return effective;
	}
	const match = effective.match(/^([a-zA-Z]):\\(.*)$/);
	if (!match) {
		return effective;
	}
	const drive = match[1].toLowerCase();
	const rest = match[2].replace(/\\/g, "/");
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
			return normalizeTargetPath(candidate);
		}
	}

	console.log("⚠️ 未检测到插件目录配置。");
	console.log("💡 请在环境变量或 .env 中设置 PLUGIN_DIR 或 OBSIDIAN_PLUGIN_DIR，用于指向 Obsidian 插件目录。");
	process.exit(1);
}

function ensureDistExists() {
	if (!fs.existsSync(DIST_DIR)) {
		console.log(`⚠️ 未找到 dist 目录: ${DIST_DIR}`);
		console.log("💡 请先运行 npm run build 后再尝试部署。");
		process.exit(1);
	}
}

function assertNotSymlink(targetPath) {
	if (!fs.existsSync(targetPath)) {
		return;
	}

	const stats = fs.lstatSync(targetPath);
	if (stats.isSymbolicLink()) {
		console.log("⚠️ 检测到部署目录是符号链接。");
		console.log(`   位置: ${targetPath}`);
		console.log("💡 请删除该符号链接并创建真实目录后再执行部署。");
		process.exit(1);
	}
}

function ensureTargetDir(targetPath) {
	if (!fs.existsSync(targetPath)) {
		fs.mkdirSync(targetPath, { recursive: true });
		return;
	}

	const stats = fs.statSync(targetPath);
	if (!stats.isDirectory()) {
		console.log("⚠️ 目标路径存在但不是目录。");
		console.log(`   位置: ${targetPath}`);
		console.log("💡 请手动处理该路径后重新运行部署。");
		process.exit(1);
	}
}

function copyDir(source, target) {
	const entries = fs.readdirSync(source, { withFileTypes: true });

	for (const entry of entries) {
		const sourcePath = path.join(source, entry.name);
		const targetPath = path.join(target, entry.name);

		if (entry.isDirectory()) {
			fs.mkdirSync(targetPath, { recursive: true });
			copyDir(sourcePath, targetPath);
		} else if (entry.isSymbolicLink()) {
			const realPath = fs.realpathSync(sourcePath);
			const stats = fs.statSync(realPath);

			if (stats.isDirectory()) {
				fs.mkdirSync(targetPath, { recursive: true });
				copyDir(realPath, targetPath);
			} else {
				fs.copyFileSync(realPath, targetPath);
			}
		} else {
			fs.copyFileSync(sourcePath, targetPath);
		}
	}
}

function copyRootFiles(targetPath) {
	for (const { source, label } of ROOT_FILES) {
		const sourcePath = path.resolve(process.cwd(), source);

		if (!fs.existsSync(sourcePath)) {
			console.log(`⚠️ ${label} 不存在，跳过复制。`);
			continue;
		}

		const targetFile = path.join(targetPath, path.basename(source));
		fs.copyFileSync(sourcePath, targetFile);
		console.log(`  ✅ ${label}`);
	}
}

const resolvedPluginDir = resolvePluginDir();
const usingWSLBridge = isWSL();

console.log("🚀 开始部署插件到 Obsidian...\n");
console.log(`🎯 目标目录: ${resolvedPluginDir}${usingWSLBridge ? " (WSL 路径已转换)" : ""}`);

ensureDistExists();
assertNotSymlink(resolvedPluginDir);

console.log("📂 确保目标目录可用...");
ensureTargetDir(resolvedPluginDir);

console.log("📦 复制 dist 内容...");
copyDir(DIST_DIR, resolvedPluginDir);

console.log("📄 同步根目录文件...");
copyRootFiles(resolvedPluginDir);

console.log("\n✅ 部署完成！请在 Obsidian 中重载插件以应用最新构建。");
console.log(`🕒 结束时间: ${new Date().toLocaleString()}`);
