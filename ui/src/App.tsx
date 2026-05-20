import { useEffect, useState } from "react";
import type { BotState } from "./types";
import { StatCard } from "./components/StatCard";
import { OpportunitiesTable } from "./components/OpportunitiesTable";
import { LogFeed } from "./components/LogFeed";

const INITIAL: BotState = {
  mode: "--",
  startedAt: "",
  cycleNumber: 0,
  lastCycleAt: null,
  lastCycleSec: null,
  discovery: null,
  matching: null,
  capital: null,
  takers: [],
  makers: [],
  quotaExhausted: false,
  logs: [],
};

export default function App() {
  const [data, setData] = useState<BotState>(INITIAL);
  const [connected, setConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("--");

  async function poll() {
    try {
      const res = await fetch("/api/status");
      setData(await res.json());
      setConnected(true);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  const status = !connected
    ? "OFFLINE"
    : data.quotaExhausted
      ? "QUOTA EXHAUSTED"
      : "RUNNING";
  const statusColor = !connected
    ? "#f85149"
    : data.quotaExhausted
      ? "#d29922"
      : "#3fb950";
  const matchRate = data.matching
    ? `${data.matching.matched}/${data.matching.total}`
    : "--";

  return (
    <div
      style={{
        background: "#0d1117",
        minHeight: "100vh",
        color: "#e6edf3",
        fontFamily: "'Courier New', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 16 }}>
          ⚡ Polybot
        </span>

        <span
          style={{
            padding: "3px 12px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            background: data.mode === "DRY RUN" ? "#1f3a5f" : "#3d1212",
            color: data.mode === "DRY RUN" ? "#58a6ff" : "#f85149",
          }}
        >
          {data.mode}
        </span>

        <span
          style={{
            padding: "3px 12px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            background: statusColor + "22",
            color: statusColor,
          }}
        >
          {status}
        </span>

        <span style={{ marginLeft: "auto", color: "#8b949e", fontSize: 11 }}>
          refreshes every 10s &nbsp;·&nbsp; last: {lastRefresh}
        </span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px" }}>
        {/* Stat cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <StatCard
            label="Cycle"
            value={data.cycleNumber ? `#${data.cycleNumber}` : "--"}
            accent="blue"
          />
          <StatCard
            label="Cycle Time"
            value={data.lastCycleSec ? `${data.lastCycleSec}s` : "--"}
          />
          <StatCard
            label="Markets"
            value={data.discovery ? String(data.discovery.markets) : "--"}
          />
          <StatCard label="Matched" value={matchRate} accent="green" />
          <StatCard
            label="Total Capital"
            value={data.capital ? `$${data.capital.total.toFixed(2)}` : "--"}
            accent="green"
            sub={
              data.capital ? `USDC $${data.capital.usdc.toFixed(2)}` : undefined
            }
          />
          <StatCard
            label="Opportunities"
            value={
              data.takers.length + data.makers.length
                ? String(data.takers.length + data.makers.length)
                : "--"
            }
            accent="yellow"
            sub={`${data.takers.length} takers · ${data.makers.length} makers`}
          />
        </div>

        {/* Suspicious signal warning */}
        {[...data.takers, ...data.makers].some((r) => r.ev * 100 > 15) && (
          <div style={{
            background: "#3d1212",
            border: "1px solid #f85149",
            borderRadius: 8,
            padding: "10px 16px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
          }}>
            <span style={{ color: "#f85149", fontWeight: 700 }}>⚠ SUSPICIOUS SIGNALS</span>
            <span style={{ color: "#e6edf3" }}>
              {[...data.takers, ...data.makers].filter((r) => r.ev * 100 > 15).length} opportunities showing EV &gt;15% — likely stale Polymarket prices, verify before going live
            </span>
          </div>
        )}

        <OpportunitiesTable
          title="Taker Opportunities"
          rows={data.takers}
          priceLabel="Ask"
        />
        <OpportunitiesTable
          title="Maker Opportunities"
          rows={data.makers}
          priceLabel="Bid"
          defaultCollapsed={true}
        />
        <LogFeed logs={data.logs} />
      </div>
    </div>
  );
}
