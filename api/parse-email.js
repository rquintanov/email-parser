// Serverless Function para Vercel (Framework: Other / Node.js)
// Ruta     : /api/parse-email
// Métodos  : GET, POST, OPTIONS
//
// Ejemplo POST (body JSON):
//   { "text": "raul quintano vazquez @ gamail punto com" }

const allowCORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const removeDiacritics = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Normaliza frases dictadas (“arroba”, “punto”) y devuelve email + métricas */
function formatEmailText(input) {
  if (!input || typeof input !== "string") {
    return { email: "", isValid: false, confidence: 0.0, reason: "Empty input" };
  }

  // 1) Normalizar texto
  let s = removeDiacritics(input.trim().toLowerCase());
  const rawTokens = s.split(/\s+/).filter(Boolean);

  // 2) Diccionarios
  const IGNORE = new Set([
    "espacio","espacios","todo","junto","todojunto","sin",
    "y","con","la","el","los","las","por","favor","porfavor","porfa"
  ]);

  const MAP_SINGLE = {
    "@": "@",
    "arroba": "@", "aroba": "@", "arrova": "@", "arzroba": "@", "at": "@",
    "punto": ".", "puntos": ".", "dot": ".",
    "guion": "-", "guionmedio": "-", "guion-medio": "-", "dash": "-", "hyphen": "-",
    "guionbajo": "_", "underscore": "_",
    "mas": "+", "plus": "+"
  };

  // 3) Recorrer tokens
  let out = "";
  let i = 0;
  let seenAt = false;

  while (i < rawTokens.length) {
    const t = rawTokens[i];

    if (IGNORE.has(t)) { i++; continue; }

    // Bi-gramas “guion bajo / medio”
    if (t === "guion" && i + 1 < rawTokens.length) {
      const next = rawTokens[i + 1];
      if (next === "bajo")               { out += "_"; i += 2; continue; }
      if (next === "medio" || next === "alto") { out += "-"; i += 2; continue; }
    }

    if (MAP_SINGLE[t]) {
      const sym = MAP_SINGLE[t];
      if (sym === "@") { if (!seenAt) { out += "@"; seenAt = true; } }
      else              { out += sym; }
      i++; continue;
    }

    if (t === "." || t === "_" || t === "-" || t === "+") { out += t; i++; continue; }

    // Resto de tokens: solo caracteres válidos de email
    out += t.replace(/[^a-z0-9._+-]/g, "");
    i++;
  }

  // 4) Limpiezas básicas
  out = out
    .replace(/\.+/g, ".")   // colapsar puntos
    .replace(/\.@/g, "@")   // ".@" → "@"
    .replace(/@\.?/g, "@"); // "@." o "@.." → "@"

  // 5) *** NUEVA LÓGICA para asegurar la "@" ***
  if (!out.includes("@")) {
    // Estrategia 1 ─ había token "@" pero se perdió con espacios
    if (seenAt) {
      const m = out.match(/(.*?)([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)$/i);
      if (m) {
        const local  = m[1].replace(/[\.\-_+]+$/g, "");
        const domain = m[2].replace(/^[\.\-_+]+/g, "");
        if (local && domain) out = `${local}@${domain}`;
      }
    }
    // Estrategia 2 ─ nunca se dictó "@" (ventas empresa punto com)
    if (!out.includes("@")) {
      const m = out.match(/(.*?)([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)$/i);
      if (m) {
        const local  = m[1].replace(/[\.\-_+]+$/g, "");
        const domain = m[2].replace(/^[\.\-_+]+/g, "");
        if (local && domain) out = `${local}@${domain}`;
      }
    }
  }

  // 6) Ajustes finales de cada parte
  if (out.includes("@")) {
    const [local, domain] = out.split("@", 2);
    const cleanLocal  = (local  || "").replace(/^\.+|\.+$/g, "");
    let   cleanDomain = (domain || "").replace(/^\.+|\.+$/g, "");
    cleanDomain = cleanDomain.replace(/\.+/g, ".");
    out = cleanLocal + "@" + cleanDomain;
  } else {
    out = out.replace(/^\.+|\.+$/g, "");
  }

  // 7) Validar
  const { isValid, confidence, local, domain } = validateEmail(out);
  return { input, email: out, isValid, confidence, local, domain };
}

function validateEmail(email) {
  const at = email.indexOf("@");
  if (at === -1) return { isValid: false, confidence: 0.4, local: "", domain: "" };

  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);

  const localOk  = /^[a-z0-9._+-]+$/.test(local)   && local.length > 0;
  const domainOk = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !domain.includes("..");

  let confidence = 0.6;
  if (localOk && domainOk)          confidence = 0.99;
  else if (localOk && domain.length) confidence = 0.8;

  return { isValid: localOk && domainOk, confidence, local, domain };
}

module.exports = async (req, res) => {
  allowCORS(res);

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    let text = "";

    if (req.method === "GET") {
      text = req.query?.text || "";
    } else if (req.method === "POST") {
      if (!req.body) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        text = JSON.parse(raw || "{}").text || "";
      } else {
        text = req.body.text || "";
      }
    } else {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    if (!text) {
      res.status(400).json({ error: 'Falta el parámetro "text" (string).' });
      return;
    }

    res.status(200).json(formatEmailText(text));
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", details: String(err) });
  }
};
