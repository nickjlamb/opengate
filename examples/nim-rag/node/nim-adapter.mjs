// OpenGATE adapter for an NVIDIA NIM–powered answerer.
//
// NIM (NVIDIA Inference Microservices) exposes an OpenAI-compatible chat API,
// so this adapter is a thin wrapper: given a question and the retrieved context,
// it asks a NIM-served model to answer strictly from that context, then hands
// the answer back to OpenGATE's deterministic `grounding` scorer.
//
// The scorer supplies `context` (your retriever's output, captured in the gold
// cases). This adapter owns only the generation step — exactly the boundary
// where hallucinations appear — and OpenGATE checks the result against gold with
// no second model in the loop.
//
// Run:
//   NVIDIA_API_KEY=nvapi-... \
//   npx --yes @pharmatools/opengate \
//     --adapter ./nim-adapter.mjs --datasets ./datasets --online --ci
//
// Env:
//   NVIDIA_API_KEY  (required to run online) — get one free at build.nvidia.com
//   NIM_MODEL       default "meta/llama-3.1-8b-instruct"
//   NIM_BASE_URL    default "https://integrate.api.nvidia.com/v1"
//                   (point this at a self-hosted NIM container to run locally)

export const meta = { name: 'nim-rag' };

const BASE_URL = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const MODEL = process.env.NIM_MODEL || 'meta/llama-3.1-8b-instruct';

// The grounding scorer only runs online; these two exports tell it whether it
// can, and what to say if it can't.
export const onlineAvailable = () => Boolean(process.env.NVIDIA_API_KEY);
export const onlineConfigHint = () =>
  'Set NVIDIA_API_KEY (free at build.nvidia.com) to run the NIM grounding eval. ' +
  'Optionally set NIM_MODEL and NIM_BASE_URL.';

export const runModel = () => MODEL;

// Minimal latency tracking so the scorer can report p50.
let latencies = [];
export const resetTiming = () => { latencies = []; };
export const callLatencies = () => latencies;

const SYSTEM_PROMPT =
  'You are a careful assistant. Answer the question using ONLY the provided context. ' +
  'Quote figures exactly as they appear in the context and do not introduce any number ' +
  'that is not present there. If the context does not contain the answer, reply exactly: ' +
  '"That is not in the provided context." Keep the answer to one or two sentences.';

// grounding capability: OpenGATE calls this with the question and the retrieved
// context, and expects { text } (or { answer }) back.
export async function answer({ question, context }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set');

  const body = {
    model: MODEL,
    temperature: 0, // deterministic generation, so the eval is reproducible
    max_tokens: 256,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  };

  const started = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  latencies.push(Date.now() - started);

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`NIM request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() ?? '';
  return { text };
}
