import React from "react";

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 16,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #d0d7de",
  background: "#f6f8fa",
  color: "#24292f",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 14,
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #d0d7de",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

export default function App() {
  return (
    <main style={{
      maxWidth: 1200,
      margin: "0 auto",
      padding: 24,
      background: "#f4f7fb",
      minHeight: "100vh",
      color: "#0f172a",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 32 }}>PlotPeta</h1>
        <p style={{ margin: "8px 0 0", color: "#475569" }}>
          Digitasi, kalibrasi, dan ekspor area ke DXF
        </p>
      </header>

      <section style={panelStyle}>
        <div style={toolbarStyle}>
          <button style={buttonStyle}>Upload Peta</button>
          <button style={buttonStyle}>Pilih</button>
          <button style={buttonStyle}>Garis</button>
          <button style={buttonStyle}>Poligon</button>
          <button style={buttonStyle}>Teks</button>
          <button style={buttonStyle}>Undo</button>
          <button style={buttonStyle}>Redo</button>
          <button style={{ ...buttonStyle, background: "#0f172a", color: "#fff" }}>Export DXF</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr", gap: 20 }}>
          <div style={{
            minHeight: 520,
            border: "1px solid #d0d7de",
            borderRadius: 12,
            background: "linear-gradient(135deg, #eef6ff 0%, #f8fafc 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{
              width: "92%",
              height: "88%",
              background: "#ffffff",
              border: "1px dashed #94a3b8",
              borderRadius: 12,
              position: "relative",
            }}>
              <div style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
                backgroundSize: "24px 24px",
                opacity: 0.5,
              }} />
              <div style={{
                position: "absolute",
                left: "12%",
                top: "18%",
                width: 220,
                height: 180,
                border: "2px solid #3b82f6",
                borderRadius: 12,
                transform: "rotate(-6deg)",
                background: "rgba(59,130,246,0.06)",
              }} />
              <div style={{
                position: "absolute",
                left: "40%",
                top: "24%",
                width: 180,
                height: 140,
                border: "2px solid #f59e0b",
                borderRadius: 8,
                background: "rgba(245,158,11,0.08)",
              }} />
              <div style={{
                position: "absolute",
                left: "55%",
                top: "55%",
                width: 180,
                height: 120,
                border: "2px solid #10b981",
                borderRadius: 8,
                background: "rgba(16,185,129,0.07)",
              }} />
            </div>
          </div>

          <aside style={{ display: "grid", gap: 16 }}>
            <div style={panelStyle}>
              <h3 style={{ marginTop: 0 }}>Status</h3>
              <div style={{ display: "grid", gap: 8, color: "#334155" }}>
                <div><strong>Mode:</strong> Standby</div>
                <div><strong>Token:</strong> 12 tersisa</div>
                <div><strong>Layer:</strong> 020100</div>
                <div><strong>Skala:</strong> Local</div>
              </div>
            </div>

            <div style={panelStyle}>
              <h3 style={{ marginTop: 0 }}>Kalibrasi</h3>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Koordinat X</span>
                  <input defaultValue="1000" style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }} />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Koordinat Y</span>
                  <input defaultValue="750" style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }} />
                </label>
                <button style={{ ...buttonStyle, background: "#dbeafe", borderColor: "#93c5fd" }}>Simpan kalibrasi</button>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
