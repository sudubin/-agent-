import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, copyFileSync, chmodSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

export const AGY_VERSION = "1.4.5";
export const AGY_URL = `https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-${AGY_VERSION}-darwin-arm64.zip`;
export const AGY_ARCHIVE_SHA256 = "886fff7767d08994ca39eb02c3d01a7532c7325a94aa33aaf52d52068733284f";
// File digests from the matching official archive, verified against the archive
// digest above. Both files must match before an existing installation is reused.
const files = {
	"agy_acp_server.par": "fb2581fb49738263db15ffccf3f48d979794ffb748350e85c335953f6b6522a2",
	"localharness_external": "9d87cb505e6efa316f55bb98459de614de867dce43cdeb5677b2153d77c283e8",
};
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(frontendRoot, "resources", "agy-acp");

async function sha256(filename) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filename)) hash.update(chunk);
	return hash.digest("hex");
}

export async function verifyArchive(filename) {
	if (!existsSync(filename) || !lstatSync(filename).isFile()) throw new Error("AGY archive must be an existing regular ZIP file.");
	if (await sha256(filename) !== AGY_ARCHIVE_SHA256) throw new Error("AGY archive SHA-256 mismatch; existing components were not changed.");
}

export async function verifyPair(directory = destination) {
	for (const [name, expected] of Object.entries(files)) {
		const filename = path.join(directory, name);
		if (!existsSync(filename) || !lstatSync(filename).isFile() || await sha256(filename) !== expected) return false;
	}
	return true;
}

export async function prepareAGY(archivePath) {
	// An explicitly supplied archive is validated even when the installed pair is
	// good, so a bad path/checksum can never masquerade as a successful import.
	if (archivePath) await verifyArchive(archivePath);
	if (await verifyPair()) {
		console.log(`Verified AGY ACP ${AGY_VERSION} pair at ${destination}`);
		return;
	}
	if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The coordinator AGY bundle currently supports macOS arm64 only.");
	const downloadRoot = mkdtempSync(path.join(tmpdir(), "coordinator-agy-"));
	let installRoot;
	let retainBackup = false;
	try {
		const archive = archivePath || path.join(downloadRoot, "agy.zip");
		if (!archivePath) {
			console.log(`Downloading official AGY ACP ${AGY_VERSION}...`);
			const response = await fetch(AGY_URL, { signal: AbortSignal.timeout(180_000) });
			if (!response.ok || !response.body) throw new Error(`AGY download failed: HTTP ${response.status}`);
			await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
			await verifyArchive(archive);
		}
		const extracted = path.join(downloadRoot, "extracted");
		const result = spawnSync("ditto", ["-x", "-k", archive, extracted], { stdio: "inherit" });
		if (result.error || result.status !== 0) throw result.error || new Error(`AGY extraction failed (${result.status})`);
		if (!await verifyPair(extracted)) throw new Error("The verified AGY archive did not contain the complete matching component pair.");
		mkdirSync(path.dirname(destination), { recursive: true });
		installRoot = mkdtempSync(path.join(path.dirname(destination), ".agy-acp-"));
		const next = path.join(installRoot, "next");
		const backup = path.join(installRoot, "previous");
		mkdirSync(next);
		for (const name of Object.keys(files)) {
			copyFileSync(path.join(extracted, name), path.join(next, name));
			chmodSync(path.join(next, name), 0o755);
		}
		// Only replace after download, checksum, extraction and pair verification.
		// A rename failure restores the previous directory rather than deleting it.
		if (existsSync(destination)) renameSync(destination, backup);
		try { renameSync(next, destination); }
		catch (cause) {
			if (existsSync(backup)) {
				try { renameSync(backup, destination); }
				catch (restoreError) {
					retainBackup = true;
					throw new AggregateError([cause, restoreError], `Could not restore AGY components; backup preserved at ${backup}`);
				}
			}
			throw cause;
		}
		console.log(`Prepared AGY ACP ${AGY_VERSION} at ${destination}`);
	} finally {
		rmSync(downloadRoot, { recursive: true, force: true });
		if (installRoot && !retainBackup) rmSync(installRoot, { recursive: true, force: true });
	}
}

async function main(args) {
	if (args.length === 1 && args[0] === "--check") {
		if (!await verifyPair()) throw new Error("AGY components are missing or do not match the pinned version. Run this script without --check to prepare them.");
		console.log(`Verified AGY ACP ${AGY_VERSION} pair at ${destination}`);
	} else if (args.length === 2 && args[0] === "--archive") {
		await prepareAGY(path.resolve(args[1]));
	} else if (args.length === 0) {
		await prepareAGY();
	} else {
		throw new Error("Usage: node scripts/prepare-coordinator-agy.mjs [--check | --archive /path/to/official.zip]");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
