import { GoogleGenAI } from "@google/genai";
import fs from "fs";

// Manually parse .env file
function loadEnv() {
    try {
        const envContent = fs.readFileSync(".env", "utf8");
        const lines = envContent.split("\n");
        lines.forEach(line => {
            const [key, value] = line.split("=");
            if (key && value) {
                process.env[key.trim()] = value.trim();
            }
        });
    } catch (err) {
        console.error("Error reading .env file:", err);
    }
}

loadEnv();

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        console.error("Error: GEMINI_API_KEY or VITE_GEMINI_API_KEY not found in .env file.");
        return;
    }

    try {
        const client = new GoogleGenAI({ apiKey });
        // The @google/genai SDK might have a different method for listing models
        // Let's try to fetch them. If this method doesn't exist, we'll try fetch.
        console.log("Fetching models...");

        // Note: As of my latest training data, the SDK might not have a direct listModels method like the REST API
        // So I'll also provide a fetch-based fallback in case the SDK doesn't support it directly.

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("\nAvailable Models:");
            data.models.forEach(model => {
                console.log(`- ${model.name} (${model.displayName})`);
                console.log(`  Supported Methods: ${model.supportedGenerationMethods.join(", ")}`);
            });
        } else {
            console.log("No models found or error in response:", data);
        }
    } catch (error) {
        console.error("Error fetching models:", error);
    }
}

listModels();
