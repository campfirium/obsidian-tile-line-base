import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const failures = [];

function fail(message) {
	failures.push(message);
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseNpmrc(content) {
	const values = new Map();
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith(';')) continue;
		const separatorIndex = line.indexOf('=');
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		values.set(key, value);
	}
	return values;
}

function checkNpmrc() {
	const npmrcPath = path.join(rootDir, '.npmrc');
	if (!fs.existsSync(npmrcPath)) {
		fail('缺少 .npmrc');
		return;
	}

	const values = parseNpmrc(fs.readFileSync(npmrcPath, 'utf8'));
	const expectedEntries = [
		['audit', 'false'],
		['fund', 'false'],
		['save-exact', 'true'],
		['min-release-age', '7']
	];

	for (const [key, expectedValue] of expectedEntries) {
		const actualValue = values.get(key);
		if (actualValue !== expectedValue) {
			fail(`.npmrc 中 ${key} 期望为 ${expectedValue}，当前为 ${actualValue ?? '未设置'}`);
		}
	}
}

function checkPackageJson() {
	const packageJson = readJson(path.join(rootDir, 'package.json'));
	const buildScript = packageJson.scripts?.build ?? '';
	const hardeningScript = packageJson.scripts?.['deps:hardening:check'] ?? '';

	if (!buildScript) {
		fail('package.json 缺少 build 脚本');
	} else if (/\bnpx\b/.test(buildScript)) {
		fail('build 脚本仍包含 npx');
	}

	if (!hardeningScript) {
		fail('package.json 缺少 deps:hardening:check 脚本');
	}

	if (packageJson.packageManager !== 'npm@11.12.0') {
		fail(`packageManager 期望为 npm@11.12.0，当前为 ${packageJson.packageManager ?? '未设置'}`);
	}
}

function checkInstallScriptPackages() {
	const lockfilePath = path.join(rootDir, 'package-lock.json');
	if (!fs.existsSync(lockfilePath)) {
		fail('缺少 package-lock.json');
		return;
	}

	const lockfile = readJson(lockfilePath);
	const actualPackages = Object.entries(lockfile.packages ?? {})
		.filter(([, pkg]) => pkg?.hasInstallScript)
		.map(([pkgPath]) => pkgPath || '.')
		.sort();
	const expectedPackages = ['node_modules/esbuild', 'node_modules/unrs-resolver'];

	if (actualPackages.length !== expectedPackages.length) {
		fail(`带安装脚本的包数量变化：期望 ${expectedPackages.length}，当前 ${actualPackages.length}`);
		return;
	}

	for (let index = 0; index < expectedPackages.length; index += 1) {
		if (actualPackages[index] !== expectedPackages[index]) {
			fail(
				`带安装脚本的包名单变化：期望 ${expectedPackages.join(', ')}，当前 ${actualPackages.join(', ')}`
			);
			return;
		}
	}
}

function runAudit() {
	const maxAttempts = 3;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const result = spawnSync('npm', ['audit', '--omit=dev'], {
			cwd: rootDir,
			encoding: 'utf8'
		});

		if (result.stdout) {
			process.stdout.write(result.stdout);
		}

		if (result.status === 0) {
			return;
		}

		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		const canRetry = /audit endpoint returned an error|socket disconnected|ECONNRESET|ETIMEDOUT/i.test(output);
		if (!canRetry || attempt === maxAttempts) {
			if (result.stderr) {
				process.stderr.write(result.stderr);
			}
			fail('npm audit --omit=dev 未通过');
			return;
		}

		console.warn(`npm audit --omit=dev 网络失败，正在重试 (${attempt + 1}/${maxAttempts})`);
	}
}

function runDepsScan() {
	try {
		execFileSync('npm', ['run', 'deps:scan'], {
			cwd: rootDir,
			stdio: 'inherit'
		});
	} catch {
		fail('npm run deps:scan 未通过');
	}
}

const minReleaseAgeProbePackages = ['npm', 'eslint', 'typescript-eslint', 'vite', '@types/node'];

function getPackageVersionTimes(packageName) {
	const output = execFileSync('npm', ['view', packageName, 'time', '--json'], {
		cwd: rootDir,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit']
	});
	return JSON.parse(output);
}

function isStableSemver(version) {
	return /^\d+\.\d+\.\d+$/.test(version);
}

function pickMinReleaseAgeCandidates(timeMap, packageName) {
	const now = Date.now();
	const cutoffMs = 7 * 24 * 60 * 60 * 1000;
	const versions = Object.entries(timeMap)
		.filter(([version, publishedAt]) => isStableSemver(version) && typeof publishedAt === 'string')
		.map(([version, publishedAt]) => ({
			version,
			publishedAt,
			publishedMs: new Date(publishedAt).getTime()
		}))
		.filter((entry) => Number.isFinite(entry.publishedMs))
		.sort((left, right) => right.publishedMs - left.publishedMs);

	const tooRecent = versions.find((entry) => now - entry.publishedMs < cutoffMs);
	const aged = versions.find((entry) => now - entry.publishedMs >= cutoffMs);

	if (!tooRecent || !aged) {
		return null;
	}

	return { packageName, tooRecent, aged };
}

function pickMinReleaseAgeProbe() {
	for (const packageName of minReleaseAgeProbePackages) {
		const candidates = pickMinReleaseAgeCandidates(getPackageVersionTimes(packageName), packageName);
		if (candidates) {
			return candidates;
		}
	}

	fail('无法从 npm registry 自动挑出 min-release-age 探针版本');
	return null;
}

function runInstallProbe(tempDir, packageName, version) {
	const result = spawnSync(
		'npm',
		['install', `${packageName}@${version}`, '--package-lock-only', '--ignore-scripts', '--audit=false', '--fund=false'],
		{
			cwd: tempDir,
			encoding: 'utf8'
		}
	);

	return {
		status: result.status ?? 1,
		output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
	};
}

function checkMinReleaseAgeProbe() {
	const candidates = pickMinReleaseAgeProbe();
	if (!candidates) return;

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlb-min-release-age-'));

	try {
		fs.writeFileSync(
			path.join(tempDir, 'package.json'),
			JSON.stringify(
				{
					name: 'tlb-min-release-age-probe',
					private: true,
					version: '0.0.0'
				},
				null,
				2
			)
		);
		fs.writeFileSync(
			path.join(tempDir, '.npmrc'),
			['audit=false', 'fund=false', 'save-exact=true', 'min-release-age=7'].join('\n')
		);

		const blockedProbe = runInstallProbe(tempDir, candidates.packageName, candidates.tooRecent.version);
		if (blockedProbe.status === 0) {
			fail(
				`min-release-age 探针失败：过新版本 ${candidates.packageName}@${candidates.tooRecent.version} 未被拦住`
			);
		}

		const allowedProbe = runInstallProbe(tempDir, candidates.packageName, candidates.aged.version);
		if (allowedProbe.status !== 0) {
			fail(
				`min-release-age 探针失败：已过冷却期的 ${candidates.packageName}@${candidates.aged.version} 未通过`
			);
		}

		console.log(
			`min-release-age 探针通过：拦截 ${candidates.packageName}@${candidates.tooRecent.version}，放行 ${candidates.packageName}@${candidates.aged.version}`
		);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

checkNpmrc();
checkPackageJson();
checkInstallScriptPackages();
checkMinReleaseAgeProbe();
runAudit();
runDepsScan();

if (failures.length > 0) {
	console.error('\n依赖收紧检查失败:');
	for (const message of failures) {
		console.error(`- ${message}`);
	}
	process.exit(1);
}

console.log('\n依赖收紧检查通过');
