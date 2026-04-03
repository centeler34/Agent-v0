import { TaskRegistry } from './task_registry.js';

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

const MAX_MEMORY_LINES = 200;
const MAX_MEMORY_BYTES = 25000;

export class MemoryManager {
  constructor(private registry: TaskRegistry) {}

  /**
   * Saves a structured memory.
   * Following the tools/memdir pattern: Rule/Fact, Why, and How to Apply.
   */
  async saveMemory(type: MemoryType, fact: string, why: string, howToApply: string) {
    const content = `${fact}\n**Why:** ${why}\n**How to apply:** ${howToApply}`;
    this.registry.addMemory(type, content, fact.slice(0, 100));
  }

  /**
   * Automatically saves a successful pattern as a feedback memory.
   */
  async learnSuccessfulPattern(agentId: string, taskType: string, pattern: string) {
    await this.saveMemory(
      'feedback',
      `Successfully executed ${taskType} with agent: ${agentId}`,
      `The pattern '${pattern}' was validated as working in the current environment.`,
      `Prioritize this syntax/approach for future ${taskType} tasks delegated to ${agentId}.`
    );
  }

  /**
   * Searches memories using grep-style logic (case-insensitive substring match).
   */
  searchMemories(query: string): any[] {
    const allMemories = this.registry.getMemories();
    if (!query) {
      return allMemories; // Return all if query is empty
    }
    const lowerQuery = query.toLowerCase();
    return allMemories.filter(m =>
      m.content.toLowerCase().includes(lowerQuery) ||
      (m.description && m.description.toLowerCase().includes(lowerQuery)) ||
      m.type.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Builds the prompt section that gives the AI its "Memory".
   */
  buildMemoryPrompt(): string {
    const memories = this.registry.getMemories();
    if (memories.length === 0) {
      return "No prior memories found.";
    }

    let prompt = "# System Memory\n";
    prompt += "Below are memories of past interactions. Use memory as context for what was true at a given point in time.\n";
    prompt += "Before building assumptions solely on memory, verify it is still correct by reading the current state of files.\n\n";

    const categories: Record<MemoryType, string[]> = {
      user: [], 
      feedback: [],
      project: [],
      reference: []
    };

    for (const m of memories) {
      categories[m.type as MemoryType]?.push(`- ${m.content}`);
    }

    if (categories.user.length > 0) {
      prompt += "### User Profile & Preferences\n" + categories.user.join('\n') + "\n\n";
    }
    if (categories.feedback.length > 0) {
      prompt += "### Past Feedback & Corrections\n" + categories.feedback.join('\n') + "\n\n";
    }
    if (categories.project.length > 0) {
      prompt += "### Project Context & Decisions\n" + categories.project.join('\n') + "\n\n";
    }
    if (categories.reference.length > 0) {
      prompt += "### External References\n" + categories.reference.join('\n') + "\n\n";
    }

    prompt += "## Memory Constraints\n";
    prompt += "- If the memory says X exists, verify it still exists before acting on it.\n";
    prompt += "- Trust current project state (code/files) over snapshots in memory if they conflict.\n";
    prompt += "- If the user says to *ignore* memory: proceed as if memory were empty.\n";

    return this.truncateContent(prompt);
  }

  /**
   * Truncates memory content to prevent context window overflow.
   * Ported from tools/memdir/memdir.ts
   */
  private truncateContent(content: string): string {
    const lines = content.split('\n');
    let truncated = lines.slice(0, MAX_MEMORY_LINES).join('\n');

    if (truncated.length > MAX_MEMORY_BYTES) {
      const cutAt = truncated.lastIndexOf('\n', MAX_MEMORY_BYTES);
      truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_MEMORY_BYTES);
    }

    if (lines.length > MAX_MEMORY_LINES || content.length > MAX_MEMORY_BYTES) {
      truncated += "\n\n> WARNING: System Memory is truncated due to size limits. ";
      truncated += "Only the most recent entries are loaded. Move detail into project documentation if critical.";
    }

    return truncated;
  }
}