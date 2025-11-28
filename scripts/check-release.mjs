#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const MAX_MAIN_SIZE = 2_050_000;
const ALLOWED_DIST_FILES = new Set(["main.js", "styles.css"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

const fail = (message) => {
	console.error(`[check:release] ${message}`);
	process.exit(1);
};

const info = (message) => {
	console.log(`[check:release] ${message}`);
};

const readJson = (relativePath) => {
	const filePath = path.join(rootDir, relativePath);

	try {
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		fail(`无法读取或解析 ${relativePath}: ${error.message}`);
	}
};

const ensureDistLayout = () => {
	let entries;

	try {
		entries = readdirSync(distDir, { withFileTypes: true });
	} catch (error) {
		fail(`dist 目录不存在或无法访问: ${error.message}`);
	}

	const unexpected = [];
	let hasMain = false;

	for (const entry of entries) {
		if (!ALLOWED_DIST_FILES.has(entry.name)) {
			unexpected.push(entry.name);
			continue;
		}

		if (entry.isDirectory()) {
			unexpected.push(`${entry.name}/`);
			continue;
		}

		if (entry.name === "main.js") {
			hasMain = true;
		}
	}

	if (!hasMain) {
		fail("dist/main.js 缺失。");
	}

	if (unexpected.length > 0) {
		fail(`dist 目录包含不允许的文件: ${unexpected.join(", ")}`);
	}
};

const ensureBundleSize = () => {
	const mainPath = path.join(distDir, "main.js");
	const stat = statSync(mainPath);

	if (stat.size > MAX_MAIN_SIZE) {
		fail(`dist/main.js 体积为 ${stat.size} 字节，超过 2 MB 限制。`);
	}

	info(`main.js 体积 ${stat.size} 字节`);
};

const ensureVersionConsistency = () => {
	const packageJson = readJson("package.json");
	const manifestJson = readJson("manifest.json");
	const versionsJson = readJson("versions.json");

	const pkgVersion = packageJson.version;
	const manifestVersion = manifestJson.version;
	const manifestMinAppVersion = manifestJson.minAppVersion;

	if (!VERSION_PATTERN.test(pkgVersion)) {
		fail(`package.json version (${pkgVersion}) 未采用固定 SemVer 格式。`);
	}

	if (pkgVersion !== manifestVersion) {
		fail(`package.json (${pkgVersion}) 与 manifest.json (${manifestVersion}) 版本不一致。`);
	}

	if (!manifestMinAppVersion || !VERSION_PATTERN.test(manifestMinAppVersion)) {
		fail(`manifest.json 的 minAppVersion (${manifestMinAppVersion}) 非 SemVer 格式。`);
	}

	if (versionsJson[pkgVersion] !== manifestMinAppVersion) {
		fail(`versions.json 中 ${pkgVersion} -> ${versionsJson[pkgVersion]}，与 manifest.minAppVersion (${manifestMinAppVersion}) 不一致。`);
	}

	if (!packageJson.author || packageJson.author.trim().length === 0) {
		fail("package.json.author 不得为空。");
	}

	if (!manifestJson.author || manifestJson.author.toLowerCase().includes("your name")) {
		fail("manifest.json.author 需要填写真实作者信息。");
	}

	if (!manifestJson.authorUrl || manifestJson.authorUrl.toLowerCase().includes("yourusername")) {
		fail("manifest.json.authorUrl 需要填写真实作者链接。");
	}

	info(`版本一致性检验通过：${pkgVersion} / minAppVersion ${manifestMinAppVersion}`);
};

const ensurePinnedDependencies = () => {
	const packageJson = readJson("package.json");
	const sections = [
		{ label: "dependencies", payload: packageJson.dependencies ?? {} },
		{ label: "devDependencies", payload: packageJson.devDependencies ?? {} }
	];

	for (const { label, payload } of sections) {
		for (const [name, version] of Object.entries(payload)) {
			if (!VERSION_PATTERN.test(version)) {
				fail(`${label} 中 ${name}@${version} 未使用固定版本号。`);
			}
		}
	}
};

const main = () => {
	ensureDistLayout();
	ensureBundleSize();
	ensureVersionConsistency();
	ensurePinnedDependencies();
	info("检测通过。");
};

main();
