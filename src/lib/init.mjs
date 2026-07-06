// Scaffold a working OpenGATE setup into a repo: a starter gold set, an HTTP
// adapter config, and a ready GitHub Action. Pure — returns the files to write
// as { path, content }; the runner does the I/O (and won't overwrite without
// --force). The default is the grounding capability (the turnkey path for RAG /
// document QA), so `opengate init` gets a stranger to a CI gate in one command.

const httpConfig = `{
  "name": "my-system",
  "baseUrl": "\${MY_SYSTEM_URL}",
  "headers": { "Authorization": "Bearer \${MY_SYSTEM_TOKEN}" },
  "endpoints": {
    "answer": "/api/answer"
  }
}
`;

const exampleCase = `{
  "id": "example-grounding",
  "kind": "grounding",
  "question": "How many days do customers have to request a refund, and is there a fee?",
  "context": "Customers may request a full refund within 30 days of purchase. There is no restocking fee for standard plans.",
  "answerAnchors": [
    { "value": "30 days", "aliases": ["30-day", "thirty days"] },
    { "value": "no restocking fee", "aliases": ["no fee"] }
  ],
  "answerable": true
}
`;

const unanswerableCase = `{
  "id": "example-grounding-unanswerable",
  "kind": "grounding",
  "question": "What is the annual price of the Enterprise plan?",
  "context": "Our Pro plan includes unlimited projects and a 30-day free trial. Contact sales for volume discounts.",
  "answerable": false
}
`;

const workflow = `name: OpenGATE
on:
  pull_request:
  push:
    branches: [main]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nickjlamb/opengate@v0
        with:
          datasets: ./datasets
          results: ./results          # commit baseline.<adapter>.json here to gate regressions
          adapter: http               # the bundled HTTP adapter (uses opengate.http.json)
          online: 'true'
        env:
          OPENGATE_HTTP_CONFIG: ./opengate.http.json
          MY_SYSTEM_URL: \${{ vars.MY_SYSTEM_URL }}
          MY_SYSTEM_TOKEN: \${{ secrets.MY_SYSTEM_TOKEN }}
`;

const readme = `# OpenGATE evaluation

This directory was scaffolded by \`opengate init\`. It evaluates your system's
**grounding**: given a question and retrieved context, does it answer correctly,
without inventing facts, and abstain when the context lacks the answer?

## Set up

1. Point \`opengate.http.json\` at your system. It needs an \`answer\` endpoint that
   receives \`{ question, context }\` and returns \`{ "text": "…" }\`.
2. Export the config's environment variables:
   \`\`\`bash
   export MY_SYSTEM_URL="https://your-api.example.com"
   export MY_SYSTEM_TOKEN="…"
   export OPENGATE_HTTP_CONFIG="./opengate.http.json"
   \`\`\`
3. Edit \`datasets/cases/\` — replace the examples with questions and context from
   your own domain. Anchors are the facts a correct answer must contain.

## Run

\`\`\`bash
npx @pharmatools/opengate --online --adapter http \\
  --datasets ./datasets --results ./results --report
\`\`\`

Open \`results/report.html\` for the dashboard. Save a baseline once you're happy:

\`\`\`bash
npx @pharmatools/opengate --online --adapter http \\
  --datasets ./datasets --results ./results --baseline
\`\`\`

Commit \`results/baseline.*.json\`, and the included GitHub Action gates every
change against it.

Docs: https://github.com/nickjlamb/opengate/blob/main/docs/GETTING-STARTED.md
`;

/** Files to scaffold, as { path (relative), content }. */
export function initFiles() {
  return [
    { path: 'opengate.http.json', content: httpConfig },
    { path: 'datasets/cases/example-grounding.json', content: exampleCase },
    { path: 'datasets/cases/example-grounding-unanswerable.json', content: unanswerableCase },
    { path: 'datasets/fixtures/.gitkeep', content: '' },
    { path: '.github/workflows/opengate.yml', content: workflow },
    { path: 'OPENGATE.md', content: readme },
  ];
}
