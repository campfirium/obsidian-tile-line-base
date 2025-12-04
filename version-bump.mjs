#!/usr/bin/env node
import { readFile, writeFile } from "fs/promises";
import path from "path";
import process from "process";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "manifest.json");
const packagePath = path.join(repoRoot, "package.json");
const versionsPath = path.join(repoRoot, "versions.json");

const usage = `Usage:
  npm run version -- <new-version>

Example:
  npm run version -- 0.2.0`;

const semverPattern = /^\d+\.\d+\.\d+$/;

async function main() {
	const newVersion = process.argv[2];

	if (!newVersion) {
		console.error("[version] Missing new version argument.");
		console.error(usage);
		process.exit(1);
	}

	if (!semverPattern.test(newVersion)) {
		console.error(`[version] "${newVersion}" is not a valid semver (expected format: X.Y.Z).`);
		process.exit(1);
	}

	const [packageJson, manifestJson, versionsJson] = await Promise.all([
		readFile(packagePath, "utf8").then((content) => JSON.parse(content)),
		readFile(manifestPath, "utf8").then((content) => JSON.parse(content)),
		readFile(versionsPath, "utf8").then((content) => JSON.parse(content))
	]);

	const currentVersion = packageJson.version;
	if (currentVersion === newVersion) {
		console.error(`[version] Package.json already at ${newVersion}. No changes written.`);
		process.exit(1);
	}

	packageJson.version = newVersion;
	manifestJson.version = newVersion;

	if (!manifestJson.minAppVersion) {
		console.error("[version] manifest.json is missing minAppVersion. Please add it before bumping versions.");
		process.exit(1);
	}

	versionsJson[newVersion] = manifestJson.minAppVersion;

	const writeOperations = [
		writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
		writeFile(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`, "utf8"),
		writeFile(versionsPath, `${JSON.stringify(versionsJson, null, 2)}\n`, "utf8")
	];

	await Promise.all(writeOperations);

	console.log(`[version] Updated package.json, manifest.json, and versions.json to ${newVersion}.`);
}

main().catch((error) => {
	console.error("[version] Failed to bump version.");
	console.error(error);
	process.exit(1);
});
