"""
Lightweight service that ONLY extracts embeddings
TypeScript calls this, then queries Weaviate directly
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from deepface import DeepFace
import tempfile
import os

app = FastAPI(title="Face Embedding Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = "Facenet512"

class EmbeddingResponse(BaseModel):
    embedding: List[float]
    faces_detected: int
    model_name: str

@app.get("/health")
async def health():
    return {"status": "healthy", "model": MODEL_NAME}

@app.post("/extract-embedding", response_model=EmbeddingResponse)
async def extract_embedding(image: UploadFile = File(...)):
    """
    Extract face embedding from image
    Returns a 512-dimensional vector (for Facenet512)
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
        tmp.write(await image.read())
        tmp_path = tmp.name
    
    try:
        result = DeepFace.represent(
            img_path=tmp_path,
            model_name=MODEL_NAME,
            detector_backend="retinaface",
            enforce_detection=True,
            align=True
        )
        
        if not result or len(result) == 0:
            raise HTTPException(status_code=400, detail="No face detected")
        
        return EmbeddingResponse(
            embedding=result[0]["embedding"],
            faces_detected=len(result),
            model_name=MODEL_NAME
        )
        
    except ValueError as e:
        if "Face could not be detected" in str(e):
            raise HTTPException(status_code=400, detail="No face detected in image")
        raise HTTPException(status_code=400, detail=str(e))
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)