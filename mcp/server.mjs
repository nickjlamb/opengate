#!/usr/bin/env node
// OpenGATE MCP server.
//
// Exposes OpenGATE's deterministic grounding check as an MCP tool, so an AI
// agent (Claude Desktop, Cursor, …) can verify its own answers: "here's my
// answer and the context I based it on — is it actually grounded?" No LLM
// judge — the check is gold-anchored and reproducible.
//
// Add to an MCP client (e.g. Claude Desktop config):
//   {
//     "mcpServers": {
//       "opengate": { "command": "npx", "args": ["-y", "@pharmatools/opengate-mcp"] }
//     }
//   }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkGrounding } from '@pharmatools/opengate/grounding';

const server = new McpServer({ name: 'opengate', version: '0.1.0' });

server.tool(
  'check_grounding',
  'Check whether an answer is grounded in the provided context. Deterministic (no LLM judge): verifies that required facts appear in the answer, that every number in the answer traces to the context, and — for questions the context cannot answer — that the answer abstains instead of fabricating. Use this to self-check RAG / document-QA / retrieval answers before returning them.',
  {
    answer: z.string().describe('The answer to check.'),
    context: z.union([z.string(), z.array(z.string())]).describe('The retrieved context the answer must be grounded in (a string, or an array of passages).'),
    question: z.string().optional().describe('The original question (optional; lets numbers from the question count as grounded).'),
    expected_facts: z.array(z.string()).optional().describe('Facts a correct answer must contain (e.g. "30 days", "no restocking fee"). Each must appear in the answer.'),
    allowed_new_numbers: z.array(z.string()).optional().describe('Numbers the answer may introduce that are not in the context (e.g. from the question).'),
    must_abstain: z.boolean().optional().describe('Set true when the context does NOT contain the answer: the answer must then decline rather than fabricate.'),
  },
  { readOnlyHint: true, openWorldHint: false },
  async (params) => {
    const result = checkGrounding({
      answer: params.answer,
      context: params.context,
      question: params.question,
      anchors: (params.expected_facts || []).map(value => ({ value })),
      allowedNewNumbers: params.allowed_new_numbers,
      answerable: params.must_abstain === true ? false : true,
    });

    const lines = [
      result.grounded ? '✅ GROUNDED' : '❌ NOT GROUNDED',
    ];
    if (result.issues.length) {
      lines.push('', 'Issues:');
      for (const i of result.issues) lines.push(`  • ${i}`);
    } else {
      lines.push('', 'Every required fact is present and every number traces to the context.');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: {
        grounded: result.grounded,
        issues: result.issues,
        anchorsMissed: result.anchorsMissed,
        ungroundedNumbers: result.ungroundedNumbers,
        abstained: result.abstained,
      },
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('OpenGATE MCP server running on stdio');
