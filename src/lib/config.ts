// Central place for "is this integration configured?" checks.
// The app must degrade gracefully when keys are unset: clear messages, no crashes.

export function isTwilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function isMollieConfigured(): boolean {
  return Boolean(process.env.MOLLIE_API_KEY);
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_PROVIDER);
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function isHostifyConfigured(): boolean {
  return Boolean(process.env.HOSTIFY_API_KEY);
}

export function llmProvider(): "openai" | "anthropic" {
  return process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "openai";
}

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "https://hh-demo.apps.autozenixai.com").replace(/\/$/, "");
}

export function whatsappFrom(): string {
  return process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+32460201874";
}

export function smsFrom(): string {
  // SMS sender is the same number without the whatsapp: prefix.
  return whatsappFrom().replace(/^whatsapp:/, "");
}

export interface ConfigStatus {
  twilio: boolean;
  mollie: boolean;
  llm: boolean;
  llmProvider: string;
  llmModel: string;
  admin: boolean;
  hostify: boolean;
  hostifyMode: "mock" | "real-stub";
}

export function getConfigStatus(): ConfigStatus {
  return {
    twilio: isTwilioConfigured(),
    mollie: isMollieConfigured(),
    llm: isLlmConfigured(),
    llmProvider: process.env.LLM_PROVIDER || "openai",
    llmModel: process.env.LLM_MODEL || "(not set)",
    admin: isAdminConfigured(),
    hostify: isHostifyConfigured(),
    hostifyMode: isHostifyConfigured() ? "real-stub" : "mock",
  };
}
