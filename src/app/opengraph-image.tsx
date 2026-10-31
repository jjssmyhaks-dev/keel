import { ImageResponse } from "next/og";

export const alt = "Keel — Identity, vault and governance for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const host = (process.env.APP_URL || "https://keel.dev").replace(/^https?:\/\//, "").replace(/\/$/, "");

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: "#faf9f6",
          color: "#0b0b0b",
          padding: "68px 76px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 30, letterSpacing: 8, fontWeight: 700 }}>
            <span>KEEL</span>
            <span style={{ fontSize: 14, letterSpacing: 2, color: "#777" }}>TM</span>
          </div>
          <div style={{ display: "flex", fontSize: 18, letterSpacing: 4, color: "#777" }}>IDENTITY INFRASTRUCTURE FOR AI AGENTS</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 82, lineHeight: 0.98, letterSpacing: -3, fontWeight: 600 }}>
            <span>Agents need passports,</span>
            <span style={{ color: "#8a8a8a" }}>not secrets.</span>
          </div>
          <div style={{ display: "flex", fontSize: 27, lineHeight: 1.4, color: "#555", maxWidth: 920 }}>
            Short-lived Ed25519 identity, a vault agents can use but never read, human-approved boundaries, and a tamper-evident audit chain.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #d8d5cf", paddingTop: 22, fontSize: 19, color: "#666" }}>
          <span>{host}</span>
          <span>5-minute tokens · JWKS · AES-256-GCM · hash-chained audit</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
