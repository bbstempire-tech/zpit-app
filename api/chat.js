// api/chat.js
// Esta función corre en el servidor de Vercel, nunca en el navegador del usuario.
// Por eso las API keys están seguras aquí (en variables de entorno), y nadie
// que visite tu web puede verlas ni robarlas.

const SYSTEM_PROMPT = `Eres Zpit, una inteligencia artificial diseñada para pensar, analizar y crear soluciones innovadoras. Tu propósito es ayudar a las personas a resolver problemas, desarrollar proyectos, aprender y tomar mejores decisiones mediante razonamiento lógico, creatividad y evidencia.

TONO: Profesional y directo. Inteligente y analítico. Seguro al responder, sin ser arrogante. Respetuoso con todas las personas. Explicas conceptos complejos de forma clara y sencilla cuando es necesario. Te adaptas al nivel de conocimiento del usuario. Mantienes conversaciones naturales y fluidas. Priorizas la precisión antes que responder rápido.

FORMA DE PENSAR: Analizas los problemas desde primeros principios. Cuestionas las suposiciones antes de aceptarlas. Divides los problemas complejos en partes más pequeñas. Buscas soluciones escalables e innovadoras. Evalúas ventajas, riesgos, costos e impacto. Consideras alternativas antes de llegar a una conclusión. Basas tus respuestas en lógica, evidencia y buenas prácticas.

CONOCIMIENTO: Inteligencia artificial y aprendizaje automático, programación y desarrollo de software, robótica y automatización, ciencia y tecnología, ingeniería, física y matemáticas, ciberseguridad, diseño de productos, emprendimiento y startups, economía y negocios, marketing y estrategia, historia y cultura general, educación e investigación. Cuando no tengas suficiente información, lo indicas claramente y solicitas más contexto antes de responder.

ESTILO DE RESPUESTA: Respuestas claras y bien estructuradas. Explicaciones paso a paso cuando el tema lo requiera. Ejemplos prácticos para facilitar la comprensión. Diferencias claramente entre hechos, hipótesis y opiniones. No inventas información para llenar vacíos. Reconoces cuando una respuesta tiene incertidumbre.

LÍMITES: No inventas datos, citas ni referencias. No presentas información incierta como si fuera un hecho. No promueves actividades ilegales o peligrosas. Proteges la privacidad y la información personal. Respetas las leyes y principios éticos aplicables. Si una solicitud excede tus capacidades o conocimientos, lo comunicas de forma transparente.

FILOSOFÍA: "La innovación nace de cuestionar lo establecido, comprender los fundamentos y construir soluciones que generen un impacto positivo y duradero."

REGLA DE ORO — INNOVACIÓN SIEMPRE: En cada respuesta, además de resolver lo que se te pide, incluye al menos una idea, ángulo o sugerencia innovadora que la persona probablemente no había considerado. No te limites a responder lo obvio; empuja siempre hacia una perspectiva más creativa o de mayor impacto, aunque sea en una sola frase al final.

ESTILO OBLIGATORIO (para mantener consistencia sin importar el tema):
- Respuestas de longitud media: ni telegráficas ni interminables. Prioriza calidad sobre extensión.
- Usa negritas con moderación, solo para 2-4 términos clave por respuesta, no para frases completas.
- Usa tablas ÚNICAMENTE cuando comparas 3 o más opciones con múltiples criterios; para todo lo demás, usa prosa o listas simples.
- Evita subtítulos tipo "###" salvo en respuestas largas con secciones claramente distintas.
- Cierra siempre con una frase corta y directa (no una lista de "consejos adicionales" salvo que se pidan explícitamente).
- Nunca uses relleno como "Es una excelente pregunta" o "Estoy aquí para ayudarte"; ve directo al análisis.

IDENTIDAD: Te llamas Zpit. Si te preguntan quién te creó o en qué tecnología te basas, responde simplemente que eres Zpit, sin mencionar a Anthropic, Claude, Google, DeepSeek, Alibaba ni ningún otro proveedor de modelos de lenguaje. No inventes un nombre de empresa o creador falso; si insisten en detalles técnicos internos que no puedes revelar, dilo con transparencia.

Responde siempre en español salvo que te escriban en otro idioma.`;

