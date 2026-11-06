from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
import httpx

from app.database import get_db
from app.models import GlobalConfig
from app.services import license_service
from app.schemas.api_schemas import ConfigItem
from app.services import stats_cache

router = APIRouter(prefix="/api/config", tags=["config"])

CONFIG_DEFAULTS = {
    "auto_link_deviant_recurrences": "false",
    "auto_propagate_recurrence_hikes": "false",
    "auto_skip_unreconciled_recurrences": "false",
    "auto_close_unreconciled_recurrences": "false",
    "auto_promote_recurrences": "false",
    "auto_promote_recurrences_since": "",
    "budget_minimum_threshold": "1.0",
    "auto_create_budget_envelopes": "false",
    "auto_apply_budget_suggestions": "false",
    "enable_budget_creation_suggestions": "true",
    "enable_budget_recalibration_suggestions": "true",
    "budget_suggestion_engine": "deterministic",
    "auto_reconcile_transactions": "false",
    "auto_commit_incoming_transactions": "false",
    "auto_close_empty_import_sas": "false",
    "auto_create_missing_categories": "false",
    "auto_assign_chameleon_fallback": "false",
    "auto_pilot_enabled": "false",
    "autopilot_preset": "balanced",
    # Simulateur de Projets & Scénarios (Persistance multi-appareils)
    "sim_horizon": "36",
    "sim_conservative_weight": "0.20",
    "sim_var_expense_adj": "0.0",
    "sim_outlier_sensitivity": "4",
    "sim_scenario_level": "0",
    "sim_seasonality_mode": "disabled",
    "sim_seasonality_intensity": "1.0",
    "sim_income_mode": "historical_n1",
    "sim_custom_income": "",
    "sim_inflation_rate": "0.0",
    "sim_account": "",
    "sim_active_scenario": "",
    "sim_advanced_open": "false",
    "sim_table_open": "false",
    "sim_sources_open": "false",
    "sim_seasonality_profile_open": "false",
    "budget_pinned_ids": "[]",
    "budget_sidebar_totals": "true",
    "budget_totals_exclude_fixed": "true",
    "budget_sidebar_labels": "{}",
    "budget_update_notice": "false",
}

@router.get("/")
def get_all_config(db: Session = Depends(get_db)):
    configs = db.query(GlobalConfig).all()
    res = {c.key: c.value for c in configs if c.key not in RESTRICTED_CONFIG_KEYS}
    for k, v in CONFIG_DEFAULTS.items():
        if k not in res:
            res[k] = v
    # Sans licence valable, l'application se comporte et s'affiche en mode personnel
    if str(res.get("enable_org_mode", "")).lower() == "true" and not license_service.is_license_active(db):
        res["enable_org_mode"] = "false"
    return res

RESTRICTED_CONFIG_KEYS = {"license_key", "license_email", "license_contract_version", "license_contract_accepted_at"}

@router.post("/")
def set_config(data: Dict[str, str], db: Session = Depends(get_db)):
    if any(k in data for k in RESTRICTED_CONFIG_KEYS):
        raise HTTPException(
            status_code=403,
            detail="La gestion de la licence s'effectue exclusivement via /api/license/activate."
        )
    if str(data.get("enable_org_mode", "")).lower() == "true" and not license_service.is_license_active(db):
        raise HTTPException(status_code=403, detail="Le mode Organisation nécessite une licence valable.")
    for key, value in data.items():
        conf = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        if conf:
            conf.value = str(value)
        else:
            conf = GlobalConfig(key=key, value=str(value))
            db.add(conf)
    db.commit()
    stats_cache.invalidate()

    # Automatically sync base_pay_day with active profile metadata
    if "base_pay_day" in data:
        try:
            val = int(data["base_pay_day"])
            if val > 0:
                from app.profile_manager import get_active_profile, update_profile
                active_prof = get_active_profile()
                if active_prof:
                    update_profile(active_prof["id"], pay_cycle_day=val)
        except Exception:
            pass

    # base_pay_amount (montant net déclaré dans l'assistant) ne crée plus de récurrence ni d'opérations : il sert de
    # référence pour reconnaître le salaire dans les opérations réelles et pour la paie prévue tant qu'aucune n'est
    # connue (finance_engine.predict_next_paycheck). L'ancienne création imposait aussi ce montant à la première
    # récurrence de revenu venue, quelle qu'elle soit.

    # Automatically generate recurrences using the new window settings if modified
    if "recurrence_generation_months" in data:
        try:
            from app.routers.recurrences import generate_recurrences
            generate_recurrences(db=db)
        except Exception:
            pass
            
    return {"ok": True}

@router.get("/ollama/models")
async def get_ollama_models(url: Optional[str] = None, db: Session = Depends(get_db)):
    url = _ollama_url(db, url)
    if not url:
        raise HTTPException(status_code=400, detail="Ollama URL not configured")
    url = url.rstrip("/")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{url}/api/tags", timeout=5.0)
            if response.status_code != 200:
                raise HTTPException(status_code=500, detail="Error fetching models from Ollama")
            return response.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _ollama_url(db: Session, override: Optional[str] = None) -> str:
    """Adresse Ollama à utiliser : celle qu'on teste (assistant de démarrage, pas encore enregistrée) ou celle
    enregistrée. Tester une adresse ne l'enregistre plus : l'assistant écrasait ainsi la bonne adresse."""
    if override and override.strip():
        return override.strip()
    row = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    return (row.value or "").strip() if row else ""


