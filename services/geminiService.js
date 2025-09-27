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
 * This function will now retry on both 429 (Too Many Requests) and 503 (Service Unavailable) errors.
 */
async function withRetry(apiCallFn, maxRetries = 5, initialDelay = 2000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiCallFn();
    } catch (error) {
      // Check if the error is a rate limit (429) or a temporary server error (503).
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
        // For any other error, throw it immediately.
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
    title: {
      type: "STRING",
      description: "A comprehensive and descriptive title for the content.",
    },
    summary: {
      type: "STRING",
      description: "A detailed summary of the key points.",
    },
    content: {
      type: "STRING",
      description:
        "A long-form, detailed, and comprehensive body of text, formatted with markdown for readability.",
    },
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
    hookIntroduction: {
      type: "STRING",
      description:
        "A detailed and engaging opening to capture student interest.",
    },
    mainActivity: {
      type: "STRING",
      description:
        "A comprehensive description of the main learning activity, such as a lecture, project, or discussion.",
    },
    assessment: {
      type: "STRING",
      description: "A detailed description of the assessment method.",
    },
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
    instructions: {
      type: "STRING",
      description:
        "A long-form, step-by-step set of instructions for the assignment.",
    },
    submissionCriteria: {
      type: "STRING",
      description: "A detailed list of all submission requirements.",
    },
    rubric: {
      type: "STRING",
      description:
        "A comprehensive grading rubric, detailing all criteria for success.",
    },
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
        "A detailed, comprehensive, long-form lecture script formatted with markdown, suitable for the specified duration.",
    },
  },
  required: ["title", "duration", "keyConcepts", "script"],
};

/**
 * Detects the requested content type from the prompt using a priority system.
 * @param {string} prompt - The user's prompt.
 * @returns {string} The detected content type with the highest priority.
 */
function detectContentType(prompt) {
  const lowerCasePrompt = prompt.toLowerCase();

  // Keywords are ordered by priority (lower number is higher priority)
  const keywordPriority = [
    { name: "lessonPlan", keywords: ["lesson plan"], priority: 1 },
    { name: "assignment", keywords: ["assignment"], priority: 2 },
    { name: "quiz", keywords: ["quiz", "quizzes"], priority: 2 },
    { name: "lecture", keywords: ["lecture"], priority: 3 },
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
 * Generates structured content dynamically based on the prompt.
 */
export async function generateStructuredContent(prompt, file) {
  try {
    const contentType = detectContentType(prompt);
    let schema;
    let systemInstruction;

    // Use gemini-2.5-pro for longer, more detailed content
    const model = "gemini-2.5-pro";

    switch (contentType) {
      case "lessonPlan":
        schema = LessonPlanSchema;
        systemInstruction =
          "You are an expert curriculum designer. Generate a comprehensive, long-form, and detailed lesson plan based on the user's prompt, adhering strictly to the provided JSON schema. Ensure all fields contain thorough information.";
        break;
      case "assignment":
        schema = AssignmentSchema;
        systemInstruction =
          "You are an educator creating a detailed student assignment. Generate long-form, comprehensive instructions and criteria, adhering strictly to the provided JSON schema.";
        break;
      case "quiz":
        const match = prompt.match(/(\d+)\s*question/i);
        const questionCount = match ? parseInt(match[1]) : 20;
        schema = QuizSchema;
        systemInstruction = `You are a test creator. Generate a comprehensive quiz with exactly ${questionCount} questions based on the user's prompt, adhering strictly to the provided JSON schema.`;
        break;
      case "lecture":
        schema = LectureSchema;
        systemInstruction =
          "You are a university professor preparing a lecture. Generate a detailed, comprehensive, and long-form lecture script suitable for the requested time span, adhering strictly to the provided JSON schema.";
        break;
      default:
        schema = DefaultSchema;
        systemInstruction =
          "You are a helpful AI assistant. Generate a long-form, comprehensive, and detailed response with a title, summary, and content, adhering strictly to the provided JSON schema.";
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
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: schema,
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
