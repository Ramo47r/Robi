const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const app = express();

app.use(express.json());

// Bedient Dateien direkt aus dem Hauptverzeichnis (da jetzt alles flach liegt)
app.use(express.static(__dirname));[cite: 1, 2]

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, 
});

// Die Chat-Schnittstelle
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 1024,
      messages: [{ role: "user", content: message }],
    });
    res.json({ reply: response.content[0].text });
  } catch (error) {
    console.error("Fehler:", error);
    res.status(500).json({ error: error.message });
  }
}); // Hier war oft die Klammer vergessen worden!

// Route für die index.html im Hauptverzeichnis
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));[cite: 1, 2]
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
