/**
 * Verifies a Turnstile token with Cloudflare's siteverify API. This is the
 * part that actually enforces bot protection — the widget on the frontend
 * only produces a token, anyone could fake a request without ever showing
 * the widget unless we check that token server-side before trusting it.
 *
 * Uses Node's built-in fetch (Node 18+), no extra dependency needed.
 */
export async function verifyTurnstile(token, remoteIp) {
  if (!token || typeof token !== "string") return false;

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteIp
      })
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.error("Turnstile verification request failed:", err.message);
    return false;
  }
}
