// Serverless Function para Vercel (Node.js)
// Endpoint: /api/format-email
// Métodos: GET y POST
//
// Uso rápido:
//  - GET  /api/format-email?text=manuel%20fernandez%20arroba%20gmail%20punto%20com
//  - POST /api/format-email  { "text": "manuel fernandez arroba gmail punto com" }

const allowCORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const removeDiacritics = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function formatEmailText(input) {
  if (!input || typeof input !== "string") {
    return { email: "", isValid: false, confidence: 0.0, reason: "Empty input" };
  }

  // Normalizar: minúsculas + sin acentos
  let s = removeDiacritics(input.trim().toLowerCase());

  // Tokenizar por espacios (el ASR suele dejar espacios)
  const rawTokens = s.split(/\s+/).filter(Boolean);

  // Palabras/bi-gramas a símbolos
  // Nota: ya sin acentos: "guion", "mas", etc.
  const IGNORE = new Set([
    "espacio", "espacios", "todo", "junto", "todojunto", "sin",
    "y", "con", "la", "el", "los", "las", "por", "favor", "porfavor"
  ]);

  const MAP_SINGLE = {
    "@": "@",
    "arroba": "@",
    "at": "@",
    "punto": ".",
    "dot": ".",
    "puntos": ".",
    "guion": "-",            // si viene solo
    "guionmedio": "-",
    "guion-medio": "-",
    "dash": "-",
    "hyphen": "-",
    "guionbajo": "_",
    "underscore": "_",
    "mas": "+",
    "plus": "+"
  };

  // Construcción cuidando bi-gramas "guion bajo" y "guion medio"
  let out = "";
  let i = 0;
  let seenAt = false;

  while (i < rawTokens.length) {
    const t = rawTokens[i];

    // Ignorar "relleno"
    if (IGNORE.has(t)) { i++; continue; }

    // Bi-gramas: "guion bajo" / "guion medio"
    if (t === "guion" && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      if (next === "bajo") { out += "_"; i += 2; continue; }
      if (next === "medio" || next === "alto") { out += "-"; i += 2; continue; }
    }

    // Mapeos directos
    if (MAP_SINGLE[t]) {
      const sym = MAP_SINGLE[t];
      if (sym === "@") {
        if (!seenAt) { out += "@"; seenAt = true; }
      } else {
        out += sym;
      }
      i++;
      continue;
    }

    // Si el token ya es un símbolo válido, respétalo
    if (t === "." || t === "_" || t === "-" || t === "+") {
      out += t;
      i++;
      continue;
    }

    // En otro caso, añadir el token "limpio" (solo caracteres típicos de email)
    out += t.replace(/[^a-z0-9._+-]/g, "");
    i++;
  }

  // Limpiezas finales
  // 1) Colapsar puntos repetidos
  out = out.replace(/\.+/g, ".");
  // 2) Evitar ".@" o "@."
  out = out.replace(/\.@/g, "@").replace(/@\.?/g, "@");
  // 3) Quitar puntos sobrantes al principio/fin de cada parte
  if (out.includes("@")) {
    const [local, domain] = out.split("@", 2);
    const cleanLocal = (local || "").replace(/^\.+|\.+$/g, "");
    let cleanDomain = (domain || "").replace(/^\.+|\.+$/g, "");

    // Quitar duplicados de punto en dominio y evitar ".."
    cleanDomain = cleanDomain.replace(/\.+/g, ".");

    out = cleanLocal + "@" + cleanDomain;
  } else {
    // Si no hay arroba, elimina puntos al principio y fin globales
    out = out.replace(/^\.+|\.+$/g, "");
  }

  // Validación y confianza
  const result = validateEmail(out);
  return {
    input: input,
    email: out,
    isValid: result.isValid,
    confidence: result.confidence,
    local: result.local,
    domain: result.domain
  };
}

function validateEmail(email) {
  const at = email.indexOf("@");
  if (at === -1) {
    return { isValid: false, confidence: 0.4, local: "", domain: "" };
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // Reglas básicas (ASCII típico)
  const localOk = /^[a-z0-9._+-]+$/.test(local) && local.length > 0;
  const domainOk =
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !domain.includes("..");

  let confidence = 0.6;
  if (localOk && domainOk) confidence = 0.99;
  else if (localOk && domain.length > 0) confidence = 0.8;

  return {
    isValid: localOk && domainOk,
    confidence,
    local,
    domain
  };
}

module.exports = async (req, res) => {
  allowCORS(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    let text;
    if (req.method === "GET") {
      text = (req.query && req.query.text) || "";
    } else if (req.method === "POST") {
      if (!req.body) {
        // Si Vercel no parsea, leer manualmente
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        try { text = JSON.parse(raw).text; } catch { text = ""; }
      } else {
        text = req.body.text;
      }
    } else {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: 'Falta el parámetro "text" (string).' });
      return;
    }

    const result = formatEmailText(text);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", details: String(err) });
  }
};
