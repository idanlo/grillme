const GRILLME_PROTOCOL_OPEN = "<grillme_protocol>";
const GRILLME_PROTOCOL_CLOSE = "</grillme_protocol>";
const GRILLME_PROMPT_OPEN = "<user_prompt>";
const GRILLME_PROMPT_CLOSE = "</user_prompt>";

export const GRILLME_PROTOCOL = `Interview the user relentlessly about every aspect of their request until you reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask exactly one question at a time and wait for the user's answer before continuing. Use the provider's structured user-input or question tool for every decision question. Put your recommended option first, append "(Recommended)" to its label, and briefly explain the impact or tradeoff of every option. Offer two or three concrete options; the UI also lets the user provide a custom answer.

If a fact can be found by exploring the environment, filesystem, repository, or available tools, look it up instead of asking the user. Keep that exploration non-mutating. The decisions belong to the user, so put each decision to them and wait for their answer.

Do not implement, edit, or otherwise act on the request. Continue interviewing until the user confirms that you have reached a shared understanding. When they confirm, acknowledge it and wait.`;

export function buildGrillmeFirstTurn(userPrompt: string): string {
  return `${GRILLME_PROTOCOL_OPEN}\n${GRILLME_PROTOCOL}\n${GRILLME_PROTOCOL_CLOSE}\n\n${GRILLME_PROMPT_OPEN}\n${userPrompt}\n${GRILLME_PROMPT_CLOSE}`;
}

export function extractGrillmeUserPrompt(message: string): string | null {
  const protocolStart = message.indexOf(GRILLME_PROTOCOL_OPEN);
  const providerPrefix = protocolStart === -1 ? "" : message.slice(0, protocolStart).trim();
  if (protocolStart === -1 || (providerPrefix !== "" && providerPrefix !== "Ultrathink:")) {
    return null;
  }

  const promptStart = message.indexOf(GRILLME_PROMPT_OPEN);
  const promptEnd = message.lastIndexOf(GRILLME_PROMPT_CLOSE);
  if (promptStart === -1 || promptEnd === -1 || promptEnd < promptStart) {
    return null;
  }

  return message.slice(promptStart + GRILLME_PROMPT_OPEN.length, promptEnd).trim();
}

export function displayGrillmeUserMessage(message: string): string {
  return extractGrillmeUserPrompt(message) ?? message;
}
