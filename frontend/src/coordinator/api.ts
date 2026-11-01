import createClient from "openapi-fetch";
import type { paths } from "../api/schema";

let base = "http://127.0.0.1:3310";
export let apiClient = createClient<paths>({ baseUrl: base });
export function setApiBaseUrl(port: number) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("本地服务端口不正确。");
	const next = `http://127.0.0.1:${port}`;
	if (next !== base) { base = next; apiClient = createClient<paths>({ baseUrl: base }); }
}
export const getApiBaseUrl = () => base;
export function apiErrorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
export function apiErrorMessage(error: unknown, fallback = "暂时无法完成操作，请稍后重试。"): string {
	return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}
