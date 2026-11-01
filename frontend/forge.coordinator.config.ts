import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { writeFileSync } from "node:fs";
import path from "node:path";

/** Independent desktop product. No original AO Electron entry or UI is shipped. */
export function coordinatorForgeConfig(_base?: ForgeConfig): ForgeConfig {
	return {
		packagerConfig: {
			name: "协作台", executableName: "agent-coordinator", appBundleId: "local.sum.agent-coordinator", appVersion: "0.5.0", buildVersion: "0.5.0",
			asar: true, icon: "assets/coordinator/coordinator", protocols: [],
			ignore: (file) => Boolean(file && !file.startsWith("/.vite")),
			extraResource: ["daemon", "resources/acp-runtime", "resources/agy-acp", "tmux", "assets/coordinator", "../LICENSE"],
		},
		hooks: {
			packageAfterPrune: async (_config, buildPath) => {
				writeFileSync(path.join(buildPath, "package.json"), JSON.stringify({ name: "agent-coordinator", productName: "协作台", version: "0.5.0", description: "本地多 agent 协作工作台", main: ".vite/build/coordinator-main.js", license: "Apache-2.0", private: true }, null, 2));
			},
		},
		plugins: [
			new VitePlugin({ build: [{ entry: "src/coordinator-main.ts", config: "vite.coordinator.main.config.ts", target: "main" }, { entry: "src/coordinator-preload.ts", config: "vite.preload.config.ts", target: "preload" }], renderer: [{ name: "coordinator_window", config: "vite.coordinator.renderer.config.ts" }] }),
			new FusesPlugin({ version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableCookieEncryption]: true, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true }),
		],
		publishers: [],
	};
}
