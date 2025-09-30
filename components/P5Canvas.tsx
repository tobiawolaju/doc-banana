import React, { useRef, useEffect } from 'react';
import p5 from 'p5';

interface P5CanvasProps {
  displayImgUrl: string | null;
  fullResImgUrl: string | null;
  highlighting: boolean;
  brushSize: number;
  highlightColor: string;
  generationTrigger: boolean;
  onCompositeImageReady: (base64Data: string) => void;
  onGenerationTriggerConsumed: () => void;
  onBrushSizeChange: (newSize: number) => void;
}

const P5Canvas: React.FC<P5CanvasProps> = (props) => {
  const { displayImgUrl, fullResImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed, onBrushSizeChange } = props;
  const sketchRef = useRef<HTMLDivElement>(null);
  const sketchInstanceRef = useRef<p5 | null>(null);

  useEffect(() => {
    if (sketchRef.current && !sketchInstanceRef.current) {
        const sketch = (p: p5) => {
            let img: p5.Image | undefined;
            let highlightLayer: p5.Graphics;
            let view = { x: 0, y: 0, zoom: 1 };
            let lastMouse = { x: 0, y: 0 };
            let isDragging = false;
            let currentProps: P5CanvasProps = { ...props };
            
            p.updateWithProps = (newProps: P5CanvasProps) => {
                if (newProps.displayImgUrl && newProps.displayImgUrl !== currentProps.displayImgUrl) {
                    img = p.loadImage(newProps.displayImgUrl, (loadedImg) => {
                        const canvasWidth = p.width;
                        const canvasHeight = p.height;
                        const imgAspectRatio = loadedImg.width / loadedImg.height;
                        const canvasAspectRatio = canvasWidth / canvasHeight;

                        if (imgAspectRatio > canvasAspectRatio) {
                            view.zoom = canvasWidth / loadedImg.width * 0.95;
                        } else {
                            view.zoom = canvasHeight / loadedImg.height * 0.95;
                        }

                        view.x = (canvasWidth - loadedImg.width * view.zoom) / 2;
                        view.y = (canvasHeight - loadedImg.height * view.zoom) / 2;

                        if(highlightLayer) {
                            highlightLayer.clear();
                            highlightLayer.resizeCanvas(loadedImg.width, loadedImg.height);
                        } else {
                            highlightLayer = p.createGraphics(loadedImg.width, loadedImg.height);
                        }
                    });
                } else if (!newProps.displayImgUrl && currentProps.displayImgUrl) {
                    img = undefined;
                    if (highlightLayer) highlightLayer.clear();
                }

                if (newProps.generationTrigger && !currentProps.generationTrigger) {
                    if (highlightLayer && newProps.fullResImgUrl) {
                        // This is async, so we manage consuming the trigger inside the callbacks
                        p.loadImage(newProps.fullResImgUrl, (fullResImage) => {
                            const finalComposite = p.createGraphics(fullResImage.width, fullResImage.height);
                            // 1. Draw the original full-resolution image
                            finalComposite.image(fullResImage, 0, 0);
                            
                            // 2. Apply tint for transparency
                            finalComposite.tint(255, 128);

                            // 3. Draw the (potentially smaller) highlight layer, scaling it up to fit
                            finalComposite.image(highlightLayer, 0, 0, fullResImage.width, fullResImage.height);
                            
                            const dataUrl = finalComposite.elt.toDataURL('image/png');
                            newProps.onCompositeImageReady(dataUrl.split(',')[1]);
                            newProps.onGenerationTriggerConsumed();

                            // 4. Clean up the graphics buffer to free memory
                            finalComposite.remove();
                        }, (err) => {
                           console.error("Failed to load full-res image for composition", err);
                           newProps.onGenerationTriggerConsumed(); // Consume trigger even on error
                        });
                    } else {
                        // If trigger happens with no image, just consume it.
                        newProps.onGenerationTriggerConsumed();
                    }
                }

                currentProps = newProps;
            };

            p.setup = () => {
                if (sketchRef.current) {
                    p.createCanvas(sketchRef.current.offsetWidth, sketchRef.current.offsetHeight).parent(sketchRef.current);
                }
                p.updateWithProps({ ...props });
            };

            p.draw = () => {
                p.background(241, 243, 244); // Google's light grey background color
                p.push();
                p.translate(view.x, view.y);
                p.scale(view.zoom);
                if (img) {
                    p.image(img, 0, 0);
                    if (highlightLayer) {
                        p.tint(255, 128);
                        p.image(highlightLayer, 0, 0);
                        p.noTint();
                    }
                }
                p.pop();
                if (currentProps.highlighting) {
                    p.noCursor();
                    const c = p.color(currentProps.highlightColor);
                    p.fill(p.red(c), p.green(c), p.blue(c), 128);
                    p.noStroke();
                    p.ellipse(p.mouseX, p.mouseY, currentProps.brushSize, currentProps.brushSize);
                } else {
                    p.cursor(p.ARROW);
                }
            };
            
            p.windowResized = () => {
                if (sketchRef.current && sketchRef.current.offsetWidth > 0 && sketchRef.current.offsetHeight > 0) {
                  p.resizeCanvas(sketchRef.current.offsetWidth, sketchRef.current.offsetHeight);
                }
            };

            p.mousePressed = () => {
                if (p.mouseX < 0 || p.mouseX > p.width || p.mouseY < 0 || p.mouseY > p.height) return;
                if (p.mouseButton === p.LEFT && !currentProps.highlighting) {
                    isDragging = true;
                    lastMouse.x = p.mouseX;
                    lastMouse.y = p.mouseY;
                }
            };
            
            p.mouseReleased = () => { isDragging = false; };

            p.mouseDragged = () => {
                if (!img || p.mouseX < 0 || p.mouseX > p.width || p.mouseY < 0 || p.mouseY > p.height) return;
                if (isDragging && !currentProps.highlighting) {
                    view.x += p.mouseX - lastMouse.x;
                    view.y += p.mouseY - lastMouse.y;
                    lastMouse.x = p.mouseX;
                    lastMouse.y = p.mouseY;
                } else if (currentProps.highlighting && highlightLayer) {
                    const imgX = (p.mouseX - view.x) / view.zoom;
                    const imgY = (p.mouseY - view.y) / view.zoom;
                    const prevImgX = (p.pmouseX - view.x) / view.zoom;
                    const prevImgY = (p.pmouseY - view.y) / view.zoom;
                    
                    highlightLayer.stroke(currentProps.highlightColor); 
                    highlightLayer.strokeWeight(currentProps.brushSize / view.zoom);
                    highlightLayer.strokeCap(p.ROUND);
                    highlightLayer.strokeJoin(p.ROUND);
                    highlightLayer.noFill(); 
                    highlightLayer.line(prevImgX, prevImgY, imgX, imgY);
                }
            };

            p.mouseWheel = (event: any) => {
                const { x, y, deltaY } = event;
                if (x < 0 || x > p.width || y < 0 || y > p.height) return;
                const direction = deltaY > 0 ? -1 : 1;

                if (currentProps.highlighting) {
                    const newSize = currentProps.brushSize + direction * 5;
                    currentProps.onBrushSizeChange(newSize);
                    return false; // Prevent default scroll and canvas zooming
                }

                // Default behavior: zoom the canvas
                const zoomFactor = 0.05;
                const newZoom = view.zoom * (1 + direction * zoomFactor);
                const zoom = p.constrain(newZoom, 0.1, 10);
                if (zoom !== view.zoom) {
                    view.x = x - (x - view.x) * (zoom / view.zoom);
                    view.y = y - (y - view.y) * (zoom / view.zoom);
                    view.zoom = zoom;
                }

                return false; // Prevent default browser scroll
            };
        };
        
        sketchInstanceRef.current = new p5(sketch, sketchRef.current);
    }
    
    return () => {
        if (sketchInstanceRef.current) {
            sketchInstanceRef.current.remove();
            sketchInstanceRef.current = null;
        }
    };
  }, []);

  useEffect(() => {
    if (sketchInstanceRef.current && (sketchInstanceRef.current as any).updateWithProps) {
        (sketchInstanceRef.current as any).updateWithProps({ displayImgUrl, fullResImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed, onBrushSizeChange });
    }
  }, [displayImgUrl, fullResImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed, onBrushSizeChange]);

  return <div ref={sketchRef} className="absolute top-0 left-0 w-full h-full" />;
};

export default P5Canvas;