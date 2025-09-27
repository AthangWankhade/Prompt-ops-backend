import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import chatRoutes from "./routes/chatRoutes.js";

// --- Server Initialization ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- ES Module Fix for __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
app.use(express.json()); // To parse JSON bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies

// --- Routes ---
app.use("/api/chat", chatRoutes);

// --- Basic Welcome Route ---
app.get("/", (req, res) => {
  res
    .status(200)
    .send(
      "<h1>Gemini Chatbot Backend</h1><p>The server is running. Use the /api/chat endpoints to interact with the bot.</p>"
    );
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
