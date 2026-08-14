import jwt from "jsonwebtoken";

/**
 * Verifies the Bearer token issued by Supabase Auth on login/signup.
 * Attaches req.userId on success.
 *
 * IMPORTANT: this verifies the JWT signature LOCALLY using SUPABASE_JWT_SECRET,
 * rather than calling supabase.auth.getUser(token) over the network. Supabase
 * signs these tokens with a secret only your server and Supabase know — since
 * we already have that secret, checking the signature ourselves is exactly as
 * secure as asking Supabase to check it for us, but skips a full network
 * round trip on every single authenticated request.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Missing bearer token." });
  }

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, { algorithms: ["HS256"] });
    req.userId = payload.sub; // Supabase puts the user's UUID in the standard "sub" claim
    req.userEmail = payload.email;
    next();
  } catch (err) {
    // Log the specific reason (expired vs bad signature vs wrong algorithm)
    // plus what algorithm the token actually claims to use — if Supabase
    // signed this with something other than HS256 (newer Supabase projects
    // can use asymmetric ES256 signing keys instead of the legacy shared
    // secret), that alone would explain every token failing, not just old ones.
    const header = jwt.decode(token, { complete: true })?.header;
    console.error("JWT verification failed:", err.name, "-", err.message, "| token alg:", header?.alg);
    return res.status(401).json({ code: "NOT_AUTHENTICATED", message: "Invalid or expired token." });
  }
}
