import express from "express";
// Correctly import the renamed controller function
import {
  handleContentGeneration,
  handleImageGeneration,
} from "../controllers/chatController.js";
// Correct the import to use the default export from the middleware
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

// This route now correctly uses the 'handleContentGeneration' function
router.post(
  "/generate-content",
  upload.single("file"),
  handleContentGeneration
);

// Route for generating images remains the same
router.post("/generate-image", handleImageGeneration);

export default router;
