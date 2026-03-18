// =====================================================
// server.js — نقطة البداية (الملف الرئيسي)
// =====================================================
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

// منع الكراش من أي خطأ غير متوقع
process.on('uncaughtException',  (err)    => console.error('Uncaught Exception:',  err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

// ── إعداد السيرفر ──
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ── استيراد الوحدات ──
const { db, playersDB, saveDB, getPlayerBadge, registerRoutes, ANSWERS_PER_LEVEL, MAX_LEVEL } = require('./db');
const { generateQuestionsAI } = require('./questions');
const { registerSocketEvents } = require('./gameLogic');

// ── تسجيل Routes ──
registerRoutes(app);

// ── تسجيل Socket Events ──
registerSocketEvents(io, db, playersDB, saveDB, getPlayerBadge, generateQuestionsAI, ANSWERS_PER_LEVEL, MAX_LEVEL);

// ── تشغيل السيرفر ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});