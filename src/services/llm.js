import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5";

/** Strips ```json fences and parses; throws a clear error if the model didn't return valid JSON. */
function parseJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Model did not return valid JSON: " + cleaned.slice(0, 200));
  }
}

/**
 * System prompts are marked cache_control: ephemeral. They're identical text
 * on every call to a given action (score/tailor/cover-letter), across every
 * user — so Anthropic caches them server-side for ~5 minutes and skips
 * re-processing that fixed instruction block on every repeat call within
 * that window. Doesn't help your very first call of the day, but meaningfully
 * cuts latency (and cost) when someone tailors several jobs back to back,
 * which is the normal usage pattern here.
 */
async function callJson({ system, user, maxTokens = 1500 }) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }]
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  return { parsed: parseJson(text), usage: res.usage };
}

/**
 * Scores a resume against a job description and identifies specific gaps.
 * Returns: { matchPercent: number, gaps: [{ label, covered }] }
 */
export async function scoreResume({ resumeText, jobDescription }) {
  return callJson({
    system: `You are a precise technical recruiter. Compare a resume against a job description and score
the match. Respond ONLY with JSON, no preamble, matching this exact shape:
{"matchPercent": <0-100 integer>, "gaps": [{"label": "<short requirement name>", "covered": <boolean>}]}
Include 5-8 of the most important requirements from the job description as gap items, ordered by importance.
Be strict — do not inflate the score. A generic resume against a specific role should score low.`,
    user: `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${resumeText}`
  });
}

/**
 * Suggests which existing bullets to change and generates tailored replacements.
 * Returns: { bullets: [{ original, tailored, reason }] }
 */
export async function tailorBullets({ resumeText, jobDescription, scoreResult }) {
  return callJson({
    system: `You are an expert resume writer. Given a resume, a job description, and a gap analysis,
select the 3-6 EXISTING resume bullets that would benefit most from tailoring toward this specific job,
and rewrite each one to better reflect the job's language and priorities — without fabricating experience
the candidate doesn't have. Only rephrase, re-emphasize, or reorder what's already true in the resume.
Respond ONLY with JSON matching this shape:
{"bullets": [{"original": "<exact original bullet text>", "tailored": "<rewritten bullet>", "reason": "<one sentence why>"}]}`,
    user: `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${resumeText}\n\nGAP ANALYSIS:\n${JSON.stringify(
      scoreResult
    )}`,
    maxTokens: 2000
  });
}

/**
 * Generates a tailored cover letter.
 * Returns: { letter: string }
 */
export async function generateCoverLetter({ resumeText, jobDescription, company, title }) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: [
      {
        type: "text",
        text: `You are an expert cover letter writer. Write a concise, specific, non-generic cover letter
(under 300 words) that connects the candidate's actual resume experience to this specific role. Avoid
cliches like "I am excited to apply" or "I believe I would be a great fit". Be concrete and confident.
Respond with the letter text only — no JSON, no preamble, no markdown formatting.`,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: [
      {
        role: "user",
        content: `ROLE: ${title || "the role"} at ${company || "the company"}\n\nJOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${resumeText}`
      }
    ]
  });
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  return { parsed: { letter: text.trim() }, usage: res.usage };
}
