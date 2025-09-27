import {
  generateImage,
  generateStructuredContent,
} from "../services/geminiService.js";

/**
 * Controller to handle all content generation requests (text or multimodal).
 * It calls the unified service function to get a structured JSON response.
 */
export const handleContentGeneration = async (req, res) => {
  try {
    const { file } = req;
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "A prompt is required." });
    }

    // Call the single, powerful service function for either text or file analysis.
    const structuredResult = await generateStructuredContent(prompt, file);

    res.status(200).json(structuredResult);
  } catch (error) {
    console.error("Controller Error:", error.message);
    res
      .status(500)
      .json({ error: error.message || "An internal server error occurred." });
  }
};

/**
 * Controller to handle image generation requests.
 */
export const handleImageGeneration = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res
        .status(400)
        .json({ error: "A prompt is required to generate an image." });
    }

    const imageBase64 = await generateImage(prompt);

    res.status(200).json({
      message: "Image generated successfully.",
      imageData: imageBase64,
    });
  } catch (error) {
    console.error("Controller Error:", error.message);
    res
      .status(500)
      .json({ error: error.message || "An internal server error occurred." });
  }
};
