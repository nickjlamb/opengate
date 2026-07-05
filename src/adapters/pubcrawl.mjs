// PubCrawl adapter — fourth bundled implementation, exercising the framework's
// retrieval capability. PubCrawl (@pharmatools/pubcrawl) is an MCP server that
// gives AI clients access to PubMed, ClinicalTrials.gov, and drug labelling.
//
// It is NOT an AI system — it's deterministic wrappers around public APIs. The
// eval measures RETRIEVAL FIDELITY: does the record a client receives match the
// authority (right title, all authors, intact abstract)? A silent XML-parser
// regression here would poison every downstream grounding claim, so this is the
// foundation the QA/simplify capabilities build on.
//
// The adapter talks to PubCrawl through its real MCP interface (no
// re-implementation of the tool handlers), so the full production parse path is
// under test. The MCP SDK is imported dynamically — install it alongside
// PubCrawl; OpenGATE core stays zero-dependency.
//
// Config via env:
//   PUBCRAWL_MCP_URL   HTTP MCP endpoint, e.g. http://localhost:8080/mcp
//                      (start PubCrawl with `npm run start:http`)
//   PUBCRAWL_CMD       stdio spawn command (default: "npx")
//   PUBCRAWL_ARGS      stdio args, space-separated (default: "-y @pharmatools/pubcrawl")
//   NCBI_API_KEY       forwarded to the server (higher NCBI rate limit)
// If PUBCRAWL_MCP_URL is set it wins; otherwise the server is spawned over stdio.

export const meta = { name: 'pubcrawl' };

let sdk = null;
let loadError = null;
try {
  const [{ Client }, stdio, http] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js').catch(() => ({})),
  ]);
  sdk = { Client, StdioClientTransport: stdio.StdioClientTransport, StreamableHTTPClientTransport: http.StreamableHTTPClientTransport };
} catch (err) {
  loadError = err;
}

const HTTP_URL = process.env.PUBCRAWL_MCP_URL;

export function onlineAvailable() {
  return Boolean(sdk);
}

export function onlineConfigHint() {
  if (!sdk) {
    return 'MCP SDK not installed — run: npm install --no-save @modelcontextprotocol/sdk' +
      (loadError ? ` (${loadError.code || loadError.message})` : '');
  }
  return 'PubCrawl adapter ready (set PUBCRAWL_MCP_URL for HTTP, or it spawns the server over stdio).';
}

// ── Timing ──────────────────────────────────────────────────────────────
const _calls = [];
export function resetTiming() { _calls.length = 0; }
export function callLatencies() { return _calls.map(c => c.ms); }

function newTransport() {
  if (HTTP_URL) {
    if (!sdk.StreamableHTTPClientTransport) throw new Error('HTTP transport unavailable in this SDK build');
    return new sdk.StreamableHTTPClientTransport(new URL(HTTP_URL));
  }
  const command = process.env.PUBCRAWL_CMD || 'npx';
  const args = (process.env.PUBCRAWL_ARGS || '-y @pharmatools/pubcrawl').split(/\s+/).filter(Boolean);
  const env = { ...process.env };
  return new sdk.StdioClientTransport({ command, args, env });
}

// PubCrawl tool per record type. Extend as retrieval gold cases grow.
const TOOL_FOR = {
  pubmed: (id) => ({ name: 'get_abstract', arguments: { pmid: String(id) } }),
  trial: (id) => ({ name: 'get_trial', arguments: { nctId: String(id) } }),
};

/**
 * Retrieval capability. Fetches one record through PubCrawl's MCP interface and
 * returns its parsed JSON as { record }.
 * @param {object} req — { id, type? }  (type default: 'pubmed')
 */
export async function fetchRecord(req) {
  const type = req.type || 'pubmed';
  const build = TOOL_FOR[type];
  if (!build) throw new Error(`unsupported record type "${type}"`);

  const t0 = performance.now();
  const client = new sdk.Client({ name: 'opengate', version: '0' }, { capabilities: {} });
  const transport = newTransport();
  try {
    await client.connect(transport);
    const res = await client.callTool(build(req.id));
    if (res.isError) {
      const msg = res.content?.map(c => c.text).join(' ') || 'tool error';
      throw new Error(msg);
    }
    const text = (res.content || []).find(c => c.type === 'text')?.text ?? '';
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      throw new Error(`non-JSON tool response: ${text.slice(0, 120)}`);
    }
    return { record };
  } finally {
    _calls.push({ ms: performance.now() - t0 });
    await client.close().catch(() => {});
  }
}
