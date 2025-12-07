#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const rootDir = process.cwd();
const releasesPath = path.join(rootDir, "releases.json");
const outputPath = path.join(rootDir, "release-notes.md");
const tagArg = process.argv[2];
const TAG_PATTERN = /^v?(\d+\.\d+\.\d+)$/;

const fail = (message) => {
	console.error(`[release-notes] ${message}`);
	process.exit(1);
};

const normalizeList = (value) => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
};

const main = () => {
	if (!tagArg) {
		fail("Missing tag argument. Usage: node scripts/genReleaseNotes.mjs v0.0.0");
	}

	const tagMatch = TAG_PATTERN.exec(tagArg);
	if (!tagMatch) {
		fail(`Invalid tag "${tagArg}". Expected format vX.Y.Z or X.Y.Z.`);
	}

	const version = tagMatch[1];

	let releases;
	try {
		releases = JSON.parse(readFileSync(releasesPath, "utf8"));
	} catch (error) {
		fail(`Cannot read or parse releases.json: ${error.message}`);
	}

	const entry = releases[version];
	if (!entry) {
		fail(`No entry for version ${version} in releases.json.`);
	}

	const info = typeof entry.info === "string" ? entry.info.trim() : "";
	const sections = [
		["New", normalizeList(entry.new)],
		["Improved", normalizeList(entry.improved)],
		["Fixed", normalizeList(entry.fixed)],
		["Changed", normalizeList(entry.changed)]
	];

	const lines = [];
	if (info.length > 0) {
		lines.push(info);
		lines.push("");
	}

	for (const [title, items] of sections) {
		if (items.length === 0) {
			continue;
		}

		lines.push(`**${title}**`);
		for (const item of items) {
			lines.push(`- ${item}`);
		}
		lines.push("");
	}

	if (lines[lines.length - 1] === "") {
		lines.pop();
	}

	writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
	console.log(`[release-notes] Wrote release-notes.md for v${version}`);
};

main();
