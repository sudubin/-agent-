import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
	plugins: [react(), { name: "coordinator-csp", transformIndexHtml() { return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'" }, injectTo: "head-prepend" }]; } }],
	build: { rollupOptions: { input: path.resolve("coordinator.html") }, manifest: true },
});
