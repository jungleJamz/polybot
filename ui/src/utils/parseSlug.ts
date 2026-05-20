function parseLine(token?: string): string {
  if (!token) return "?";
  const m = token.match(/^(\d+)pt(\d+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  return token;
}

function parseMarket(parts: string[]): string {
  if (parts.length === 0) return "ML";
  const isFirstHalf = parts[0] === "1h";
  const prefix = isFirstHalf ? "1H " : "";
  const rest = isFirstHalf ? parts.slice(1) : parts;
  if (rest.length === 0 || rest[0] === "moneyline") return `${prefix}ML`;
  if (rest[0] === "total") return `${prefix}O/U ${parseLine(rest[1])}`;
  if (rest[0] === "spread") {
    const side = rest[1] === "home" ? "Home" : "Away";
    return `${prefix}${side} -${parseLine(rest[2])}`;
  }
  return parts.join(" ");
}

export function parseSlug(slug: string): string {
  const parts = slug.split("-");
  const dateIdx = parts.findIndex((p) => /^\d{4}$/.test(p));
  if (dateIdx === -1) return slug;

  const team1 = (parts[dateIdx - 2] ?? "").toUpperCase();
  const team2 = (parts[dateIdx - 1] ?? "").toUpperCase();
  const market = parseMarket(parts.slice(dateIdx + 3));

  return `${team1} @ ${team2}  ·  ${market}`;
}

export function timeUntil(startTime?: string): string {
  if (!startTime) return "";
  const ms = new Date(startTime).getTime() - Date.now();
  if (ms < 0) return "LIVE";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
