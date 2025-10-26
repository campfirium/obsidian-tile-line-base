import fs from "fs";
import path from "path";

// 目标插件目录（固定为 Dropbox Vault 内的真实文件夹）
const PLUGIN_DIR = "D:\\X\\Dropbox\\obt\\.obsidian\\plugins\\tile-line-base";
const DIST_DIR = path.resolve(process.cwd(), "dist");
const ROOT_FILES = [
	{ source: "manifest.json", label: "manifest.json" },
];

function ensureDistExists() {
	if (!fs.existsSync(DIST_DIR)) {
		console.log(`❌ 未找到 dist 目录: ${DIST_DIR}`);
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
		console.log("❌ 检测到部署目录是符号链接。");
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

console.log("🚀 开始部署插件到 Obsidian...\n");
console.log(`🎯 目标目录: ${PLUGIN_DIR}`);

ensureDistExists();
assertNotSymlink(PLUGIN_DIR);

console.log("📂 确保目标目录可用...");
ensureTargetDir(PLUGIN_DIR);

console.log("📦 复制 dist 内容...");
copyDir(DIST_DIR, PLUGIN_DIR);

console.log("📄 同步根目录文件...");
copyRootFiles(PLUGIN_DIR);

console.log("\n✅ 部署完成！请在 Obsidian 中重载插件以应用最新构建。");
console.log(`🕒 结束时间: ${new Date().toLocaleString()}`);
