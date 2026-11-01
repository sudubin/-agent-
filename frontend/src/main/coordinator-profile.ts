import path from "node:path";

/** A separate install must never open the original AO app's database/profile. */
export function coordinatorProfile(home: string, packaged: boolean, override?: string) {
	const root = override ? path.resolve(override) : path.join(home, ".ao", packaged ? "coordinator" : "coordinator-dev");
	return { root, data: path.join(root, "data"), runFile: path.join(root, "running.json"), electron: path.join(root, "electron"), port: packaged ? "3310" : "3311" };
}
