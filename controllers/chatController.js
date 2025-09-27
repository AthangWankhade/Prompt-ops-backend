import { startChatSession, sendMessage, generateImage } from '../services/geminiService.js';

/**
 * Controller to start a new chat session.
 */
export const handleStartSession = (req, res) => {
    try {
        const sessionId = startChatSession();
        res.status(200).json({
            message: "New chat session started successfully.",
            sessionId: sessionId
        });
    } catch (error) {
        console.error('Controller Error:', error.message);
        res.status(500).json({ error: 'Failed to start a new chat session.' });
    }
};

/**
 * Controller to handle sending a message within a specific chat session.
 */
export const handleSendMessage = async (req, res) => {
    try {
        const { file } = req;
        const { prompt, sessionId } = req.body;

        if (!prompt || !sessionId) {
            return res.status(400).json({ error: 'A prompt and a sessionId are required.' });
        }

        const structuredResult = await sendMessage(sessionId, prompt, file);

        res.status(200).json(structuredResult);

    } catch (error) {
        console.error('Controller Error:', error.message);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
};

/**
 * Controller to handle stateless image generation requests.
 */
export const handleImageGeneration = async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'A prompt is required to generate an image.' });
        }

        const imageBase64 = await generateImage(prompt);

        res.status(200).json({
            message: 'Image generated successfully.',
            imageData: imageBase64
        });

    } catch (error) {
        console.error('Controller Error:', error.message);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
};

