/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", ... for a past timestamp. Pure. */
export function relativeTime(then: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - then) / 1000));
	if (s < 45) return "just now";
	const units: [number, string][] = [
		[60, "minute"],
		[3600, "hour"],
		[86400, "day"],
		[2592000, "month"],
		[31536000, "year"],
	];
	let best: [number, string] = [60, "minute"];
	for (const u of units) if (s >= u[0]) best = u;
	const n = Math.max(1, Math.floor(s / best[0]));
	return `${n} ${best[1]}${n === 1 ? "" : "s"} ago`;
}
