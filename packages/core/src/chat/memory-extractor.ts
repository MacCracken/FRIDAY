/**
 * Memory Extractor — Parses [MEMORY: ...] tags from AI responses.
 *
 * Used to extract facts the AI wants to remember across conversations,
 * and strips the tags before returning the response to the user.
 */

const MEMORY_TAG_RE = /\[MEMORY:\s*(.+?)\]/g;

export interface ExtractedMemory {
  content: string;
}

/**
 * Extract all [MEMORY: ...] tags from AI response content.
 */
export function extractMemories(content: string): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  let match: RegExpExecArray | null;

  while ((match = MEMORY_TAG_RE.exec(content)) !== null) {
    const text = match[1]?.trim();
    if (text && text.length > 0) {
      memories.push({ content: text });
    }
  }

  return memories;
}

/**
 * Strip [MEMORY: ...] tags from content before returning to user.
 */
export function stripMemoryTags(content: string): string {
  return content.replace(MEMORY_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * System prompt addition that instructs the AI to use memory tags.
 */
export const MEMORY_SYSTEM_HINT =
  `IMPORTANT — Long-term memory: You have persistent memory across conversations. When the user shares a personal fact, preference, name, favorite, or any detail worth remembering, you MUST include a [MEMORY: fact] tag in your response. Examples:
- User says "I love mangoes" → include [MEMORY: User's favorite fruit is mango]
- User says "Call me Alex" → include [MEMORY: User's name/nickname is Alex]
- User mentions their job → include [MEMORY: User works as a ...]
These tags are automatically saved to your brain and stripped before the user sees your response. Use them liberally for any personal detail.`;
