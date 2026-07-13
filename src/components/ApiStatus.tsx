"use client";

import { useEffect, useState } from "react";
import { API_URL, fetchHealth } from "@/lib/api";

export default function ApiStatus() {
	const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

	useEffect(() => {
		fetchHealth()
			.then(() => setStatus("ok"))
			.catch(() => setStatus("error"));
	}, []);

	return (
		<p className="text-sm text-zinc-500 dark:text-zinc-400">
			API ({API_URL}):{" "}
			{status === "loading" && "connecting..."}
			{status === "ok" && "✅ connected"}
			{status === "error" && "❌ unreachable"}
		</p>
	);
}
