/**
 * Summarize Text Skill
 * Condenses long text into clear, concise summaries
 */

import type { MarketplaceSkill } from '@friday/shared';

export const summarizeTextSkill: Partial<MarketplaceSkill> = {
  name: 'Summarize Text',
  description: 'Condense long text into a clear, concise summary',
  category: 'utilities',
  author: 'FRIDAY',
  version: '1.0.0',
  instructions:
    'When the user asks you to summarize text, produce a concise summary that captures the key points. Structure the summary with bullet points for clarity. Keep the summary under 20% of the original length.',
  tags: ['summarize', 'text', 'utility'],
};
