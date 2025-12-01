import fs from "fs";
import path from "path";

// 默认来源与目标目录，可通过环境变量覆盖
const SOURCE_DIR = "D:\\X\\Dropbox\\obt\\.obsidian\\plugins\\tile-line-base";
const TARGET_DIR = "D:\\X\\Dropbox\\obs\\.obsidian\\plugins\\tile-line-base";
const FILES_TO_COPY = ["main.js", "manifest.json", "styles.css"];
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

function ensureWritableDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		return;
	}

	if (!fs.statSync(dirPath).isDirectory()) {
		console.log("⚠️ 目标路径不是目录，无法镜像。");
		console.log(`   路径: ${dirPath}`);
		process.exit(1);
	}

	try {
		fs.accessSync(dirPath, fs.constants.W_OK);
	} catch (error) {
		console.log("⚠️ 目标目录不可写，无法镜像。");
		console.log(`   路径: ${dirPath}`);
		console.log(`   错误: ${error.code || error.message}`);
		process.exit(1);
	}
}

function copyFileIfAvailable(sourceDir, targetDir, fileName) {
	const sourcePath = path.join(sourceDir, fileName);
	const targetPath = path.join(targetDir, fileName);

	if (!fs.existsSync(sourcePath)) {
		console.log(`⚠️ 源文件缺失，已跳过: ${fileName}`);
		return;
	}

	const stats = fs.lstatSync(sourcePath);
	if (stats.isDirectory()) {
		console.log(`⚠️ 源路径是目录，已跳过: ${fileName}`);
		return;
	}

	const realSourcePath = stats.isSymbolicLink() ? fs.realpathSync(sourcePath) : sourcePath;

	try {
		fs.copyFileSync(realSourcePath, targetPath);
		console.log(`✅ 已覆盖: ${fileName}`);
	} catch (error) {
		console.log("⚠️ 复制文件失败。");
		console.log(`   源: ${realSourcePath}`);
		console.log(`   目标: ${targetPath}`);
		console.log(`   错误: ${error.code || error.message}`);
		process.exit(1);
	}
}

function copySelectedFiles(sourceDir, targetDir) {
	ensureWritableDir(targetDir);
	for (const fileName of FILES_TO_COPY) {
		copyFileIfAvailable(sourceDir, targetDir, fileName);
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

console.log("📦 覆盖核心文件（不清空目标目录）...");
copySelectedFiles(resolvedSource, resolvedTarget);

console.log("\n✅ 镜像完成，目标已与源对齐。");
console.log(`🕒 结束时间: ${new Date().toLocaleString()}`);
