import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUserFromRequest } from "@/lib/getUser";

const SYSTEM_PROMPT = `You are AutoPilot, a Stellar blockchain financial automation assistant.
Your job is to parse a user's plain English request into a structured automation rule JSON object.

You MUST return ONLY a valid JSON object — no markdown, no explanation, no backticks. 
Just the raw JSON object.

The JSON must match this exact structure:
{
  "trigger": "Human readable description of WHEN the rule fires (e.g. 'On each incoming XLM payment', 'Every Monday at 9am')",
  "action": "What the rule does (e.g. 'Save', 'Invest', 'Transfer', 'Buffer')",
  "amount": <number — the numeric amount or percentage value>,
  "isPercentage": <true if the amount is a percentage, false if it is a fixed amount>,
  "limits": { "maxPerMonth": <number or null — monthly cap if any> },
  "description": "1-sentence human readable summary of the rule",
  "memo": "Very short transaction memo, max 28 characters"
}

Examples:
User: "Save 10% of every payment I receive"
Response: {"trigger":"On each incoming XLM payment","action":"Save","amount":10,"isPercentage":true,"limits":{"maxPerMonth":null},"description":"Automatically save 10% of every incoming XLM payment","memo":"AutoPilot: Save 10%"}

User: "Invest $5 every week"  
Response: {"trigger":"Every week on Monday","action":"Invest","amount":5,"isPercentage":false,"limits":{"maxPerMonth":20},"description":"Automatically invest 5 XLM every week","memo":"AutoPilot: Weekly invest"}

User: "Keep a $200 buffer in my wallet"
Response: {"trigger":"When balance drops below threshold","action":"Buffer","amount":200,"isPercentage":false,"limits":{"maxPerMonth":null},"description":"Maintain a minimum balance of 200 XLM in the wallet","memo":"AutoPilot: Balance buffer"}`;

export async function POST(request: Request) {
  const user = await getUserFromRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured in .env" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(message);
    const text = result.response.text().trim();

    // Strip markdown code fences if model wraps in them
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let rule;
    try {
      rule = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "AI returned malformed JSON. Please rephrase your request." },
        { status: 422 }
      );
    }

    return NextResponse.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Chat API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
