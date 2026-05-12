import type { OpportunitySummary } from "../types";

interface Props {
  title: string;
  rows: OpportunitySummary[];
  priceLabel: "Ask" | "Bid";
}

function evStyle(ev: number): { color: string; label: string } {
  const pct = ev * 100;
  if (pct > 15) return { color: "#f85149", label: "SUSPICIOUS" };
  if (pct > 8) return { color: "#3fb950", label: "STRONG" };
  if (pct > 5) return { color: "#d29922", label: "OK" };
  return { color: "#8b949e", label: "WEAK" };
}

export function OpportunitiesTable({ title, rows, priceLabel }: Props) {
  const { color: hdrColor } = evStyle(0);
  void hdrColor;

  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #30363d",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
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
        <span
          style={{ color: "#58a6ff", fontSize: 12, fontFamily: "monospace" }}
        >
          {rows.length}
        </span>
      </div>

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
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Market", "EV", "Signal", priceLabel, "Shares"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 16px",
                      textAlign: "left",
                      color: "#8b949e",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderBottom: "1px solid #21262d",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const { color, label } = evStyle(r.ev);
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom:
                        i < rows.length - 1 ? "1px solid #21262d" : "none",
                    }}
                  >
                    <td
                      style={{
                        padding: "8px 16px",
                        color: "#e6edf3",
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    >
                      {r.slug}
                    </td>
                    <td
                      style={{
                        padding: "8px 16px",
                        color,
                        fontWeight: 700,
                        fontFamily: "monospace",
                      }}
                    >
                      {(r.ev * 100).toFixed(2)}%
                    </td>
                    <td style={{ padding: "8px 16px" }}>
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
                      }}
                    >
                      {(r.price * 100).toFixed(1)}¢
                    </td>
                    <td
                      style={{
                        padding: "8px 16px",
                        color: "#e6edf3",
                        fontFamily: "monospace",
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
      )}
    </div>
  );
}
