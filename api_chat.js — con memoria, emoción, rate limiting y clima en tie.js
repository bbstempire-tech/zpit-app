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

// --- Memoria inteligente y estado emocional ---

function buildMemoryContext(memories) {
  if (!memories || !Array.isArray(memories) || memories.length === 0) return "";
  const safeMemories = memories
    .filter((m) => typeof m === "string")
    .slice(-15)
    .map((m) => m.slice(0, 300));
  if (safeMemories.length === 0) return "";
  const lines = safeMemories.map((m, i) => `${i + 1}. ${m}`);
  return (
    "\n\n---\nCosas que el usuario te ha compartido sobre sí mismo o su proyecto en conversaciones anteriores. " +
    "Úsalas como contexto de fondo cuando sean relevantes para la pregunta actual, sin repetirlas literalmente " +
    "ni forzarlas si no vienen al caso:\n\n" + lines.join("\n")
  );
}

function buildEmotionContext(emotion) {
  if (!emotion || typeof emotion !== "object") return "";
  const stress = Number(emotion.stress) || 0;
  const frustration = Number(emotion.frustration) || 0;
  const curious = Number(emotion.curious) || 0;

  let tone = "";
  if (frustration >= 55) {
    tone = "El usuario parece frustrado en este momento. Sé especialmente paciente, valida brevemente la molestia si aplica, ve directo a la solución y evita explicaciones innecesariamente largas.";
  } else if (stress >= 55) {
    tone = "El usuario parece estresado o con prisa. Sé conciso, prioriza lo accionable y evita rodeos.";
  } else if (curious >= 65) {
    tone = "El usuario está en modo exploratorio. Puedes profundizar un poco más de lo normal y ofrecer contexto adicional o conexiones interesantes.";
  }
  if (!tone) return "";
  return (
    "\n\n---\nEstado emocional detectado en el usuario (uso interno para ajustar tu tono, nunca lo menciones " +
    "explícitamente ni digas frases como 'noto que estás frustrado'): " + tone
  );
}

// --- Búsqueda real con Google Custom Search ---

async function googleSearch(query) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx || !query || !query.trim()) return [];

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&num=5&q=${encodeURIComponent(query)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      console.error("Error de Google CSE:", JSON.stringify(errData));
      return [];
    }
    const data = await r.json();
    const items = data.items || [];
    return items.map((it) => ({
      title: it.title || "",
      link: it.link || "",
      snippet: it.snippet || "",
    }));
  } catch (e) {
    console.error("Fallo la búsqueda en Google CSE:", e.message);
    return [];
  }
}

function shouldSearch(text, hasImage, codeQuestion, webSearchEnabled) {
  if (!webSearchEnabled) return false;
  if (hasImage) return false;
  if (codeQuestion) return false;
  if (!text || text.trim().length < 4) return false;
  return true;
}

function buildSearchContext(sources) {
  if (!sources.length) return "";
  const lines = sources.map(
    (s, i) => `${i + 1}. ${s.title}\n   ${s.snippet}\n   Fuente: ${s.link}`
  );
  return (
    "\n\n---\nResultados de una búsqueda web real hecha ahora mismo para la pregunta del usuario. " +
    "Úsalos para responder con información actual. Menciona de qué fuente sale cada dato relevante " +
    "(por nombre o dominio). NO inventes datos, enlaces ni fuentes que no aparezcan en esta lista. " +
    "Si esta información no es suficiente para responder con seguridad, dilo claramente:\n\n" +
    lines.join("\n\n")
  );
}

// --- NUEVO: Integración de API real — clima en tiempo real (Open-Meteo, sin API key) ---

function isWeatherQuestion(text) {
  const signals = [
    "clima", "temperatura", "va a llover", "pronóstico", "pronostico",
    "hace frío", "hace frio", "hace calor", "grados hace", "cuántos grados", "cuantos grados"
  ];
  const t = text.toLowerCase();
  return signals.some((s) => t.includes(s));
}

function extractCity(text) {
  const match = text.match(/(?:en|de)\s+([A-Za-zÀ-ÿ\u00f1\u00d1\s]{2,40})(?:[.?!,]|$)/i);
  if (!match) return null;
  const city = match[1].trim();
  if (city.length < 2 || city.length > 40) return null;
  return city;
}

