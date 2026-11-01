import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = process.env.AO_VENDOR_RESOURCES ? path.resolve(process.env.AO_VENDOR_RESOURCES) : null;
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, env: { ...process.env, AO_COORDINATOR_BUILD: "1" }, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("协作台当前构建目标为 macOS arm64，请在 Apple Silicon Mac 上构建。");
// AO code is compiled from this checkout, never borrowed from the installed app.
run(process.execPath, ["scripts/build-daemon.mjs"]);
// Pinned upstream builders are the default. Reuse an installed runtime only
// when the caller explicitly opts in with AO_VENDOR_RESOURCES.
for (const [destination, fallback] of [["tmux", "build:tmux"], ["resources/acp-runtime", "build:acp-runtime"]]) {
	const source = resources && path.join(resources, destination === "resources/acp-runtime" ? "acp-runtime" : destination);
	if (source && existsSync(source)) {
		if (!existsSync(path.join(root, destination))) cpSync(source, path.join(root, destination), { recursive: true });
	} else run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", fallback]);
}
run(process.execPath, ["scripts/prepare-coordinator-agy.mjs"]);
const icons = path.join(root, "assets/coordinator");
const iconset = path.join(icons, "coordinator.iconset");
mkdirSync(iconset, { recursive: true });
run("swift", ["-module-cache-path", process.env.AO_SWIFT_CACHE || path.join(root, ".coordinator-swift-cache"), "scripts/coordinator-icon.swift", path.join(icons, "coordinator.png")]);
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
	run("sips", ["-z", String(size * scale), String(size * scale), path.join(icons, "coordinator.png"), "--out", path.join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`)]);
}
run("iconutil", ["-c", "icns", iconset, "-o", path.join(icons, "coordinator.icns")]);
// Never ship stale renderer/main files from the original desktop build.
rmSync(path.join(root, ".vite"), { recursive: true, force: true });
const manifestPath = path.join(root, "package.json");
const originalManifest = readFileSync(manifestPath, "utf8");
try {
 const manifest = JSON.parse(originalManifest);
 manifest.main = ".vite/build/coordinator-main.js";
 writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
 run(path.join(root, "node_modules/.bin/electron-forge"), ["package", "--platform", "darwin", "--arch", "arm64"]);
} finally { writeFileSync(manifestPath, originalManifest); }
