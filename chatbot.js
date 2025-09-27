import { GoogleGenAI } from "@google/genai";
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

// --- Helper Functions ---

/**
 * A robust retry mechanism with exponential backoff and jitter.
 */
async function withRetry(apiCallFn, maxRetries = 5, initialDelay = 2000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCallFn();
    } catch (error) {
      if (error.status === 429) {
        if (attempt === maxRetries - 1) {
          console.error(`API call failed after ${maxRetries} attempts.`);
          throw error;
        }
        const delay =
          initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(
          `Rate limit exceeded. Retrying in ${Math.round(delay / 1000)}s...`
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

const DefaultSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    summary: { type: "STRING" },
    content: { type: "STRING" },
  },
  required: ["title", "summary", "content"],
};

const LessonPlanSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    gradeLevel: { type: "STRING" },
    duration: { type: "STRING" },
    learningObjectives: { type: "ARRAY", items: { type: "STRING" } },
    keyTerms: { type: "ARRAY", items: { type: "STRING" } },
    hookIntroduction: { type: "STRING" },
    mainActivity: { type: "STRING" },
    assessment: { type: "STRING" },
  },
  required: [
    "title",
    "gradeLevel",
    "duration",
    "learningObjectives",
    "keyTerms",
    "hookIntroduction",
    "mainActivity",
    "assessment",
  ],
};

const AssignmentSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    instructions: { type: "STRING" },
    submissionCriteria: { type: "STRING" },
    rubric: { type: "STRING", description: "A summary of the grading rubric." },
  },
  required: ["title", "instructions", "submissionCriteria", "rubric"],
};

const QuizSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          questionNumber: { type: "INTEGER" },
          question: { type: "STRING" },
          choices: { type: "ARRAY", items: { type: "STRING" } },
          correctAnswer: { type: "STRING" },
        },
        required: ["questionNumber", "question", "choices", "correctAnswer"],
      },
    },
  },
  required: ["title", "questions"],
};

const LectureSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    duration: { type: "STRING" },
    keyConcepts: { type: "ARRAY", items: { type: "STRING" } },
    script: {
      type: "STRING",
      description:
        "A detailed, long-form lecture script formatted with markdown.",
    },
  },
  required: ["title", "duration", "keyConcepts", "script"],
};

/**
 * Detects the requested content type from the prompt.
 * @param {string} prompt - The user's prompt.
 * @returns {string} The detected content type ('lessonPlan', 'quiz', etc.).
 */
function detectContentType(prompt) {
  const lowerCasePrompt = prompt.toLowerCase();
  if (lowerCasePrompt.includes("lesson plan")) return "lessonPlan";
  if (lowerCasePrompt.includes("assignment")) return "assignment";
  if (lowerCasePrompt.includes("quiz") || lowerCasePrompt.includes("quizzes"))
    return "quiz";
  if (lowerCasePrompt.includes("lecture")) return "lecture";
  return "default";
}

// --- Main Service Functions ---

/**
 * Generates structured content dynamically based on the prompt.
 */
export async function generateStructuredContent(prompt, file) {
  try {
    const contentType = detectContentType(prompt);
    let schema;
    let systemInstruction;

    switch (contentType) {
      case "lessonPlan":
        schema = LessonPlanSchema;
        systemInstruction =
          "You are an expert curriculum designer. Generate a detailed lesson plan based on the user's prompt, adhering strictly to the provided JSON schema.";
        break;
      case "assignment":
        schema = AssignmentSchema;
        systemInstruction =
          "You are an educator creating a student assignment. Generate clear instructions and criteria, adhering strictly to the provided JSON schema.";
        break;
      case "quiz":
        const match = prompt.match(/(\d+)\s*question/i);
        const questionCount = match ? parseInt(match[1]) : 20;
        schema = QuizSchema;
        systemInstruction = `You are a test creator. Generate a quiz with exactly ${questionCount} questions based on the user's prompt, adhering strictly to the provided JSON schema.`;
        break;
      case "lecture":
        schema = LectureSchema;
        systemInstruction =
          "You are a university professor preparing a lecture. Generate a detailed, time-appropriate lecture script, adhering strictly to the provided JSON schema.";
        break;
      default:
        schema = DefaultSchema;
        systemInstruction =
          "You are a helpful AI assistant. Generate a response with a title, summary, and content, adhering strictly to the provided JSON schema.";
        break;
    }

    let contents = [{ role: "user", parts: [{ text: prompt }] }];

    if (file) {
      const tempDir = join(__dirname, "..", "uploads");
      const tempFilePath = join(tempDir, file.filename);
      if (!fs.existsSync(tempFilePath)) {
        throw new Error(`File not found: ${tempFilePath}`);
      }
      contents[0].parts.push(fileToGenerativePart(tempFilePath, file.mimetype));
      fs.unlinkSync(tempFilePath);
    }

    const result = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.7,
        },
      })
    );

    return JSON.parse(result.text);
  } catch (error) {
    console.error("Error in Gemini Content Generation call:", error);
    throw new Error(
      "Failed to generate a structured response from the AI model."
    );
  }
}

/**
 * Generates an image using the gemini-2.5-flash-image-preview model.
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
