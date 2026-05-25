from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any
import httpx

from app.database import get_db
from app.models import GlobalConfig
from app.schemas.api_schemas import ConfigItem

router = APIRouter(prefix="/api/config", tags=["config"])

@router.get("/")
def get_all_config(db: Session = Depends(get_db)):
    configs = db.query(GlobalConfig).all()
    return {c.key: c.value for c in configs}

@router.post("/")
def set_config(data: Dict[str, str], db: Session = Depends(get_db)):
    for key, value in data.items():
        conf = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        if conf:
            conf.value = value
        else:
            conf = GlobalConfig(key=key, value=value)
            db.add(conf)
    db.commit()
    return {"ok": True}

@router.get("/ollama/models")
async def get_ollama_models(db: Session = Depends(get_db)):
    ollama_url = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    if not ollama_url or not ollama_url.value:
        raise HTTPException(status_code=400, detail="Ollama URL not configured")
    
    url = ollama_url.value.rstrip("/")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{url}/api/tags", timeout=5.0)
            if response.status_code != 200:
                raise HTTPException(status_code=500, detail="Error fetching models from Ollama")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
