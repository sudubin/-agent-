import { describe, expect, it } from "vitest";
import { coordinatorProfile } from "./coordinator-profile";
import { collaborationFolder } from "./coordinator-folder";

describe("independent coordinator install", () => {
	it("keeps the packaged and development profiles separate from original AO", () => {
		const packaged = coordinatorProfile("/Users/test", true);
		const dev = coordinatorProfile("/Users/test", false);
		expect(packaged.data).toBe("/Users/test/.ao/coordinator/data");
		expect(packaged.electron).not.toBe("/Users/test/.ao/electron");
		expect(dev.root).not.toBe(packaged.root);
		expect(dev.port).not.toBe(packaged.port);
	});
	it("supports a separately named native UI lab", () => {
		expect(coordinatorProfile("/Users/test", true, "/tmp/coordinator-lab").runFile).toBe("/tmp/coordinator-lab/running.json");
	});
	it("opens only the registered project or a valid run folder", () => {
		expect(collaborationFolder("/projects/game")).toBe("/projects/game");
		expect(collaborationFolder("/projects/game", "run-1")).toBe("/projects/game/outputs/agent-collaboration/run-1");
		for (const id of ["../elsewhere", "/tmp/other", "", "a/b"]) expect(() => collaborationFolder("/projects/game", id)).toThrow();
		expect(() => collaborationFolder("relative-project", "run-1")).toThrow();
	});
});
