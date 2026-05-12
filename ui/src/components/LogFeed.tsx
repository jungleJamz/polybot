interface Props {
  logs: string[];
}

export function LogFeed({ logs }: Props) {
  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 8,
      }}
    >
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #30363d" }}>
        <span
          style={{
            color: "#8b949e",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Activity Log
        </span>
      </div>
      <div style={{ height: 200, overflowY: "auto", padding: "8px 0" }}>
        {logs.length === 0 ? (
          <div style={{ padding: "0 16px", color: "#8b949e", fontSize: 12 }}>
            No activity yet
          </div>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              style={{
                padding: "3px 16px",
                color: "#8b949e",
                fontSize: 11,
                fontFamily: "monospace",
                borderBottom:
                  i < logs.length - 1 ? "1px solid #21262d" : "none",
              }}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
