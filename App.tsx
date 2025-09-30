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

const GoogleLoader = () => (
    <div className="flex justify-center items-center">
        <svg className="animate-spin h-10 w-10" viewBox="0 0 50 50">
            <defs>
                <linearGradient id="g-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: '#4285F4' }} />
                    <stop offset="25%" style={{ stopColor: '#EA4335' }} />
                    <stop offset="50%" style={{ stopColor: '#FBBC05' }} />
                    <stop offset="100%" style={{ stopColor: '#34A853' }} />
                </linearGradient>
            </defs>
            <circle cx="25" cy="25" r="20" fill="none" stroke="url(#g-grad)" strokeWidth="5" strokeLinecap="round" />
        </svg>
    </div>
);


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
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  
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
  
  const handleTryAgain = useCallback(() => {
    setDocImgUrl(null);
    setHighlights([]);
    setGeneratedImageUrl(null);
    setError(null);
    setHighlighting(false);
  }, []);


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

  const increaseBrushSize = useCallback(() => {
    setBrushSize(prev => Math.min(prev + 5, 150));
  }, []);

  const decreaseBrushSize = useCallback(() => {
    setBrushSize(prev => Math.max(prev - 5, 5));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        toggleHighlighting();
      } else if (highlighting) {
          if (key === '+' || key === '=') {
              increaseBrushSize();
          } else if (key === '-') {
              decreaseBrushSize();
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleHighlighting, highlighting, increaseBrushSize, decreaseBrushSize]);

  const processFile = useCallback(async (file: File) => {
    if (!file) return;

    if (docImgUrl && docImgUrl.startsWith('blob:')) {
        URL.revokeObjectURL(docImgUrl);
    }
    
    handleTryAgain();

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
            setError("Could not load PDF file.");
        } finally {
            URL.revokeObjectURL(url);
        }
    } else if (file.type.startsWith('image/')) {
        setDocImgUrl(URL.createObjectURL(file));
    } else {
        setError("Please select an image or PDF file.");
    }
  }, [docImgUrl, handleTryAgain]);
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!docImgUrl) {
        setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    
    if (docImgUrl) return;

    const file = event.dataTransfer.files?.[0];
    if (file) {
        processFile(file);
    }
  };

  const isSendDisabled = highlights.length === 0 || highlights.some(h => h.prompt.trim() === '') || isGenerating;
  const isTryAgainDisabled = isGenerating;

  return (
    <main className="w-screen h-screen bg-gray-50 text-gray-800 flex flex-col md:flex-row font-sans">
        <div 
            className="w-full h-1/2 md:w-[65%] md:h-full relative bg-[#f1f3f4]"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
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
                <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-20">
                    <div className="text-center">
                        <GoogleLoader />
                        <p className="mt-4 text-lg font-medium text-gray-700">Applying edits...</p>
                    </div>
                </div>
            )}

            <div className="absolute top-4 left-4 z-10 flex space-x-2 items-center">
                <label htmlFor="fileInput" className="flex items-center gap-2 px-4 py-2 bg-[#1a73e8] hover:bg-[#185abc] text-white font-medium rounded-full cursor-pointer shadow-md transition-all duration-200">
                    <span className="material-symbols-outlined">upload_file</span>
                    Select Document
                </label>
                <input 
                    id="fileInput" type="file" accept="image/*,.pdf" className="hidden"
                    onChange={handleFileChange} onClick={(e) => (e.currentTarget.value = '')}
                />
                <button onClick={toggleHighlighting}
                    disabled={!docImgUrl || isGenerating}
                    className={`flex items-center gap-2 px-4 py-2 font-medium rounded-full shadow-md transition-all duration-200 ${
                        highlighting
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : 'bg-white hover:bg-gray-100 text-gray-700'
                    } disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed`}>
                     <span className="material-symbols-outlined">{highlighting ? 'edit_off' : 'edit'}</span>
                    {highlighting ? 'Stop' : 'Highlight'}
                </button>
                {highlighting && (
                    <div className="flex items-center bg-white rounded-full shadow-md">
                        <button 
                            onClick={decreaseBrushSize}
                            disabled={isGenerating}
                            className="p-2 text-gray-700 hover:bg-gray-100 rounded-l-full disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                            aria-label="Decrease brush size"
                        >
                            <span className="material-symbols-outlined" style={{fontSize: '20px'}}>remove</span>
                        </button>
                        <span className="px-1 text-sm font-medium text-gray-700 select-none w-8 text-center">{brushSize}</span>
                        <button 
                            onClick={increaseBrushSize}
                            disabled={isGenerating}
                            className="p-2 text-gray-700 hover:bg-gray-100 rounded-r-full disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                            aria-label="Increase brush size"
                        >
                            <span className="material-symbols-outlined" style={{fontSize: '20px'}}>add</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="absolute bottom-4 left-4 z-10 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-lg select-none shadow-md border border-gray-200/50">
                <p className="text-base font-medium">
                    Highlight mode: <span className={`font-bold ${highlighting ? 'text-[#1a73e8]' : 'text-gray-600'}`}>{highlighting ? 'ON' : 'OFF'}</span>
                </p>
                <p className="text-xs text-gray-500">(Press 'a' to toggle)</p>
                {highlighting && <p className="text-xs text-gray-500 mt-1">Brush Size: {brushSize} (Scroll or use +/-)</p>}
            </div>
            
            {!docImgUrl && (
                <div className={`absolute inset-0 flex items-center justify-center p-8 transition-colors duration-200 ${isDraggingOver ? 'bg-blue-50' : ''}`}>
                    <div className={`w-full h-full flex flex-col items-center justify-center bg-gray-50/20 border-4 border-dashed rounded-2xl text-center p-4 transition-colors duration-200 ${isDraggingOver ? 'border-blue-400' : 'border-gray-300'}`}>
                        <span className="material-symbols-outlined text-6xl text-gray-400 mb-4">
                            note_add
                        </span>
                        <p className="text-xl font-medium text-gray-600">
                            Drag document here or <label htmlFor="fileInput" className="text-[#1a73e8] font-semibold cursor-pointer hover:underline">select document</label> to edit with a prompt.
                        </p>
                        <p className="text-sm text-gray-500 mt-2">Supports PDF and image files</p>
                    </div>
                </div>
            )}
        </div>

        <div className="w-full h-1/2 md:w-[35%] md:h-full bg-white border-t md:border-t-0 md:border-l border-gray-200 p-6 flex flex-col">
            <header className="flex-shrink-0 pb-4 border-b border-gray-200">
                <h2 className="text-xl font-medium text-gray-700">Edit Instructions</h2>
            </header>
            
            <div className="flex-grow overflow-y-auto py-6 pr-2 -mr-2">
                
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mt-4" role="alert">
                        <strong className="font-bold">Error: </strong>
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}
                
                <h3 className="text-lg font-medium mb-4 text-gray-600">Highlight Prompts</h3>
                {highlights.length === 0 && !isGenerating && (
                    <div className="text-center text-gray-500 mt-10 p-4 border-2 border-dashed rounded-lg">
                        <p className="font-medium">Your prompts will appear here.</p>
                        <p className="mt-2 text-sm">Press 'a' or click 'Highlight' to add an edit region.</p>
                    </div>
                )}
                <div className="space-y-4">
                    {highlights.map((h, index) => (
                        <div key={h.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <label className="flex items-center font-medium text-gray-800 mb-2">
                                <span className="w-6 h-6 rounded-full inline-block mr-3 border-2 border-white shadow-sm" style={{ backgroundColor: h.color }}></span>
                                Highlight #{index + 1}
                            </label>
                            <input type="text" value={h.prompt} onChange={(e) => handlePromptChange(h.id, e.target.value)}
                                placeholder={`e.g., "Remove this sentence"`}
                                className="w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1a73e8] transition-shadow"/>
                        </div>
                    ))}
                </div>
            </div>
            
            <footer className="flex-shrink-0 mt-auto pt-6 border-t border-gray-200">
                <div className="space-y-3">
                    <button onClick={handleSendToGenerate}
                        className="w-full py-3 px-4 bg-[#1a73e8] text-white font-medium text-lg rounded-lg shadow-md transition-all duration-200 hover:bg-[#185abc] focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:ring-offset-2 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        disabled={isSendDisabled}>
                          {isGenerating ? <> <GoogleLoader /> Processing... </> : 'Apply Edits'}
                    </button>
                    <button onClick={handleTryAgain}
                        className="w-full py-2 px-4 text-gray-600 font-medium rounded-lg transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:text-gray-400 disabled:cursor-not-allowed"
                        disabled={isTryAgainDisabled}>
                        Clear All & Start Over
                    </button>
                </div>
            </footer>
        </div>
    </main>
  );
}

export default App;