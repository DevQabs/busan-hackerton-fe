export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function fetchHealth() {
	const res = await fetch(`${API_URL}/api/health`);
	if (!res.ok) {
		throw new Error(`health check failed: ${res.status}`);
	}
	return res.json() as Promise<{ status: string; service: string; time: string }>;
}
