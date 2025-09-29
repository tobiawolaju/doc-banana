import React, { useRef, useEffect } from 'react';
import p5 from 'p5';

interface P5CanvasProps {
  docImgUrl: string | null;
  highlighting: boolean;
  brushSize: number;
  highlightColor: string;
  generationTrigger: boolean;
  onCompositeImageReady: (base64Data: string) => void;
  onGenerationTriggerConsumed: () => void;
}

const P5Canvas: React.FC<P5CanvasProps> = (props) => {
  const { docImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed } = props;
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
                if (newProps.docImgUrl && newProps.docImgUrl !== currentProps.docImgUrl) {
                    img = p.loadImage(newProps.docImgUrl, (loadedImg) => {
                        view.zoom = 1;
                        view.x = (p.width - loadedImg.width) / 2;
                        view.y = (p.height - loadedImg.height) / 2;
                        if(highlightLayer) {
                            highlightLayer.clear();
                            highlightLayer.resizeCanvas(loadedImg.width, loadedImg.height);
                        } else {
                            highlightLayer = p.createGraphics(loadedImg.width, loadedImg.height);
                        }
                    });
                } else if (!newProps.docImgUrl && currentProps.docImgUrl) {
                    img = undefined;
                    if (highlightLayer) highlightLayer.clear();
                }

                if (newProps.generationTrigger && !currentProps.generationTrigger) {
                  if (img && highlightLayer) {
                    const result = p.createGraphics(img.width, img.height);
                    result.image(img, 0, 0);
                    result.tint(255, 128);
                    result.image(highlightLayer, 0, 0);
                    
                    const dataUrl = result.elt.toDataURL('image/png');
                    // Pass back just the base64 part
                    newProps.onCompositeImageReady(dataUrl.split(',')[1]);
                    newProps.onGenerationTriggerConsumed();
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
                p.background(243, 244, 246);
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
                const zoomFactor = 0.05;
                const direction = deltaY > 0 ? -1 : 1;
                const newZoom = view.zoom * (1 + direction * zoomFactor);
                const zoom = p.constrain(newZoom, 0.1, 10);
                if (zoom !== view.zoom) {
                    view.x = x - (x - view.x) * (zoom / view.zoom);
                    view.y = y - (y - view.y) * (zoom / view.zoom);
                    view.zoom = zoom;
                }
                return false;
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
        (sketchInstanceRef.current as any).updateWithProps({ docImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed });
    }
  }, [docImgUrl, highlighting, brushSize, highlightColor, generationTrigger, onCompositeImageReady, onGenerationTriggerConsumed]);

  return <div ref={sketchRef} className="absolute top-0 left-0 w-full h-full" />;
};

export default P5Canvas;
