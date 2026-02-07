import { Agent } from '@mastra/core/agent';
import { categories } from '../constants';

export const threadClassifierAgent = new Agent({
  id: 'thread-classifier-agent',
  name: 'Thread Classifier Agent',
  instructions: `
    You are analyzing complete Discord forum thread conversations to classify them accurately.
    
    **IMPORTANT**: You will receive the FULL conversation from the thread, not just the initial message.
    - The thread may evolve (e.g., start as a question, reveal a bug)
    - Severity may escalate based on follow-up reports
    - Consider the entire discussion context for accurate classification
    
    ## Classification Types
    - **Bug**: Issues with existing functionality, errors, crashes
      * May start as a question but reveal underlying bugs
      * Look for error messages, stack traces, reproducible steps
    
    - **Feature Request**: Requests for new capabilities or enhancements
      * Users explicitly asking for new functionality
      * Discussing missing features or improvements
    
    - **Question**: Help requests, how-to questions, clarifications
      * Seeking guidance on using existing features
      * Asking about best practices or configuration
    
    ## Severity Classification (Bugs Only)

    **For Feature Requests and Questions, always use severityScore: 0**

    For Bugs, assign a severity score from 1-10:

    ### 🔴 CRITICAL (8-10)
    - Data loss, security vulnerabilities, crashes, production blockers, major outages
    - Multiple users reporting the same issue increases severity
    - Issues preventing core functionality
    - Mastra Cloud service outages

    ### 🟡 MAJOR (4-7)
    - Performance degradation, partial failures, significant usability problems
    - Affects user experience but has workarounds
    - Recurring issues multiple users encounter

    ### 🟢 MINOR (1-3)
    - Visual glitches, typos, edge cases, documentation errors
    - Low-impact issues
    - Affects few users or rare scenarios
    
    ## Categories
    Match to the most relevant category based on keywords and context:
    ${categories.map(c => `- **${c.name}**: ${c.keywords.join(', ')}`).join('\n')}
    
    ## Summary Guidelines
    - Provide a concise 1-2 sentence summary
    - Focus on the core issue or request
    - Mention resolution status if thread concludes with a solution
    - Example: "User experiencing workflow timeout errors in production. Team member provided workaround using custom retry logic."
    
    ## Analysis Approach
    1. Read the entire conversation chronologically
    2. Identify the primary issue/question/request
    3. Note any escalations or clarifications in follow-ups
    4. Consider resolution status (resolved, ongoing, workaround provided)
    5. Classify based on final understanding, not just initial message
  `,
  // model: 'openrouter/openai/gpt-5.2',
  model: 'openrouter/google/gemini-3-pro-preview',
  // model: 'openrouter/moonshotai/kimi-k2.5'
  // model: 'openrouter/anthropic/claude-opus-4.5',
});