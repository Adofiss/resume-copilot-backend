import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

/**
 * Verifies the Bearer token issued by Supabase Auth on login/signup, LOCALLY
 * (no network call to Supabase per request — see below).
 *
 * Supabase signs tokens with ES256 (asymmetric public/private key signing)
 * on newer projects, rather than the older HS256 shared-secret method. With
 * ES256, there's no shared secret to check a signature against — instead,
 * verification uses Supabase's PUBLIC signing key, fetched from their JWKS
 * (JSON Web Key Set) endpoint. This key is public by design (that's the
 * whole point of asymmetric signing: the public half can be shared freely,
 * only Supabase holds the private half that actually signs tokens), so
 * fetching and caching it locally is exactly as secure as asking Supabase
 * to verify the token for us, but avoids a network round trip on every
 * single request — jwks-rsa fetches the key once and caches it in memory.
 */
const client = jwksClient({
  jwksUri: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes — Supabase's signing keys rotate rarely
  rateLimit: true
});

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Missing bearer token." });
  }

  jwt.verify(token, getSigningKey, { algorithms: ["ES256"] }, (err, payload) => {
    if (err) {
      console.error("JWT verification failed:", err.name, "-", err.message);
      return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Invalid or expired token." });
    }
    req.userId = payload.sub; // Supabase puts the user's UUID in the standard "sub" claim
    req.userEmail = payload.email;
    next();
  });
}
