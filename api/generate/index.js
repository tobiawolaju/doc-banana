import { GoogleGenAI, Modality } from "@google/genai";

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { originalImageBase64, compositeImageBase64, highlights, mimeType = 'image/png' } = req.body;

    if (!originalImageBase64 || !compositeImageBase64 || !highlights) {
        return res.status(400).json({ error: 'Missing required parameters: originalImageBase64, compositeImageBase64, or highlights' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    }

    try {
        const genAI = new GoogleGenAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" }); // Using a stable version, or keep as per App.tsx if preferred

        const textPrompt = `You are a visual document editor. You will be given an original image, a second image showing highlighted regions, and a set of instructions corresponding to each highlighted region. Your task is to apply the instructions to the original image and return the edited image. The final image must retain the original's style and quality.

Here are the instructions for the edits:
${highlights.map((h, i) => `For the region highlighted in ${h.color} (Highlight #${i + 1}): "${h.prompt}"`).join('\n')}`;

        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: textPrompt },
                    { inlineData: { mimeType: mimeType, data: originalImageBase64 } },
                    { inlineData: { mimeType: 'image/png', data: compositeImageBase64 } }
                ]
            }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
            }
        });

        const response = await result.response;
        const imagePart = response.candidates?.[0]?.content.parts.find(part => part.inlineData);

        if (imagePart && imagePart.inlineData) {
            return res.status(200).json({
                success: true,
                image: imagePart.inlineData.data
            });
        } else {
            const textResponse = response.text() || "No image was generated. The model may have refused the request.";
            return res.status(500).json({ error: `Failed to generate document. Response: ${textResponse}` });
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
}
