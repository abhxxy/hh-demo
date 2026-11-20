// LLM chat with tool calling. Provider is configurable via env:
// LLM_PROVIDER=openai|anthropic, LLM_API_KEY, LLM_MODEL.
// Direct fetch calls — no SDK. Errors never throw to the caller: the chat
// route always gets a friendly reply.
// When the LLM is not configured, a small rule-based responder answers using
// the same tools, so the demo chat still works (and says so honestly).
import { executeTool, TOOL_DEFINITIONS, ToolResult } from "./tools";
import { getReservationWithProperty } from "./availability";
import { isLlmConfigured, llmProvider } from "./config";
import { prisma } from "./prisma";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const SYSTEM_PROMPT = `You are the Home & Hill guest assistant, chatting with a guest who has just registered for their stay. Be warm, brief and practical.

Rules:
- ALWAYS use the provided tools for prices, availability, bookings and payments. Never invent a price or a time. If a tool says a slot is unavailable, say so and suggest the next available slot, explaining the price.
- If the guest asks for something cheaper, look at the tool results and offer the cheapest available option.
- When the guest accepts an extra, call create_hold and then create_payment, and show the payment link from create_payment in your reply. Holds last 15 minutes.
- You can also offer late check-out, breakfast and an upgrade when relevant.
- If the guest reports a problem, use report_issue with their description.
- Reply in the same language the guest writes in. Keep replies short (2-4 sentences) unless listing options.
- On the very first message, greet the guest by name and ask what time they expect to arrive.`;

function openAiTools() {
  return TOOL_DEFINITIONS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

function anthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

interface LlmCall {
  text: string;
  toolCalls: Array<{ name: string; args: ToolResult }>;
}

async function callOpenAi(messages: Array<Record<string, unknown>>, model: string): Promise<LlmCall> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: openAiTools(), tool_choice: "auto", temperature: 0.4 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(json as { error?: { message?: string } }).error?.message || "unknown"}`);
  const msg = (json as { choices: Array<{ message: { content?: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> }).choices?.[0]?.message;
  const toolCalls = (msg?.tool_calls || []).map((tc) => {
    let args: ToolResult = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch {
      args = {};
    }
    return { name: tc.function.name, args };
  });
  return { text: msg?.content || "", toolCalls };
}

async function callAnthropic(messages: Array<Record<string, unknown>>, model: string, system: string): Promise<LlmCall> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.LLM_API_KEY || "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages, tools: anthropicTools(), temperature: 0.4 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(json as { error?: { message?: string } }).error?.message || "unknown"}`);
  const content = (json as { content: Array<{ type: string; text?: string; name?: string; input?: ToolResult }> }).content || [];
  const text = content.filter((c) => c.type === "text").map((c) => c.text || "").join("");
  const toolCalls = content
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({ name: c.name!, args: (c.input || {}) as ToolResult }));
  return { text, toolCalls };
}

