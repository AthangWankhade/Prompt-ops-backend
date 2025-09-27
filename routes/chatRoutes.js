import express from "express";
import {
  handleImageGeneration,
  handleSendMessage,
  handleStartSession,
} from "../controllers/chatController.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

// Route to start a new chat session and get a session ID
router.post("/start-session", handleStartSession);

// Route to send a message within a session. The session ID must be provided.
router.post("/send-message", upload.single("file"), handleSendMessage);

// Route for generating images (remains stateless)
router.post("/generate-image", handleImageGeneration);

export default router;
