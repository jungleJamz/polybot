import { useState } from "react";
import type { OpportunitySummary } from "../types";
import { parseSlug, timeUntil } from "../utils/parseSlug";

interface Props {
  title: string;
  rows: OpportunitySummary[];
  priceLabel: "Ask" | "Bid";
  defaultCollapsed?: boolean;
}

function evStyle(ev: number): { color: string; label: string } {
  const pct = ev * 100;
  if (pct > 15) return { color: "#f85149", label: "SUSPICIOUS" };
  if (pct > 8) return { color: "#3fb950", label: "STRONG" };
  if (pct > 5) return { color: "#d29922", label: "OK" };
  return { color: "#8b949e", label: "WEAK" };
}

const PREVIEW = 10;

export function OpportunitiesTable({
  title,
  rows,
  priceLabel,
  defaultCollapsed = false,
}: Props) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [showAll, setShowAll] = useState(false);

  const sorted = [...rows].sort((a, b) => b.ev - a.ev);
  const visible = showAll ? sorted : sorted.slice(0, PREVIEW);
  const hidden = sorted.length - PREVIEW;

  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      {/* Header — click to collapse */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          padding: "10px 16px",
          borderBottom: expanded ? "1px solid #30363d" : "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span
          style={{
            color: "#8b949e",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{ color: "#58a6ff", fontSize: 12, fontFamily: "monospace" }}
          >
            {rows.length}
          </span>
          <span style={{ color: "#8b949e", fontSize: 11 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {expanded && (
        <>
          {rows.length === 0 ? (
            <div
              style={{
                padding: "20px 16px",
                color: "#8b949e",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              No opportunities this cycle
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Market",
                        "Starts",
                        "EV ↓",
                        "Signal",
                        priceLabel,
                        "Shares",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "7px 16px",
                            textAlign: "left",
                            color: "#8b949e",
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            borderBottom: "1px solid #21262d",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r, i) => {
                      const { color, label } = evStyle(r.ev);
                      const until = timeUntil(r.startTime);
                      const isLast =
                        i === visible.length - 1 && (showAll || hidden <= 0);
                      return (
                        <tr
                          key={i}
                          style={{
                            borderBottom: isLast ? "none" : "1px solid #21262d",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px 16px",
                              color: "#e6edf3",
                              fontFamily: "monospace",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {parseSlug(r.slug)}
                          </td>
                          <td
                            style={{
                              padding: "8px 16px",
                              color: until === "LIVE" ? "#f85149" : "#8b949e",
                              fontFamily: "monospace",
                              fontSize: 11,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {until || "--"}
                          </td>
                          <td
                            style={{
                              padding: "8px 16px",
                              color,
                              fontWeight: 700,
                              fontFamily: "monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {(r.ev * 100).toFixed(2)}%
                          </td>
                          <td
                            style={{
                              padding: "8px 16px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                color,
                                fontSize: 10,
                                background: color + "18",
                                padding: "2px 8px",
                                borderRadius: 10,
                                fontWeight: 600,
                              }}
                            >
                              {label}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "8px 16px",
                              color: "#8b949e",
                              fontFamily: "monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {(r.price * 100).toFixed(1)}¢
                          </td>
                          <td
                            style={{
                              padding: "8px 16px",
                              color: "#e6edf3",
                              fontFamily: "monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.size.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Show more / less */}
              {sorted.length > PREVIEW && (
                <div
                  onClick={() => setShowAll((s) => !s)}
                  style={{
                    padding: "10px 16px",
                    borderTop: "1px solid #21262d",
                    color: "#58a6ff",
                    fontSize: 11,
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  {showAll ? "Show less ▲" : `Show ${hidden} more ▼`}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
