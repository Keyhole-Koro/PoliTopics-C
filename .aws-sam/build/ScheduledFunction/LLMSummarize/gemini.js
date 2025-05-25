"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const generative_ai_1 = require("@google/generative-ai");
/**
 * Generates a summary from a given PDF file using Google Generative AI.
 *
 * @param apiKey - API key for the Google Generative AI.
 * @param promptText - Text prompt for the content generation.
 * @returns The generated summary as a promise that resolves to a string.
 */
async function geminiAPI(apiKey, promptText) {
    try {
        // Initialize Google Generative AI with your API key.
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        // Get the generative model.
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: { "responseMimeType": "application/json" }
        });
        // Generate content using the uploaded file URI and prompt text.
        const result = await model.generateContent([
            { text: promptText },
        ]);
        const textContent = result.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        // Return the generated response text.
        return textContent;
    }
    catch (error) {
        console.error("Error generating summary:", error);
        throw error;
    }
}
exports.default = geminiAPI;
