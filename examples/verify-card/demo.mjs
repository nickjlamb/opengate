import { writeFileSync } from 'node:fs';
import { renderVerificationCard } from './verify-card.mjs';

const context =
  'Customers may request a full refund within 30 days of purchase. ' +
  'There is no restocking fee for standard plans. Enterprise plans are ' +
  'covered by their individual service agreements.';

const question = 'How many days do customers have to request a refund, and is there a fee?';

const anchors = [
  { value: '30 days', aliases: ['30-day', 'thirty days'] },
  { value: 'no restocking fee', aliases: ['no fee', 'without a fee'] },
];

// 1 — a grounded answer: every fact present, every number traceable
writeFileSync('verified.html', renderVerificationCard({
  caseId: 'refund-policy',
  question, context, anchors,
  answer: 'Customers have 30 days to request a full refund, and standard plans carry no restocking fee.',
}));

// 2 — a plausible answer that fails: one fact dropped, one number invented
writeFileSync('not-verified.html', renderVerificationCard({
  caseId: 'refund-policy',
  question, context, anchors,
  answer: 'Customers can request a refund within 30 days. A $4.99 restocking fee applies to all plans.',
}));

// 3 — abstention: the context can't answer, and the system correctly says so
writeFileSync('abstained.html', renderVerificationCard({
  caseId: 'enterprise-price',
  question: 'What is the annual price of the Enterprise plan?',
  context, answerable: false,
  answer: 'That information is not in the provided context — Enterprise pricing is covered by individual service agreements.',
}));

console.log('wrote verified.html, not-verified.html, abstained.html');
