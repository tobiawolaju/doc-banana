import React, { useState, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import P5Canvas from './components/P5Canvas';

// TypeScript declaration for the PDF.js global library from CDN
declare const pdfjsLib: any;

interface Highlight {
  id: number;
  color: string;
  prompt: string;
}

// Function to generate a random, visually pleasing color in HSL format
const generateRandomColor = (): string => {
    const hue = Math.floor(Math.random() * 360);
    const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
    const lightness = Math.floor(Math.random() * 20) + 50;  // 50-70%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Helper to convert blob URLs to base64
const blobUrlToBase64 = (blobUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        fetch(blobUrl)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (typeof reader.result === 'string') {
                        // result includes 'data:image/png;base64,' prefix, remove it for the API
                        resolve(reader.result.split(',')[1]);
                    } else {
                        reject(new Error("Failed to read blob as a string"));
                    }
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }).catch(reject);
    });
};


function App() {
  const [docImgUrl, setDocImgUrl] = useState<string | null>(null);
  const [highlighting, setHighlighting] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [currentColor, setCurrentColor] = useState<string>('#FFFF00'); // Default yellow
  
  // State for AI generation
  const [generationTrigger, setGenerationTrigger] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null); // Kept for the right panel temporarily
  const [error, setError] = useState<string | null>(null);

  
  const toggleHighlighting = useCallback(() => {
      setHighlighting(prev => {
          const isEnteringHighlightMode = !prev;
          if (isEnteringHighlightMode) {
              let newColor;
              const existingColors = new Set(highlights.map(h => h.color));
              do {
                  newColor = generateRandomColor();
              } while (existingColors.has(newColor));

              setCurrentColor(newColor);
              setHighlights(current => [
                  ...current,
                  { id: Date.now(), color: newColor, prompt: '' }
              ]);
          }
          return !prev;
      });
  }, [highlights]);

  const handlePromptChange = (id: number, newPrompt: string) => {
    setHighlights(current => 
        current.map(h => h.id === id ? { ...h, prompt: newPrompt } : h)
    );
  };

  const handleTryAgain = () => {
    setHighlights([]);
    setGeneratedImageUrl(null);
    setError(null);
    setHighlighting(false);
    // This will trigger canvas clear if a doc is present
    if (docImgUrl) {
      setDocImgUrl(null); 
    }
  };

  const handleSendToGenerate = () => {
    if (!docImgUrl) return;
    setError(null);
    setGeneratedImageUrl(null);
    setIsGenerating(true);
    setGenerationTrigger(true); // Signal P5Canvas to create the composite image
  };
  
  const onGenerationTriggerConsumed = useCallback(() => {
      setGenerationTrigger(false);
  }, []);

  const onCompositeImageReady = useCallback(async (compositeImageBase64: string) => {
    if (!docImgUrl) {
        setError("Original document is missing.");
        setIsGenerating(false);
        return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

        const originalImageBase64 = docImgUrl.startsWith('data:')
            ? docImgUrl.split(',')[1]
            : await blobUrlToBase64(docImgUrl);
            
        const textPrompt = `You are a visual document editor. You will be given an original image, a second image showing highlighted regions, and a set of instructions corresponding to each highlighted region. Your task is to apply the instructions to the original image and return the edited image. The final image must retain the original's style and quality.

Here are the instructions for the edits:
${highlights.map((h, i) => `For the region highlighted in ${h.color} (Highlight #${i + 1}): "${h.prompt}"`).join('\n')}`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: [
                    { text: textPrompt },
                    { inlineData: { mimeType: 'image/png', data: originalImageBase64 } },
                    { inlineData: { mimeType: 'image/png', data: compositeImageBase64 } }
                ]
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        const imagePart = response.candidates?.[0]?.content.parts.find(part => part.inlineData);

        if (imagePart && imagePart.inlineData) {
            const newImageUrl = `data:image/png;base64,${imagePart.inlineData.data}`;
            // Replace the main document with the generated one and reset state
            setHighlights([]);
            setGeneratedImageUrl(null);
            setError(null);
            setHighlighting(false);
            setDocImgUrl(newImageUrl);
        } else {
            const textResponse = response.text || "No image was generated. The model may have refused the request.";
            setError(`Failed to generate document. Response: ${textResponse}`);
        }

    } catch (e: any) {
        console.error(e);
        setError(`An error occurred: ${e.message}`);
    } finally {
        setIsGenerating(false);
    }

  }, [docImgUrl, highlights]);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        toggleHighlighting();
      } else if (highlighting) {
          if (key === '+' || key === '=') {
              setBrushSize(prev => Math.min(prev + 5, 150));
          } else if (key === '-') {
              setBrushSize(prev => Math.max(prev - 5, 5));
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleHighlighting, highlighting]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (docImgUrl && docImgUrl.startsWith('blob:')) {
      URL.revokeObjectURL(docImgUrl);
    }
    
    // Reset highlights and other states for the new file
    setHighlights([]);
    setGeneratedImageUrl(null);
    setError(null);
    setHighlighting(false);

    if (file.type === 'application/pdf') {
        const url = URL.createObjectURL(file);
        try {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
            const pdf = await pdfjsLib.getDocument(url).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) throw new Error("Could not get canvas context");
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport }).promise;
            setDocImgUrl(canvas.toDataURL());
        } catch (error) {
            console.error('Error processing PDF:', error);
            alert("Could not load PDF file.");
        } finally {
            URL.revokeObjectURL(url);
        }
    } else if (file.type.startsWith('image/')) {
        setDocImgUrl(URL.createObjectURL(file));
    } else {
        alert("Please select an image or PDF file.");
    }
  };

  const isSendDisabled = highlights.length === 0 || highlights.some(h => h.prompt.trim() === '') || isGenerating;
  const isTryAgainDisabled = (highlights.length === 0 && !generatedImageUrl && !docImgUrl) || isGenerating;

  return (
    <main className="w-screen h-screen bg-gray-100 text-gray-900 overflow-hidden font-sans flex flex-col md:flex-row">
        <div className="w-full h-1/2 md:w-[60%] md:h-full relative">
            <P5Canvas 
                docImgUrl={docImgUrl} 
                highlighting={highlighting} 
                brushSize={brushSize}
                highlightColor={currentColor}
                generationTrigger={generationTrigger}
                onCompositeImageReady={onCompositeImageReady}
                onGenerationTriggerConsumed={onGenerationTriggerConsumed}
            />
            
            {isGenerating && (
                <div className="absolute inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-20">
                    <div className="text-center text-white">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
                        <p className="mt-4 text-lg">Generating your document...</p>
                    </div>
                </div>
            )}

            <div className="absolute top-4 left-4 z-10 flex space-x-2">
                <label htmlFor="fileInput" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg cursor-pointer shadow-lg transition-colors">
                    Select Document
                </label>
                <input 
                    id="fileInput" type="file" accept="image/*,.pdf" className="hidden"
                    onChange={handleFileChange} onClick={(e) => (e.currentTarget.value = '')}
                />
                <button onClick={toggleHighlighting}
                    disabled={!docImgUrl || isGenerating}
                    className={`px-4 py-2 font-bold rounded-lg shadow-lg transition-colors ${
                        highlighting
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : 'bg-green-600 hover:bg-green-700 text-white'
                    } disabled:bg-gray-400 disabled:text-gray-200 disabled:cursor-not-allowed`}>
                    {highlighting ? 'Stop Highlighting' : 'Start Highlighting'}
                </button>
            </div>

            <div className="absolute bottom-4 left-4 z-10 bg-white bg-opacity-80 px-3 py-2 rounded-md select-none shadow-md border border-gray-200">
                <p className="text-lg">
                    Highlight mode: <span className={`font-bold ${highlighting ? 'text-blue-600' : 'text-gray-600'}`}>{highlighting ? 'ON' : 'OFF'}</span>
                </p>
                <p className="text-sm text-gray-500">(Press 'a' to toggle)</p>
                {highlighting && <p className="text-sm text-gray-500 mt-1">Brush Size: {brushSize} (+/-)</p>}
            </div>
            
            {!docImgUrl && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center p-8 bg-white bg-opacity-90 rounded-xl shadow-2xl border border-gray-200">
                        <h1 className="text-3xl font-bold mb-2">AI Document Editor</h1>
                        <p className="text-xl text-gray-600">Select an image or PDF to begin.</p>
                    </div>
                </div>
            )}
        </div>

        <div className="w-full h-1/2 md:w-[40%] md:h-full bg-white border-t md:border-t-0 md:border-l border-gray-300 p-6 flex flex-col">
            <div className="flex-grow overflow-y-auto pr-2">
                <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b pb-2">Generation Panel</h2>
                
                {isGenerating && !error && (
                    <div className="text-center text-gray-600 mt-10">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-4">Generating your document...</p>
                        <p className="text-sm text-gray-500">This may take a moment.</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mt-4" role="alert">
                        <strong className="font-bold">Error! </strong>
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}
                
                {generatedImageUrl && !isGenerating && (
                    <div>
                        <h3 className="text-xl font-semibold mb-2">Generated Result:</h3>
                        <img src={generatedImageUrl} alt="Generated Document" className="w-full rounded-lg border border-gray-300 shadow-md" />
                    </div>
                )}

                {!isGenerating && !generatedImageUrl && (
                    <>
                        <h3 className="text-xl font-semibold mb-2">Highlight Prompts</h3>
                        {highlights.length === 0 && (
                            <div className="text-center text-gray-500 mt-10">
                                <p>Your highlight prompts will appear here.</p>
                                <p className="mt-2 text-sm">Press 'a' in the left panel to start a new highlight.</p>
                            </div>
                        )}
                        <div className="space-y-4">
                            {highlights.map((h, index) => (
                                <div key={h.id} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                                    <label className="flex items-center font-semibold text-gray-700 mb-2">
                                        <span className="w-5 h-5 rounded-full inline-block mr-3 border border-gray-300" style={{ backgroundColor: h.color }}></span>
                                        Highlight #{index + 1}
                                    </label>
                                    <input type="text" value={h.prompt} onChange={(e) => handlePromptChange(h.id, e.target.value)}
                                        placeholder={`Describe what this highlight means...`}
                                        className="w-full px-3 py-2 text-gray-800 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
            
            <div className="flex-shrink-0 mt-auto pt-6 border-t border-gray-200">
                <div className="space-y-4">
                    <button onClick={handleSendToGenerate}
                        className="w-full py-3 px-4 bg-yellow-400 text-black font-bold rounded-lg shadow-md transition-colors hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 disabled:bg-yellow-200 disabled:text-gray-500 disabled:cursor-not-allowed"
                        disabled={isSendDisabled}>
                        {isGenerating ? 'Generating...' : 'Send to Nano Banana'}
                    </button>
                    <button onClick={handleTryAgain}
                        className="w-full py-3 px-4 bg-gray-200 text-gray-800 font-bold rounded-lg shadow-md transition-colors hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        disabled={isTryAgainDisabled}>
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    </main>
  );
}

export default App;