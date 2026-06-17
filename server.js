// ============================================================
// Robi Backend — Google Gemini Version (Kostenlos & Stabil)
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai'; // Das offizielle, aktuelle Google SDK
import OpenAI from 'openai'; // ✅ HIER OBEN KORREKT EINGEFÜGT
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 10000; 

// ── API Key check ───────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('\n❌  GEMINI_API_KEY fehlt in den Render-Einstellungen!');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) { // ✅ NEUER CHECK FÜR AUDIO
  console.error('\n❌  OPENAI_API_KEY fehlt!');
  process.exit(1);
}

// Initialisierung der SDKs
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // ✅ HIER INITIALISIERT

// ── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));

// ── Statische Dateien (Frontend) ───────────────────────────
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// HTTPS Umleitung
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http' && !req.headers.host?.includes('localhost')) {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ── Rate Limit (Spam-Schutz) ────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60_000, 
  max: 45, // Gemini erlaubt mehr Anfragen im Free-Tier
  standardHeaders: true, 
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen — kurz warten!' },
});

// ── Prompts & Konfiguration ────────────────────────────────
const BASE_PROMPT = `Du bist Robi, ein freundlicher Roboter-Freund für Kinder (Deutsch).
Persönlichkeit: warmherzig, geduldig, ermutigend, neugierig, spielerisch.
Sicherheitsregeln: KEIN Gewalt/Sex/Drogen. Bei ernsten Themen sanft auf Eltern hinweisen.
Stil: kein Markdown, natürlicher Text (wird vorgelesen), gerne Emojis, Folgefrage stellen.`;

const AGE_PROMPTS = {
  '1-3':  `Alter 1-3 (Kleinkind): Sehr kurze Sätze (3-5 Wörter). Tier-Geräusche. Verniedlichungen. Wiederholungen okay.`,
  '4-6':  `Alter 4-6 (Kita): Kurze klare Sätze. Fantasie/Magie. Einfache Erklärungen mit Beispielen.`,
  '7-9':  `Alter 7-9 (Grundschule): Normale Satzlänge. Spannende Fakten. Leichte Witze. Abenteuer.`,
  '10-12':`Alter 10-12 (Pre-Teen): Auf Augenhöhe. Humor okay. Wissenschaft/Pop-Kultur. Kein Baby-Ton.`,
};

const MODE_PROMPTS = {
  talk:     `Modus: Frei reden — sei ein guter Freund, beantworte alles kindgerecht, stelle Folgefragen.`,
  homework: `Modus: Hausaufgaben — erkläre Schritt für Schritt, verrate NIE einfach die Antwort, frage was das Kind schon weiß.`,
  stories:  `Modus: Geschichten — erfinde eine kurze spannende Geschichte zum genannten Thema. Klarer Anfang/Mitte/Ende.`,
  learn:    `Modus: Lernen/Quiz — mache es spielerisch, lobe richtige Antworten, erkläre kurz und spannend.`,
  jokes:    `Modus: Witze & Rätsel — kindgerechter Humor, gib Tipps bei Rätseln, lache mit.`,
  creative: `Modus: Kreativ — erfinde zusammen mit dem Kind, sei Sidekick nicht Lehrer, ermutige stark.`,
  guess:    `Modus: Ratespiel — denke dir etwas aus, gib Hinweise, lobe alle Versuche.`,
  iSpy:     `Modus: Ich sehe was — erfinde eine Szene, lass das Kind raten, gib Hinweise.`,
  wouldYou: `Modus: Würdest du eher? — stelle eine Frage mit 2 Optionen, frage nach dem Warum.`,
};

// ── /api/health (Für den Systemtest) ───────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: 'google', model: 'gemini-2.5-flash', ts: new Date().toISOString() });
});

// ── /api/chat (Haupt-Schnittstelle) ────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { messages, mode, age } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Keine Nachrichten empfangen.' });
    }

    const safeAge  = ['1-3','4-6','7-9','10-12'].includes(age) ? age : '7-9';
    const safeMode = Object.keys(MODE_PROMPTS).includes(mode)  ? mode : 'talk';

    // Wir bauen den System-Prompt zusammen
    const systemInstruction = `${BASE_PROMPT}\n\n${AGE_PROMPTS[safeAge]}\n\n${MODE_PROMPTS[safeMode]}`;

    // Gemini erwartet eine flache Struktur für den Verlauf. 
    // Das SDK übersetzt die Rollen 'user' und 'assistant' automatisch.
    const chatContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    console.log(`[Gemini Chat] Modus: ${safeMode} | Alter: ${safeAge}`);

    // API-Aufruf an Google Gemini
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatContents,
      config: {
        systemInstruction: systemInstruction,
        maxOutputTokens: safeMode === 'stories' ? 600 : 350,
        temperature: 0.7,
      }
    });

    const reply = response.text?.trim() || 'Hmm, da hat meine Schaltung gewackelt. Frag mich nochmal!';
    res.json({ reply });

  } catch (err) {
    console.error('[Gemini Fehler]:', err);
    res.status(500).json({ 
      error: `Gemini-Verbindungsfehler: ${err.message || 'Bitte versuche es gleich noch einmal!'}` 
    });
  }
});

// ── /api/speech (Neue Route für Sprachausgabe) ─────────────
app.post('/api/speech', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Kein Text übermittelt" });
  }

  try {
    // OpenAI TTS API aufrufen
    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",       // WICHTIG: "tts-1" ist für extrem schnelles Streaming
      voice: "alloy",       // "alloy" ist neutral
      input: text,
      response_format: "mp3"
    });

    // Wir sagen der App: "Achtung, jetzt kommt fließendes Audio!"
    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked'
    });

    // Wandelt den OpenAI-Stream in einen Buffer um und sendet ihn ans Handy
    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    res.send(buffer);

  } catch (error) {
    console.error("Fehler bei OpenAI TTS:", error);
    res.status(500).json({ error: "Audio konnte nicht generiert werden" });
  }
});

// ── Fallback für die App (✅ WICHTIG: HIER GANZ UNTEN!) ─────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Starten
app.listen(PORT, () => {
  console.log(`\n🤖 Robi läuft stabil mit Google Gemini & OpenAI TTS auf Port ${PORT}\n`);
});
