import { GRILLME_SYSTEM_PROMPT } from "@grillme/shared/grillme";

const PROTOCOL_OPEN = "<grillme_protocol>";
const PROTOCOL_CLOSE = "</grillme_protocol>";
const PROMPT_OPEN = "<user_prompt>";
const PROMPT_CLOSE = "</user_prompt>";

export const GRILLME_PROTOCOL = GRILLME_SYSTEM_PROMPT;

export function buildFirstTurn(userPrompt: string): string {
  return `${PROTOCOL_OPEN}\n${GRILLME_PROTOCOL}\n${PROTOCOL_CLOSE}\n\n${PROMPT_OPEN}\n${userPrompt.trim()}\n${PROMPT_CLOSE}`;
}

export function displayUserMessage(message: string): string {
  const start = message.indexOf(PROMPT_OPEN);
  const end = message.lastIndexOf(PROMPT_CLOSE);
  if (start === -1 || end < start) return message;
  return message.slice(start + PROMPT_OPEN.length, end).trim();
}