/** Run one user turn through the LLM with the tool loop (max 6 rounds). */
export async function runLlmChat(reservationId: string, history: ChatTurn[], userText: string): Promise<string> {
  const res = await getReservationWithProperty(reservationId);
  const model = process.env.LLM_MODEL || (llmProvider() === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini");
  const provider = llmProvider();
  const context = res
    ? `Guest: ${res.guestName}. Property: ${res.property.name} (${res.property.bedrooms} bed). Stay: ${res.checkinDate} → ${res.checkoutDate}. Check-in ${res.checkinTime}, check-out ${res.checkoutTime}. Guests: ${res.guests}. Arrived: ${res.arrived ? "yes" : "no"}.`
    : "";
  const system = SYSTEM_PROMPT + (context ? `\n\nReservation context:\n${context}` : "");

  // OpenAI message list; Anthropic gets the same minus the system message.
  const baseMessages: Array<Record<string, unknown>> = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ];

  try {
    let messages: Array<Record<string, unknown>> =
      provider === "openai" ? [{ role: "system", content: system }, ...baseMessages] : baseMessages;
    let lastText = "";
    for (let round = 0; round < 6; round++) {
      const call = provider === "openai" ? await callOpenAi(messages, model) : await callAnthropic(messages, model, system);
      if (call.text) lastText = call.text;
      if (call.toolCalls.length === 0) {
        return call.text || lastText || "I'm here — what would you like to know about your stay?";
      }
      // Execute tools, then feed the results back.
      const results: Array<{ name: string; result: ToolResult }> = [];
      for (const tc of call.toolCalls) {
        const result = await executeTool(tc.name, tc.args, reservationId).catch((e) => ({ error: String(e) }));
        results.push({ name: tc.name, result });
      }
      if (provider === "openai") {
        messages = [
          ...messages,
          { role: "assistant", content: call.text || null, tool_calls: call.toolCalls.map((tc, i) => ({ id: `call_${round}_${i}`, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) },
          ...results.map((r, i) => ({ role: "tool", tool_call_id: `call_${round}_${i}`, content: JSON.stringify(r.result) })),
        ];
      } else {
        messages = [
          ...messages,
          { role: "assistant", content: [{ type: "text", text: call.text || "" }, ...call.toolCalls.map((tc, i) => ({ type: "tool_use", id: `call_${round}_${i}`, name: tc.name, input: tc.args }))] },
          { role: "user", content: results.map((r, i) => ({ type: "tool_result", tool_use_id: `call_${round}_${i}`, content: JSON.stringify(r.result) })) },
        ];
      }
    }
    return lastText || "Let me know if there's anything else about your stay.";
  } catch (e) {
    console.warn(`[llm] chat failed (${provider}/${model}): ${e instanceof Error ? e.message : e}`);
    return "Sorry — I'm having trouble reaching the assistant right now. Please try again in a moment, or message the team and they'll help.";
  }
}

// ---------------------------------------------------------------------------
// Rule-based fallback (no LLM key): answers with the same tools, honestly
// labelled as the built-in guide. Keeps the demo chat working without keys.
// ---------------------------------------------------------------------------

const FR = ["bonjour", "merci", "arrivée", "arrivee", "heure", "petit", "déjeuner", "dejeuner", "s'il", "svp"];
const NL = ["hallo", "bedankt", "aankomst", "ontbijt", "graag", "alstublieft", "hoe laat"];

function detectLang(text: string): "fr" | "nl" | "en" {
  const t = ` ${text.toLowerCase()} `;
  if (FR.some((w) => t.includes(w))) return "fr";
  if (NL.some((w) => t.includes(w))) return "nl";
  return "en";
}

const T = {
  en: {
    greeting: (name: string) => `Hi ${name}! Welcome to Home & Hill. What time do you expect to arrive? (Check-in is from 16:00, but earlier may be possible.)`,
    help: "I can help with early check-in, late check-out, breakfast, an upgrade, or reporting an issue. Just ask — for example 'early check-in at 13:00' or 'book breakfast for 2 at 09:00'.",
    needTime: "What time would you like to check in? Early check-in is available from 12:00 — tell me a time and I'll check the price.",
    holdOk: (label: string, amount: number) => `Done — I've held ${label} for €${amount.toFixed(2)} for 15 minutes.`,
    payLink: (url: string) => `You can pay here: ${url}`,
    payUnavailable: "Payments aren't configured yet, so I can't make a payment link right now — but the hold is saved for 15 minutes and our team can confirm it from the dashboard.",
    booked: "Great — that's booked in. Anything else for your stay?",
  },
  fr: {
    greeting: (name: string) => `Bonjour ${name} ! Bienvenue chez Home & Hill. À quelle heure prévoyez-vous d'arriver ? (L'arrivée est à partir de 16h00, mais plus tôt est parfois possible.)`,
    help: "Je peux vous aider pour une arrivée anticipée, un départ tardif, le petit-déjeuner, un surclassement ou signaler un problème. Par exemple : « arrivée anticipée à 13h00 » ou « petit-déjeuner pour 2 à 09h00 ».",
    needTime: "À quelle heure souhaitez-vous arriver ? L'arrivée anticipée est possible dès 12h00 — dites-moi une heure et je vérifie le prix.",
    holdOk: (label: string, amount: number) => `C'est noté — j'ai réservé ${label} pour ${amount.toFixed(2)} € pendant 15 minutes.`,
    payLink: (url: string) => `Vous pouvez payer ici : ${url}`,
    payUnavailable: "Les paiements ne sont pas encore configurés, je ne peux donc pas créer de lien de paiement — mais la réservation est bloquée 15 minutes et notre équipe peut la confirmer.",
    booked: "Parfait — c'est réservé. Autre chose pour votre séjour ?",
  },
  nl: {
    greeting: (name: string) => `Hallo ${name}! Welkom bij Home & Hill. Hoe laat denkt u aan te komen? (Inchecken kan vanaf 16:00, vroeger is soms mogelijk.)`,
    help: "Ik kan helpen met vroeg inchecken, laat uitchecken, ontbijt, een upgrade of een probleem melden. Bijvoorbeeld: 'vroeg inchecken om 13:00' of 'ontbijt voor 2 om 09:00'.",
    needTime: "Hoe laat wilt u inchecken? Vroeg inchecken kan vanaf 12:00 — noem een tijd en ik controleer de prijs.",
    holdOk: (label: string, amount: number) => `Gedaan — ik heb ${label} voor €${amount.toFixed(2)} 15 minuten vastgehouden.`,
    payLink: (url: string) => `U kunt hier betalen: ${url}`,
    payUnavailable: "Betalingen zijn nog niet ingesteld, dus ik kan nu geen betaallink maken — maar de reservering staat 15 minuten vast en ons team kan deze bevestigen.",
    booked: "Top — dat staat genoteerd. Nog iets voor uw verblijf?",
  },
} as const;

function parseTime(text: string): string | null {
  // Prefer an explicit HH:MM ("09:00") — a bare number like "for 2" must never
  // be mistaken for a time. Fall back to a bare hour only after "at".
  const withMinutes = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (withMinutes) {
    const h = Number(withMinutes[1]);
    const min = Number(withMinutes[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    return null;
  }
  const bare = text.match(/\bat\s+(\d{1,2})\s*(?:h)?\b/);
  if (bare) {
    const h = Number(bare[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

export async function ruleBasedReply(reservationId: string, userText: string): Promise<string> {
  const lang = detectLang(userText);
  const t = T[lang];
  const text = userText.toLowerCase();
  const res = await getReservationWithProperty(reservationId);
  const name = res?.guestName?.split(" ")[0] || "there";

  // First message in the thread that is ONLY a greeting -> greet back.
  // (A greeting plus a question, e.g. "Hi, can I check in early?", goes
  // straight to the question.)
  const count = await prisma.chatMessage.count({ where: { reservationId, role: "user" } });
  if (count <= 1 && /^(hi|hello|hey|bonjour|hallo|good\s+(morning|afternoon|evening))\s*[!.?]*$/i.test(userText.trim())) {
    return t.greeting(name);
  }

  // Book commands: "book 13:00", "book early 13:00", "book late 12:00", "book breakfast 2 at 09:00", "book upgrade"
  if (/book|reserve|yes|confirm|ok\b/.test(text) || /ja|oui/.test(text)) {
    if (/breakfast|ontbijt|petit/.test(text)) {
      const people = Number((text.match(/for\s+(\d+)/) || [])[1] || res?.guests || 2);
      const time = parseTime(text) || "08:00";
      const hold = await executeTool("create_hold", { extraType: "breakfast", slot: "breakfast", people, deliveryTime: time }, reservationId);
      if ((hold as { error?: string }).error) return (hold as { message?: string }).message || t.help;
      return await payStep(reservationId, hold as { holdId: string; amount: number; label?: string }, t);
    }
    if (/upgrade|surclass/.test(text)) {
      const hold = await executeTool("create_hold", { extraType: "upgrade", slot: "upgrade" }, reservationId);
      if ((hold as { error?: string }).error) return (hold as { message?: string }).message || t.help;
      return await payStep(reservationId, hold as { holdId: string; amount: number; label?: string }, t);
    }
    if (/late|depart|check-out|checkout|uitcheck/.test(text)) {
      const time = parseTime(text);
      if (!time) return t.needTime;
      const hold = await executeTool("create_hold", { extraType: "late_checkout", slot: time }, reservationId);
      if ((hold as { error?: string }).error) return (hold as { message?: string }).message || t.help;
      return await payStep(reservationId, hold as { holdId: string; amount: number; label?: string }, t);
    }
    const time = parseTime(text);
    if (time) {
      const hold = await executeTool("create_hold", { extraType: "early_checkin", slot: time }, reservationId);
      if ((hold as { error?: string }).error) return (hold as { message?: string }).message || t.help;
      return await payStep(reservationId, hold as { holdId: string; amount: number; label?: string }, t);
    }
  }

  // Questions about options.
  if (/early|check-in|checkin|incheck|arriv/.test(text)) {
    const r = (await executeTool("get_early_checkin_options", {}, reservationId)) as { options?: Array<{ time: string; price: number; available: boolean; reason?: string }> };
    const opts = r.options || [];
    // "Cheaper?" -> suggest the cheapest available slot, don't anchor on a
    // time mentioned in the question ("cheaper than 13:00").
    if (/cheaper|cheapest|cheap/.test(text)) {
      const available = opts.filter((o) => o.available).sort((a, b) => a.price - b.price);
      const cheapest = available[0];
      if (cheapest) {
        return `The cheapest early check-in is ${cheapest.time} for €${cheapest.price.toFixed(2)} (check-in from 16:00 is free). Want me to hold ${cheapest.time} for you? Just reply "book ${cheapest.time}".`;
      }
      return "Check-in from 16:00 is included in your stay. Earlier times have a small fee — tell me what time you'd like and I'll check.";
    }
    const time = parseTime(text);
    if (time) {
      const opt = opts.find((o) => o.time === time);
      if (opt && opt.available) {
        return `Early check-in at ${time} is available for €${opt.price.toFixed(2)}. Reply "book ${time}" and I'll hold it for 15 minutes so you can pay.`;
      }
      const next = opts.find((o) => o.available);
      if (opt && !opt.available) {
        return `${time} isn't possible — ${opt.reason || ""} The next available slot is ${next ? `${next.time} for €${next.price.toFixed(2)}` : "16:00, which is included"}. Reply "book ${next?.time || "16:00"}" if that works.`;
      }
    }
    const list = opts.map((o) => `${o.time}: €${o.price.toFixed(2)}${o.available ? "" : " (not available)"}`).join(", ");
    return `Early check-in options: ${list}. Check-in from 16:00 is included. Tell me a time and I'll hold it for you.`;
  }
  if (/late|check-out|checkout|uitcheck|depart/.test(text)) {
    const time = parseTime(text);
    const r = (await executeTool("get_late_checkout_options", {}, reservationId)) as { options?: Array<{ time: string; price: number; available: boolean; reason?: string }> };
    const opts = r.options || [];
    if (time) {
      const opt = opts.find((o) => o.time === time);
      if (opt && opt.available) return `Late check-out at ${time} is available for €${opt.price.toFixed(2)}. Reply "book late ${time}" and I'll hold it for you.`;
      const next = opts.find((o) => o.available);
      return `${time} isn't possible. The next available option is ${next ? `${next.time} for €${next.price.toFixed(2)}` : "10:00, which is included"}.`;
    }
    return `Late check-out options: ${opts.map((o) => `${o.time}: €${o.price.toFixed(2)}${o.available ? "" : " (not available)"}`).join(", ")}. Check-out at 10:00 is included.`;
  }
  if (/breakfast|ontbijt|petit/.test(text)) {
    const r = (await executeTool("get_breakfast_options", {}, reservationId)) as { pricePerPerson?: number; deliveryTimes?: string[] };
    return `Our breakfast basket is €${(r.pricePerPerson ?? 15).toFixed(2)} per person, delivered at ${(r.deliveryTimes || []).join(", ")}. How many people, and what time? For example: "book breakfast for 2 at 09:00".`;
  }
  if (/upgrade|surclass|larger|bigger/.test(text)) {
    const r = (await executeTool("check_upgrade", {}, reservationId)) as { available?: boolean; targetProperty?: string; total?: number; perNight?: number; nights?: number; reason?: string };
    if (r.available) return `You can upgrade to ${r.targetProperty} for €${(r.perNight ?? 0).toFixed(2)} per night — €${(r.total ?? 0).toFixed(2)} for your ${r.nights}-night stay. Reply "book upgrade" and I'll hold it for you.`;
    return r.reason || "Sorry, no upgrade is available for your stay.";
  }
  if (/problem|issue|broken|not working|probl|kapot|panne/.test(text)) {
    const r = (await executeTool("report_issue", { details: userText }, reservationId)) as { message?: string };
    return r.message || "Thanks — I've passed that on to our team.";
  }
  if (/arrived|arrive|here|aankomst|arrivée/.test(text)) {
    await executeTool("confirm_arrival", {}, reservationId);
    return "Welcome! Enjoy your stay — message me here any time if you need anything.";
  }
  if (/price|cost|cheaper|cheap|prijs|prix|koste/.test(text)) {
    const r = (await executeTool("get_early_checkin_options", {}, reservationId)) as { options?: Array<{ time: string; price: number; available: boolean }> };
    const cheapest = (r.options || []).filter((o) => o.available).sort((a, b) => a.price - b.price)[0];
    return cheapest
      ? `The cheapest early check-in is ${cheapest.time} for €${cheapest.price.toFixed(2)} (check-in from 16:00 is free). Want me to hold ${cheapest.time} for you?`
      : "Check-in from 16:00 is included in your stay. Earlier times have a small fee — tell me what time you'd like and I'll check.";
  }
  return t.help;
}

type LangStrings = (typeof T)[keyof typeof T];

async function payStep(
  reservationId: string,
  hold: { holdId: string; amount: number; label?: string },
  t: LangStrings,
): Promise<string> {
  const label = hold.label || "your extra";
  const base = t.holdOk(label, hold.amount);
  const pay = (await executeTool("create_payment", { holdId: hold.holdId }, reservationId)) as { checkoutUrl?: string; error?: string };
  if (pay.checkoutUrl) return `${base}\n${t.payLink(pay.checkoutUrl)}`;
  if (pay.error === "mollie_not_configured") return `${base}\n${t.payUnavailable}`;
  return base;
}

export { isLlmConfigured };
