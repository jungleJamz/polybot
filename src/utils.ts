// src/utils.ts

/**
 * Normalize team names for fuzzy matching.
 *
 * Examples:
 * "Los Angeles Lakers" -> "los angeles lakers"
 * "LA Lakers" -> "la lakers"
 */
export function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFirstHalf(question: string): boolean {
  return /\b1h\b/i.test(question) || /first half/i.test(question);
}
