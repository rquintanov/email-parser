import { NextResponse } from "next/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const removeDiacritics = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function formatEmailText(input) {
  if (!input || typeof input !== "string") {
    return { email: "", isValid: false, confidence: 0.0, reason: "Empty input" };
  }
  let s = removeDiacritics(input.trim().toLowerCase());
  const rawTokens = s.split(/\s+/).filter(Boolean);

  const IGNORE = new Set(["espacio","espacios","todo","junto","todojunto","sin","y","con","la","el","los","las","por","favor","porfavor"]);

  const MAP_SINGLE = {
    "@": "@", "arroba": "@", "arzroba": "@", "aroba": "@", "at": "@",
    "punto": ".", "puntos": ".", "dot": ".",
    "guion": "-", "guionmedio": "-", "guion-medio": "-", "dash": "-", "hyphen": "-",
    "guionbajo": "_", "underscore": "_",
    "mas": "+", "plus": "+"
  };

  let out = "", i = 0, seenAt = false;
  while (i < rawTokens.length) {
    const t = rawTokens[i];

    if (IGNORE.has(t)) { i++; continue; }

    if (t === "guion" && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      if (next === "bajo") { out += "_"; i += 2; continue; }
      if (next === "medio" || next === "alto") { out += "-"; i += 2; continue; }
    }

    if (MAP_SINGLE[t]) {
      const sym = MAP_SINGLE[t];
      if (sym === "@") { if (!seenAt) { out += "@"; seenAt = true; } }
      else { out += sym; }
      i++; continue;
    }

    if (t === "." || t === "_" || t === "-" || t === "+") { out += t; i++; continue; }

    out += t.replace(/[^a-z0-9._+-]/g, "");
    i++;
  }

  out = out.replace(/\.+/g, ".").replace(/\.@/g, "@").replace(/@\.?/g, "@");

  if (out.includes("@")) {
    const [local, domain] = out.split("@", 2);
    const cleanLocal = (local || "").replace(/^\.+|\.+$/g, "");
    let cleanDomain = (domain || "").replace(/^\.+|\.+$/g, "");
    cleanDomain = cleanDomain.replace(/\.+/g, ".");
    out = cleanLocal + "@" + cleanDomain;
  } else {
    out = out.replace(/^\.+|\.+$/g, "");
  }

  const { isValid, confidence, local, domain } = validateEmail(out);
  return { input, email: out, isValid, confidence, local, domain };
}

function validateEmail(email) {
  const at = email.indexOf("@");
  if (at === -1) return { isValid: false, confidence: 0.4, local: "", domain: "" };
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const localOk = /^[a-z0-9._+-]+$/.test(local) && local.length > 0;
  const domainOk = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !domain.includes("..");
  let confidence = 0.6;
  if (localOk && domainOk) confidence = 0.99;
  else if (localOk && domain.length > 0) confidence = 0.8;
  return { isValid: localOk && domainOk, confidence, local, domain };
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text") || "";
  if (!text) return NextResponse.json({ error: 'Falta el parámetro "text".' }, { status: 400, headers: CORS });
  return NextResponse.json(formatEmailText(text), { headers: CORS });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const text = body.text || "";
  if (!text) return NextResponse.json({ error: 'Falta el parámetro "text".' }, { status: 400, headers: CORS });
  return NextResponse.json(formatEmailText(text), { headers: CORS });
}