async function getWeather(city) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`
    );
    if (!geoRes.ok) return null;
    const geoData = await geoRes.json();
    const loc = geoData.results && geoData.results[0];
    if (!loc) return null;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
    );
    if (!weatherRes.ok) return null;
    const weatherData = await weatherRes.json();
    if (!weatherData.current) return null;

    return {
      city: loc.name,
      country: loc.country || "",
      temp: weatherData.current.temperature_2m,
      humidity: weatherData.current.relative_humidity_2m,
      wind: weatherData.current.wind_speed_10m,
    };
  } catch (e) {
    console.error("Fallo la consulta del clima:", e.message);
    return null;
  }
}

function buildWeatherContext(weather) {
  if (!weather) return "";
  return (
    `\n\n---\nDatos meteorológicos reales obtenidos ahora mismo por API para ${weather.city}${weather.country ? ", " + weather.country : ""}: ` +
    `temperatura ${weather.temp}°C, humedad ${weather.humidity}%, viento ${weather.wind} km/h. ` +
    `Usa estos datos exactos si el usuario pregunta por el clima de ese lugar; no inventes cifras distintas.`
  );
}

// --- NUEVO: Rate limiting básico en memoria (protección contra abuso) ---

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitMap = new Map();

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  entry.count += 1;
  return true;
}

function cleanupRateLimitMap() {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 3) {
      rateLimitMap.delete(ip);
    }
  }
}

// --- NUEVO: Validación de entrada ---

const MAX_MESSAGES_IN_CONVO = 60;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024; // ~8MB en base64

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "La conversación está vacía o tiene un formato inválido.";
  }
  if (messages.length > MAX_MESSAGES_IN_CONVO) {
    return "Esta conversación es demasiado larga para procesarla de una vez.";
  }
  for (const m of messages) {
    if (!m || typeof m !== "object") return "Formato de mensaje inválido.";
    if (m.role !== "user" && m.role !== "assistant") return "Rol de mensaje inválido.";
    if (m.content !== undefined && typeof m.content !== "string") return "Contenido de mensaje inválido.";
    if (typeof m.content === "string" && m.content.length > MAX_MESSAGE_LENGTH) {
      return "Uno de los mensajes supera el largo máximo permitido.";
    }
    if (m.image) {
      if (typeof m.image.mimeType !== "string" || !m.image.mimeType.startsWith("image/")) {
        return "Tipo de imagen inválido.";
      }
      if (typeof m.image.data !== "string" || m.image.data.length > MAX_IMAGE_BASE64_LENGTH) {
        return "La imagen adjunta es demasiado grande o inválida.";
      }
    }
  }
  return null;
}

// --- Streaming para modelos estilo Gemini (soporta imágenes) ---

async function streamGemini(model, apiKey, contents, res, systemPrompt) {
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
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

async function streamOpenAICompatible(baseUrl, apiKey, model, chatMessages, res, systemPrompt, extraHeaders) {
  const apiRes = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
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

  // --- Rate limiting ---
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: "Demasiadas solicitudes en poco tiempo. Espera un momento antes de volver a intentar.",
    });
  }
  if (Math.random() < 0.05) cleanupRateLimitMap();

  const { messages, webSearchEnabled, memories, emotion } = req.body || {};

  // --- Validación de entrada ---
  const validationError = validateMessages(messages);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUserMsg?.content || "";
  const hasImage = !!(lastUserMsg && lastUserMsg.image);

  const codeQuestion = !hasImage && isCodeQuestion(text);
  const complexQuestion = !hasImage && isComplexQuestion(text);
  const weatherQuestion = !hasImage && isWeatherQuestion(text);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  let sources = [];
  if (shouldSearch(text, hasImage, codeQuestion, webSearchEnabled !== false)) {
    sources = await googleSearch(text);
  }

  if (sources.length > 0) {
    res.write("__SOURCES__" + JSON.stringify(sources) + "__ENDSOURCES__\n");
  }

  let weatherContext = "";
  if (weatherQuestion) {
    const city = extractCity(text);
    if (city) {
      const weather = await getWeather(city);
      weatherContext = buildWeatherContext(weather);
    }
  }

  const systemPromptFinal =
    SYSTEM_PROMPT +
    buildMemoryContext(memories) +
    buildEmotionContext(emotion) +
    weatherContext +
    buildSearchContext(sources);

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
      attempts.push(() => streamGemini("gemini-flash-lite-latest", process.env.GEMINI_API_KEY, geminiContents, res, systemPromptFinal));
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res, systemPromptFinal));
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
            res,
            systemPromptFinal
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
            systemPromptFinal,
            { "HTTP-Referer": "https://zpit-app.vercel.app", "X-Title": "Zpit" }
          )
        );
      }
    }

    if (complexQuestion && process.env.GEMINI_API_KEY) {
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res, systemPromptFinal));
    }

    if (process.env.GEMINI_API_KEY) {
      attempts.push(() => streamGemini("gemini-flash-lite-latest", process.env.GEMINI_API_KEY, geminiContents, res, systemPromptFinal));
      attempts.push(() => streamGemini("gemini-flash-latest", process.env.GEMINI_API_KEY, geminiContents, res, systemPromptFinal));
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