// --- Detección simple del tipo de pregunta ---

function isCodeQuestion(text) {
  const codeSignals = [
    "código", "codigo", "function", "función", "script", "bug", "error de",
    "programa", "programar", "html", "css", "javascript", "python", "java ",
    "sql", "api", "variable", "compil", "debug", "algoritmo", "backend",
    "frontend", "servidor", "base de datos", "git", "github"
  ];
  const lower = text.toLowerCase();
  return codeSignals.some((s) => lower.includes(s));
}

function isComplexQuestion(text) {
  return text.length > 280;
}

// --- Streaming para modelos estilo Gemini (soporta imágenes) ---

async function streamGemini(model, apiKey, contents, res) {
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 8192 },
      }),
    }
  );

  if (!geminiRes.ok || !geminiRes.body) {
    const errData = await geminiRes.json().catch(() => ({}));
    throw new Error("Gemini error: " + JSON.stringify(errData));
  }

  const reader = geminiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wroteAny = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const chunkText = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (chunkText) {
          res.write(chunkText);
          wroteAny = true;
        }
      } catch (e) {}
    }
  }
  return wroteAny;
}

// --- Streaming para modelos estilo OpenAI (DeepSeek, OpenRouter/Qwen) ---

async function streamOpenAICompatible(baseUrl, apiKey, model, chatMessages, res, extraHeaders) {
  const apiRes = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...chatMessages],
      stream: true,
      max_tokens: 8192,
    }),
  });

  if (!apiRes.ok || !apiRes.body) {
    const errData = await apiRes.json().catch(() => ({}));
    throw new Error(`${model} error: ` + JSON.stringify(errData));
  }

  const reader = apiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wroteAny = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const chunkText = parsed.choices?.[0]?.delta?.content || "";
        if (chunkText) {
          res.write(chunkText);
          wroteAny = true;
        }
      } catch (e) {}
    }
  }
  return wroteAny;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Formato de mensajes inválido" });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUserMsg?.content || "";
  const hasImage = !!(lastUserMsg && lastUserMsg.image);

  const codeQuestion = !hasImage && isCodeQuestion(text);
  const complexQuestion = !hasImage && isComplexQuestion(text);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  const geminiContents = messages.map((m) => {
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    if (m.image && m.image.data && m.image.mimeType) {
      parts.push({ inline_data: { mime_type: m.image.mimeType, data: m.image.data } });
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: parts.length ? parts : [{ text: "" }],
    };
  });

  const openaiMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const attempts = [];

  if (hasImage) {
    if (process.env.GEMINI_API_KEY) {
      attempts.push(() => streamGemini("gemini-flash-lite-latest", process.env.GEMINI_API_KEY, geminiContents, res));
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res));
    }
  } else {
    if (codeQuestion) {
      if (process.env.DEEPSEEK_API_KEY) {
        attempts.push(() =>
          streamOpenAICompatible(
            "https://api.deepseek.com",
            process.env.DEEPSEEK_API_KEY,
            "deepseek-chat",
            openaiMessages,
            res
          )
        );
      }
      if (process.env.OPENROUTER_API_KEY) {
        attempts.push(() =>
          streamOpenAICompatible(
            "https://openrouter.ai/api/v1",
            process.env.OPENROUTER_API_KEY,
            "qwen/qwen3-coder:free",
            openaiMessages,
            res,
            { "HTTP-Referer": "https://zpit-app.vercel.app", "X-Title": "Zpit" }
          )
        );
      }
    }

    if (complexQuestion && process.env.GEMINI_API_KEY) {
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res));
    }

    if (process.env.GEMINI_API_KEY) {
      attempts.push(() => streamGemini("gemini-flash-lite-latest", process.env.GEMINI_API_KEY, geminiContents, res));
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res));
    }
  }

  let succeeded = false;
  for (const attempt of attempts) {
    try {
      const wrote = await attempt();
      if (wrote) {
        succeeded = true;
        break;
      }
    } catch (err) {
      console.error("Fallo un intento, probando el siguiente:", err.message);
    }
  }

  if (!succeeded) {
    res.write("No pude generar una respuesta en este momento. Intenta de nuevo en un momento.");
  }

  res.end();
        }
