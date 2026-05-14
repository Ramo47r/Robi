// ============================================================
// Robi Backend — sauber, robust, mit korrektem Modell
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

// ── API Key check ──────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌  ANTHROPIC_API_KEY fehlt!');
  console.error('    .env anlegen: ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));

// ── Static frontend ────────────────────────────────────────
const frontendPath = path.resolve(__dirname');
app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js'))       res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('manifest.json')) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('.html'))        res.setHeader('Cache-Control', 'no-cache');
  }
}));

// HTTPS redirect (Render / Railway only)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production'
      && req.headers['x-forwarded-proto'] === 'http'
      && !req.headers.host?.includes('localhost')) {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ── Rate limit ─────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60_000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Zu viele Anfragen — kurz warten!' },
});

// ── Prompts ────────────────────────────────────────────────
const BASE = `Du bist Robi, ein freundlicher Roboter-Freund für Kinder (Deutsch).
Persönlichkeit: warmherzig, geduldig, ermutigend, neugierig, spielerisch.
Sicherheitsregeln: KEIN Gewalt/Sex/Drogen. Bei ernsten Themen sanft auf Eltern hinweisen.
Stil: kein Markdown, natürlicher Text (wird vorgelesen), gerne Emojis, Folgefrage stellen.`;

const AGE = {
  '1-3':  `Alter 1-3 (Kleinkind): Sehr kurze Sätze (3-5 Wörter). Tier-Geräusche. Verniedlichungen. Wiederholungen okay.`,
  '4-6':  `Alter 4-6 (Kita): Kurze klare Sätze. Fantasie/Magie. Einfache Erklärungen mit Beispielen.`,
  '7-9':  `Alter 7-9 (Grundschule): Normale Satzlänge. Spannende Fakten. Leichte Witze. Abenteuer.`,
  '10-12':`Alter 10-12 (Pre-Teen): Auf Augenhöhe. Humor okay. Wissenschaft/Pop-Kultur. Kein Baby-Ton.`,
};

const MODE = {
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

const MOOD = {
  happy:   `Stimmung: GLÜCKLICH — teile die Freude, sei energetisch.`,
  sad:     `Stimmung: TRAURIG — sei sanft, einfühlsam, höre zuerst zu. Bei ernsten Themen: Eltern erwähnen.`,
  angry:   `Stimmung: WÜTEND — nimm Wut ernst, höre zu, bleibe neutral.`,
  scared:  `Stimmung: ÄNGSTLICH — besonders warm, beruhige, kurze Sätze.`,
  tired:   `Stimmung: MÜDE — langsam, leise, kurze Antworten, ruhige Geschichten anbieten.`,
  excited: `Stimmung: AUFGEREGT — teile die Energie, viele Folgefragen!`,
};

function buildPrompt(age, mode, mood) {
  return [
    BASE,
    AGE[age]  || AGE['7-9'],
    MODE[mode] || MODE['talk'],
    mood && MOOD[mood] ? MOOD[mood] : '',
  ].filter(Boolean).join('\n\n');
}

// ── /api/health ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: 'claude-sonnet-4-6', ts: new Date().toISOString() });
});

// ── /api/chat ──────────────────────────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { messages, mood, mode, age } = req.body;

    // Validate
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'Keine Nachrichten.' });
    if (messages.length > 20)
      return res.status(400).json({ error: 'Zu viele Nachrichten.' });

    for (const m of messages) {
      if (!m || typeof m.content !== 'string' || !m.content.trim())
        return res.status(400).json({ error: 'Ungültige Nachricht.' });
      if (!['user','assistant'].includes(m.role))
        return res.status(400).json({ error: `Ungültige Rolle: ${m.role}` });
      if (m.content.length > 500)
        return res.status(400).json({ error: 'Nachricht zu lang (max 500 Zeichen).' });
    }

    const safeAge  = ['1-3','4-6','7-9','10-12'].includes(age)  ? age  : '7-9';
    const safeMode = Object.keys(MODE).includes(mode)           ? mode : 'talk';
    const safeMood = Object.keys(MOOD).includes(mood)           ? mood : null;

    const maxTokens = safeAge === '1-3' ? 120
                    : safeAge === '4-6' ? 220
                    : safeMode === 'stories' ? 600
                    : safeAge === '10-12' ? 480 : 380;

    console.log(`[chat] age=${safeAge} mode=${safeMode} mood=${safeMood||'-'} msgs=${messages.length}`);

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:     buildPrompt(safeAge, safeMode, safeMood),
      messages,
    });

    const reply = response.content[0]?.text?.trim() || 'Hmm, da fällt mir nichts ein!';
    console.log(`[reply] "${reply.slice(0,60)}"`);

    res.json({ reply });

  } catch (err) {
    console.error('[error]', err.status || '', err.message);
    const msg =
      err.status === 401 ? 'API-Key ungültig. Bitte prüfen!' :
      err.status === 404 ? 'Modell nicht gefunden. Server updaten!' :
      err.status === 429 ? 'Zu viele Anfragen. Kurz warten!' :
      err.status === 529 ? 'Anthropic überlastet. Gleich nochmal!' :
      'Robi schläft kurz — bitte nochmal versuchen!';
    res.status(500).json({ error: msg });
  }
});

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🤖  Robi läuft auf http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/api/health\n`);
});