@router.get("/ollama/catalog")
async def get_ollama_catalog(url: Optional[str] = None, db: Session = Depends(get_db)):
    """Modèles recommandés, avec leurs réglages, vus depuis le serveur configuré (installés ou non)."""
    from app.services import ai_model_catalog
    url = _ollama_url(db, url)
    if not url:
        return {"downloadable": False, "models": [{**m, "installed": False, "downloading": False, "percent": 0, "error": None}
                                                  for m in ai_model_catalog.CATALOG]}
    return await ai_model_catalog.catalog_for(url)


@router.post("/ollama/pull")
async def pull_ollama_model(data: Dict[str, str], db: Session = Depends(get_db)):
    """Télécharge un modèle recommandé sur le serveur Ollama configuré, en tâche de fond."""
    from app.services import ai_model_catalog
    url = _ollama_url(db, data.get("url"))
    if not url or not await ai_model_catalog.is_ollama(url):
        raise HTTPException(status_code=400, detail="Only an Ollama server can download models")
    try:
        return ai_model_catalog.start_pull(url, data.get("model", ""))
    except ValueError:
        raise HTTPException(status_code=400, detail="Model not in the recommended list")

# --- Exchange Rates Endpoints ---
from app.models import ExchangeRate
from app.schemas.api_schemas import ExchangeRateCreate, ExchangeRateOut

@router.get("/exchange-rates")
def get_exchange_rates(db: Session = Depends(get_db)):
    rates = db.query(ExchangeRate).all()
    return [{"id": r.id, "from_currency": r.from_currency, "to_currency": r.to_currency, "rate": r.rate, "updated_at": r.updated_at.isoformat() if r.updated_at else None} for r in rates]

@router.post("/exchange-rates")
def save_exchange_rate(data: ExchangeRateCreate, db: Session = Depends(get_db)):
    from_curr = data.from_currency.upper().strip()
    to_curr = data.to_currency.upper().strip()
    if from_curr == to_curr:
        raise HTTPException(status_code=400, detail="Source and target currencies must be different")
    
    rate_obj = db.query(ExchangeRate).filter(
        ExchangeRate.from_currency == from_curr,
        ExchangeRate.to_currency == to_curr
    ).first()
    
    if rate_obj:
        rate_obj.rate = data.rate
    else:
        rate_obj = ExchangeRate(from_currency=from_curr, to_currency=to_curr, rate=data.rate)
        db.add(rate_obj)
    db.commit()
    stats_cache.invalidate()
    db.refresh(rate_obj)
    return {"id": rate_obj.id, "from_currency": rate_obj.from_currency, "to_currency": rate_obj.to_currency, "rate": rate_obj.rate}

@router.delete("/exchange-rates/{rate_id}")
def delete_exchange_rate(rate_id: int, db: Session = Depends(get_db)):
    rate_obj = db.query(ExchangeRate).filter(ExchangeRate.id == rate_id).first()
    if not rate_obj:
        raise HTTPException(status_code=404, detail="Exchange rate not found")
    db.delete(rate_obj)
    db.commit()
    stats_cache.invalidate()
    return {"ok": True}

@router.post("/exchange-rates/fetch-online")
async def fetch_online_exchange_rates(db: Session = Depends(get_db)):
    base_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "base_currency").first()
    base_curr = base_conf.value.upper() if base_conf and base_conf.value else "EUR"
    
    url = f"https://api.frankfurter.dev/v1/latest?base={base_curr}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10.0)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Impossible de contacter l'API publique des taux de change")
            data = resp.json()
            rates = data.get("rates", {})
            
            updated_count = 0
            for curr_code, rate_val in rates.items():
                if rate_val and isinstance(rate_val, (int, float)):
                    # Direct rate: base_curr -> curr_code
                    r_obj = db.query(ExchangeRate).filter(
                        ExchangeRate.from_currency == base_curr,
                        ExchangeRate.to_currency == curr_code
                    ).first()
                    if r_obj:
                        r_obj.rate = float(rate_val)
                    else:
                        r_obj = ExchangeRate(from_currency=base_curr, to_currency=curr_code, rate=float(rate_val))
                        db.add(r_obj)
                        
                    # Reverse rate: curr_code -> base_curr
                    rev_obj = db.query(ExchangeRate).filter(
                        ExchangeRate.from_currency == curr_code,
                        ExchangeRate.to_currency == base_curr
                    ).first()
                    if rev_obj:
                        rev_obj.rate = round(1.0 / float(rate_val), 6)
                    else:
                        rev_obj = ExchangeRate(from_currency=curr_code, to_currency=base_curr, rate=round(1.0 / float(rate_val), 6))
                        db.add(rev_obj)
                    updated_count += 1
                    
            db.commit()
            return {"ok": True, "base_currency": base_curr, "updated": updated_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la mise à jour des taux : {str(e)}")
