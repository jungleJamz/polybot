interface Props {
  label: string;
  value: string;
  accent?: "green" | "blue" | "yellow" | "red";
  sub?: string;
}

const ACCENTS = {
  green: "#3fb950",
  blue: "#58a6ff",
  yellow: "#d29922",
  red: "#f85149",
};

export function StatCard({ label, value, accent, sub }: Props) {
  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          color: "#8b949e",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: accent ? ACCENTS[accent] : "#e6edf3",
          fontFamily: "'Courier New', monospace",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ color: "#8b949e", fontSize: 11, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
