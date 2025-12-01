import fs from "fs";
import path from "path";

// 默认来源与目标目录，可通过环境变量覆盖
const SOURCE_DIR = "D:\\X\\Dropbox\\obt\\.obsidian\\plugins\\tile-line-base";
const TARGET_DIR = "D:\\X\\Dropbox\\obs\\.obsidian\\plugins\\tile-line-base";
const isLinux = process.platform === "linux";

function toWslPath(rawPath) {
	const normalized = rawPath.replace(/\\/g, "/");
	const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
	if (!match) {
		return normalized;
	}

	const drive = match[1].toLowerCase();
	const rest = match[2];
	return `/mnt/${drive}/${rest}`;
}

function resolvePath(rawPath, envKey) {
	const override = process.env[envKey];
	const base = override && override.trim().length > 0 ? override.trim() : rawPath;
	return isLinux ? toWslPath(base) : base;
}

function ensureSourceDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		console.log("⚠️ 源目录不存在，无法镜像。");
		console.log(`   路径: ${dirPath}`);
		process.exit(1);
	}

	if (!fs.statSync(dirPath).isDirectory()) {
		console.log("⚠️ 源路径不是目录。");
		console.log(`   路径: ${dirPath}`);
		process.exit(1);
	}
}

function safeRealpath(targetPath) {
	try {
		return fs.realpathSync(targetPath);
	} catch {
		return targetPath;
	}
}

function clearTarget(dirPath) {
	fs.rmSync(dirPath, { recursive: true, force: true });
	fs.mkdirSync(dirPath, { recursive: true });
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

const resolvedSource = resolvePath(SOURCE_DIR, "PLUGIN_SRC");
const resolvedTarget = resolvePath(TARGET_DIR, "PLUGIN_DST");

console.log("🚀 开始镜像 Dropbox 插件目录...\n");
console.log(`📁 源目录: ${resolvedSource}`);
console.log(`🎯 目标目录: ${resolvedTarget}\n`);

ensureSourceDir(resolvedSource);

const sourceReal = safeRealpath(resolvedSource);
const targetReal = safeRealpath(resolvedTarget);
if (sourceReal === targetReal) {
	console.log("⚠️ 源路径与目标路径相同，已中止以避免误删。");
	process.exit(1);
}

console.log("🧹 清空目标目录...");
clearTarget(resolvedTarget);

console.log("📦 复制文件...");
copyDir(resolvedSource, resolvedTarget);

console.log("\n✅ 镜像完成，目标已与源对齐。");
console.log(`🕒 结束时间: ${new Date().toLocaleString()}`);
