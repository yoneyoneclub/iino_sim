import { useState } from "react";

const PASSWORD_HASH = import.meta.env.VITE_ACCESS_PASSWORD_HASH || "";
const SESSION_KEY = "iino_sim_authenticated";

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(
    sessionStorage.getItem(SESSION_KEY) === "true"
  );

  const login = async (password) => {
    const hash = await sha256(password);
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setAuthenticated(true);
      return true;
    }
    return false;
  };

  return { authenticated, login };
}

export function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const success = await onLogin(password);
    if (!success) {
      setError(true);
      setPassword("");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        background: "#0a0f1e",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "system-ui,sans-serif",
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          background: "#111827",
          border: "1px solid #1f2937",
          borderRadius: 12,
          padding: "32px 40px",
          width: 320,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>🚗</div>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#38bdf8",
            margin: "0 0 4px",
          }}
        >
          iino Simulator
        </h1>
        <p style={{ fontSize: 12, color: "#475569", margin: "0 0 24px" }}>
          社内向けツールです
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            placeholder="アクセスパスワード"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "#0a0f1e",
              border: `1px solid ${error ? "#ef4444" : "#1f2937"}`,
              borderRadius: 6,
              color: "#e2e8f0",
              fontSize: 14,
              boxSizing: "border-box",
              outline: "none",
              marginBottom: 8,
            }}
          />
          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, margin: "0 0 8px" }}>
              パスワードが違います
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: "100%",
              padding: "10px",
              background: loading || !password ? "#1e3a5f" : "#38bdf8",
              color: loading || !password ? "#475569" : "#0a0f1e",
              border: "none",
              borderRadius: 6,
              cursor: loading || !password ? "default" : "pointer",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
