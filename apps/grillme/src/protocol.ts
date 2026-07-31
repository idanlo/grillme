const PROTOCOL_OPEN = "<grillme_protocol>";
const PROTOCOL_CLOSE = "</grillme_protocol>";
const PROMPT_OPEN = "<user_prompt>";
const PROMPT_CLOSE = "</user_prompt>";

export const GRILLME_PROTOCOL = `Interview the user relentlessly about every aspect of their request until you reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask exactly one question at a time and wait for the user's answer before continuing. Use the provider's structured user-input or question tool for every decision question. Put your recommended option first, append "(Recommended)" to its label, and briefly explain the impact or tradeoff of every option. Offer two or three concrete options; the UI also lets the user provide a custom answer.

If a fact can be found by exploring the environment, filesystem, repository, or available tools, look it up instead of asking the user. Keep that exploration non-mutating. The decisions belong to the user, so put each decision to them and wait for their answer.

Do not implement, edit, or otherwise act on the request. Continue interviewing until the user confirms that you have reached a shared understanding. When they confirm, acknowledge it and wait.`;

export function buildFirstTurn(userPrompt: string): string {
  return `${PROTOCOL_OPEN}\n${GRILLME_PROTOCOL}\n${PROTOCOL_CLOSE}\n\n${PROMPT_OPEN}\n${userPrompt.trim()}\n${PROMPT_CLOSE}`;
}

export function displayUserMessage(message: string): string {
  const start = message.indexOf(PROMPT_OPEN);
  const end = message.lastIndexOf(PROMPT_CLOSE);
  if (start === -1 || end < start) return message;
  return message.slice(start + PROMPT_OPEN.length, end).trim();
}
