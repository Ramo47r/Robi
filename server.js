// ============================================================
// Robi Backend — Google Gemini (Chat) & ElevenLabs (Premium Stimme)
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();

// Port nur ein einziges Mal definieren
const PORT = process.env.PORT || 10000; 

// ── API Key Checks ─────────────────────────────────────────
if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
  console.error('\n❌ FEHLER: GEMINI_API_KEY oder ELEVENLABS_API_KEY fehlt in Render!');
}

// ── Initialisierung der KI (Nur noch Gemini) ────────────────
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── Rate Limit (Spam-Schutz) ───────────────
const chatLimiter = rateLimit({
  windowMs: 60_000, 
  max: 45, 
  message: { error: 'Zu viele Anfragen — kurz warten!' },
});

// ── Prompts ────────────────────────────────────────────────
const BASE_PROMPT = `Du bist Robi, ein freundlicher Roboter-Freund für Kinder (Deutsch).
Persönlichkeit: warmherzig, geduldig, ermutigend, neugierig, spielerisch.
Sicherheitsregeln: KEIN Gewalt/Sex/Drogen. Bei ernsten Themen sanft auf Eltern hinweisen.
Stil: kein Markdown, natürlicher Text (wird vorgelesen), Folgefrage stellen.`;

const AGE_PROMPTS = {
  '1-3':  `Alter 1-3 (Kleinkind): Sehr kurze Sätze (3-5 Wörter).`,
  '4-6':  `Alter 4-6 (Kita): Kurze klare Sätze. Fantasie/Magie.`,
  '7-9':  `Alter 7-9 (Grundschule): Normale Satzlänge. Spannende Fakten.`,
  '10-12':`Alter 10-12 (Pre-Teen): Auf Augenhöhe. Humor okay.`
};

// ── /api/chat (Text-Generierung via Google Gemini) ─────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { messages, age, mode } = req.body;
    if (!messages || messages.length === 0) return res.status(400).json({ error: 'Keine Nachrichten.' });

    const safeAge = ['1-3','4-6','7-9','10-12'].includes(age) ? age : '7-9';
    const systemInstruction = `${BASE_PROMPT}\n\n${AGE_PROMPTS[safeAge]}`;

    const chatContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatContents,
      config: { systemInstruction: systemInstruction, temperature: 0.7 }
    });

    res.json({ reply: response.text?.trim() || 'Hmm, da hat meine Schaltung gewackelt.' });
  } catch (err) {
    console.error('[Gemini Fehler]:', err);
    res.status(500).json({ error: 'Verbindungsfehler' });
  }
});

// ── /api/speech (Audio-Generierung via ElevenLabs) ─────────
app.post('/api/speech', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Kein Text gesendet" });

    const apiKey = process.env.ELEVENLABS_API_KEY; 
    
    // HIER KANNST DU DIE STIMME ÄNDERN (Aktuell: Charlie)
    const voiceId = 'JBFqnCBsd6RMkjVDRZzb'; 

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_multilingual_v2", 
        voice_settings: {
          stability: 0.85, // Verhindert das Flüstern im Hintergrund
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      throw new Error("Fehler bei ElevenLabs API");
    }

    const arrayBuffer = await response.arrayBuffer();
    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(Buffer.from(arrayBuffer));

  } catch (error) {
    console.error("Audio-Server Fehler:", error);
    res.status(500).json({ error: "Konnte Audio nicht generieren" });
  }
});

// Fallback Route für die HTML-Datei (Muss GANZ unten stehen!)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Server Start ───────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 Robi Server ist wach und lauscht auf Port ${PORT}\n`);
});
