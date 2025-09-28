import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import "dotenv/config";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// --- File Path Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Gemini API Initialization ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in the environment variables.");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- In-Memory Chat History Storage ---
const chatHistories = {};

// --- Helper Functions ---

/**
 * A robust retry mechanism with exponential backoff and jitter.
 */
async function withRetry(apiCallFn, maxRetries = 5, initialDelay = 2000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCallFn();
    } catch (error) {
      if (error.status === 429 || error.status === 503) {
        if (attempt === maxRetries - 1) {
          console.error(
            `API call failed after ${maxRetries} attempts. No more retries.`
          );
          throw error;
        }
        const delay =
          initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(
          `API Error (${error.status}). Retrying in ${Math.round(
            delay / 1000
          )}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Converts a local file to a GoogleGenerativeAI.Part object.
 */
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType,
    },
  };
}

// --- Schemas for Different Content Types ---

const WebSearchResultSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    url: { type: "STRING" },
    snippet: { type: "STRING" },
  },
  required: ["title", "url", "snippet"],
};

const PresentationSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    simulatedSources: { type: "ARRAY", items: WebSearchResultSchema },
    slides: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          slideNumber: { type: "INTEGER" },
          title: { type: "STRING" },
          content: { type: "ARRAY", items: { type: "STRING" } },
          speakerNotes: { type: "STRING" },
          slideCode: { type: "XML/HTML" },
        },
        required: ["slideNumber", "title", "content", "speakerNotes"],
      },
    },
  },
  required: ["title", "simulatedSources", "slides"],
};

const DocumentSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    simulatedSources: { type: "ARRAY", items: WebSearchResultSchema },
    summary: { type: "STRING" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          subtitle: { type: "STRING" },
          content: { type: "STRING" },
        },
        required: ["subtitle", "content"],
      },
    },
  },
  required: ["title", "simulatedSources", "summary", "sections"],
};

const GeneralContentSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    summary: { type: "STRING" },
    content: { type: "STRING" },
  },
  required: ["title", "summary", "content"],
};

/**
 * Detects the requested content type from the prompt using a priority system.
 */
function detectContentType(prompt) {
  const lowerCasePrompt = prompt.toLowerCase();
  const keywordPriority = [
    {
      name: "presentation",
      keywords: ["ppt", "presentation", "powerpoint", "slides"],
      priority: 1,
    },
    {
      name: "document",
      keywords: ["pdf", "docx", "document", "report"],
      priority: 2,
    },
  ];
  let bestMatch = { name: "default", priority: 99 };
  for (const type of keywordPriority) {
    for (const keyword of type.keywords) {
      if (
        lowerCasePrompt.includes(keyword) &&
        type.priority < bestMatch.priority
      ) {
        bestMatch = { name: type.name, priority: type.priority };
      }
    }
  }
  return bestMatch.name;
}

// --- Main Service Functions ---

/**
 * Starts a new chat session and returns a unique session ID.
 * @returns {string} The unique ID for the new chat session.
 */
export function startChatSession() {
  const sessionId = randomUUID();
  chatHistories[sessionId] = []; // Initialize an empty history
  console.log(`New chat session started: ${sessionId}`);
  return sessionId;
}

/**
 * Sends a message within a chat session and gets a structured response.
 * @param {string} sessionId - The ID of the current chat session.
 * @param {string} prompt - The user's text prompt.
 * @param {object} [file] - An optional file object from multer.
 * @returns {Promise<object>} A promise that resolves to the parsed JSON object from the AI.
 */
export async function sendMessage(sessionId, prompt, file) {
  if (!chatHistories[sessionId]) {
    throw new Error("Invalid session ID. Please start a new session.");
  }

  try {
    const history = chatHistories[sessionId];
    const contentType = detectContentType(prompt);
    let schema;
    let systemInstruction;
    const model = "gemini-2.5-pro";

    // --- Determine Schema and System Instruction ---
    switch (contentType) {
      case "presentation":
        schema = PresentationSchema;
        systemInstruction =
          "You are a research assistant creating a presentation. First, Gather sources by finding 3-5 relevant web sources. Then, use that synthesized information to generate a comprehensive slide deck, adhering strictly to the provided JSON schema. Provide HTML in the last feild for each slide that can be used to create presentation slides.";
        break;
      case "document":
        schema = DocumentSchema;
        systemInstruction =
          "You are a professional writer creating a formal document. First, simulate a web search by generating 3-5 relevant sources. Then, based on that simulated research, write a comprehensive document, adhering strictly to the provided JSON schema.";
        break;
      default:
        schema = GeneralContentSchema;
        systemInstruction =
          "You are a helpful AI assistant. Generate a long-form, comprehensive response with a title, summary, and content, adhering strictly to the provided JSON schema.";
        break;
    }

    // --- Construct the new user message ---
    const userMessage = { role: "user", parts: [{ text: prompt }] };

    if (file) {
      const tempDir = join(__dirname, "..", "uploads");
      const tempFilePath = join(tempDir, file.filename);
      if (!fs.existsSync(tempFilePath)) {
        throw new Error(`File not found: ${tempFilePath}`);
      }
      userMessage.parts.push(fileToGenerativePart(tempFilePath, file.mimetype));
      fs.unlinkSync(tempFilePath);
    }

    // Add the new user message to the session's history
    history.push(userMessage);

    // --- Make the API call with the entire history ---
    const result = await withRetry(() =>
      ai.models.generateContent({
        model: model,
        contents: history, // Send the full conversation history
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      })
    );

    const modelResponseJson = JSON.parse(result.text);

    // Add the model's response to the history for future context
    history.push({ role: "model", parts: [{ text: result.text }] });

    return modelResponseJson;
  } catch (error) {
    console.error(`Error in session ${sessionId}:`, error);
    throw new Error("Failed to get a structured response from the AI model.");
  }
}

/**
 * Generates an image using the Gemini model. (Stateless)
 */
export async function generateImage(prompt) {
  try {
    const model = "gemini-2.5-flash-image-preview";

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["IMAGE"],
        },
      })
    );

    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData
    );

    if (imagePart && imagePart.inlineData.data) {
      return imagePart.inlineData.data;
    } else {
      throw new Error("The AI model did not return a valid image.");
    }
  } catch (error) {
    console.error("Error in Gemini Image API call:", error);
    throw new Error("Failed to generate image from the AI model.");
  }
}
