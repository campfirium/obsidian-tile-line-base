#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ALLOWED_DIST_FILES = new Set(["main.js", "styles.css"]);
const ID_PATTERN = /^[a-z0-9-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const sourceDir = path.join(rootDir, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const DESKTOP_ONLY_MODULES = [
	"electron",
	"fs",
	"path",
	"os",
	"child_process",
	"crypto",
	"http",
	"https",
	"net",
	"tls",
	"zlib",
	"stream",
	"url",
	"buffer",
	"worker_threads"
];
const FORBIDDEN_SOURCE_PATTERNS = [
	{ label: "innerHTML", regex: /\binnerHTML\b/ },
	{ label: "outerHTML", regex: /\bouterHTML\b/ },
	{ label: "insertAdjacentHTML", regex: /\binsertAdjacentHTML\b/ },
	{ label: "eval()", regex: /\beval\s*\(/ },
	{ label: "new Function()", regex: /\bnew Function\s*\(/ },
	{ label: "Function()", regex: /\bFunction\s*\(/ },
	{ label: "console.trace", regex: /\bconsole\.trace\b/ }
];
const HOTKEY_PATTERN = { label: "default hotkeys", regex: /\bhotkeys\s*:/ };

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

const listSourceFiles = () => {
	let entries;
	try {
		entries = readdirSync(sourceDir, { withFileTypes: true });
	} catch (error) {
		fail(`src 目录不存在或无法访问: ${error.message}`);
	}

	const results = [];
	const walk = (dirEntries, baseDir) => {
		for (const entry of dirEntries) {
			const fullPath = path.join(baseDir, entry.name);
			if (entry.isDirectory()) {
				const nested = readdirSync(fullPath, { withFileTypes: true });
				walk(nested, fullPath);
				continue;
			}
			if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
				results.push(fullPath);
			}
		}
	};

	walk(entries, sourceDir);
	return results;
};

const indexToLine = (content, index) => {
	if (index <= 0) {
		return 1;
	}
	return content.slice(0, index).split(/\r?\n/).length;
};

const scanSource = (patterns) => {
	const files = listSourceFiles();
	const findings = [];

	for (const filePath of files) {
		const content = readFileSync(filePath, "utf8");
		for (const pattern of patterns) {
			const index = content.search(pattern.regex);
			if (index === -1) {
				continue;
			}
			findings.push({
				label: pattern.label,
				file: path.relative(rootDir, filePath).replace(/\\/g, "/"),
				line: indexToLine(content, index)
			});
		}
	}

	return findings;
};

const formatFindings = (findings) => findings
	.map((finding) => `${finding.file}:${finding.line} ${finding.label}`)
	.join("\n");

const buildModulePattern = (name) => new RegExp(
	`\\bfrom\\s+['"]${name}['"]|\\brequire\\s*\\??\\.?\\s*\\(\\s*['"]${name}['"]\\s*\\)|\\bimport\\s*\\(\\s*['"]${name}['"]\\s*\\)`,
	""
);

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

const getDistFileSizes = () => {
	const entries = readdirSync(distDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && ALLOWED_DIST_FILES.has(entry.name))
		.map((entry) => ({
			name: entry.name,
			size: statSync(path.join(distDir, entry.name)).size
		}));
};

const logBundleSize = () => {
	const files = getDistFileSizes();
	const total = files.reduce((sum, file) => sum + file.size, 0);
	for (const file of files) {
		info(`${file.name} 体积 ${file.size} 字节`);
	}
	info(`dist 总体积 ${total} 字节`);
	return total;
};


const ensureManifestBasics = (manifestJson) => {
	if (!manifestJson.id || !ID_PATTERN.test(manifestJson.id)) {
		fail(`manifest.json.id (${manifestJson.id}) 需为小写字母、数字或连字符。`);
	}
	if (!manifestJson.name || String(manifestJson.name).trim().length === 0) {
		fail("manifest.json.name 不得为空。");
	}
	if (!manifestJson.description || String(manifestJson.description).trim().length === 0) {
		fail("manifest.json.description 不得为空。");
	}
};

const ensureVersionConsistency = (packageJson, manifestJson, versionsJson) => {
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

const ensurePinnedDependencies = (packageJson) => {
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

const ensureNoForbiddenPatterns = () => {
	const findings = scanSource(FORBIDDEN_SOURCE_PATTERNS);
	if (findings.length > 0) {
		fail(`源码包含禁止用法:\n${formatFindings(findings)}`);
	}
};

const ensureNoDefaultHotkeys = () => {
	const findings = scanSource([HOTKEY_PATTERN]);
	if (findings.length > 0) {
		fail(`检测到默认热键设置，请移除:\n${formatFindings(findings)}`);
	}
};

const ensureDesktopOnlyForNodeApis = (manifestJson) => {
	const patterns = DESKTOP_ONLY_MODULES.map((name) => ({
		label: name,
		regex: buildModulePattern(name)
	}));
	const findings = scanSource(patterns);
	if (findings.length === 0) {
		return;
	}

	if (!manifestJson.isDesktopOnly) {
		fail(`检测到 Node/Electron API，但 manifest.isDesktopOnly 非 true:\n${formatFindings(findings)}`);
	}
	info(`检测到 Node/Electron API，manifest.isDesktopOnly = true:\n${formatFindings(findings)}`);
};

const main = () => {
	ensureDistLayout();
	logBundleSize();
	const packageJson = readJson("package.json");
	const manifestJson = readJson("manifest.json");
	const versionsJson = readJson("versions.json");
	ensureManifestBasics(manifestJson);
	ensureVersionConsistency(packageJson, manifestJson, versionsJson);
	ensurePinnedDependencies(packageJson);
	ensureNoForbiddenPatterns();
	ensureNoDefaultHotkeys();
	ensureDesktopOnlyForNodeApis(manifestJson);
	info("检测通过。");
};

main();
