from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any
import httpx

from app.database import get_db
from app.models import GlobalConfig
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
    "sim_outlier_sensitivity": "2",
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
}

@router.get("/")
def get_all_config(db: Session = Depends(get_db)):
    configs = db.query(GlobalConfig).all()
    res = {c.key: c.value for c in configs}
    for k, v in CONFIG_DEFAULTS.items():
        if k not in res:
            res[k] = v
    return res

@router.post("/")
def set_config(data: Dict[str, str], db: Session = Depends(get_db)):
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

    # Automatically create or update salary recurrence if base_pay_amount provided
    if "base_pay_amount" in data:
        try:
            amt = float(data["base_pay_amount"])
            if amt > 0:
                from app.models import RecurrenceTemplate, Account, Category
                # Ensure Salaire category exists
                cat_sal = db.query(Category).filter(Category.name == "Salaire").first()
                if not cat_sal:
                    db.add(Category(name="Salaire", type="income"))
                    db.commit()

                # Check if an active income recurrence template already exists
                salary_tpl = db.query(RecurrenceTemplate).filter(
                    RecurrenceTemplate.type == "income",
                    RecurrenceTemplate.is_closed == False
                ).first()

                pay_day = int(data.get("base_pay_day") or 28)
                main_acc = db.query(Account).filter(Account.is_closed == False).first()

                if salary_tpl:
                    salary_tpl.amount = amt
                    if "base_pay_day" in data:
                        salary_tpl.day_of_month = pay_day
                else:
                    new_tpl = RecurrenceTemplate(
                        description="Salaire / Revenu",
                        amount=amt,
                        type="income",
                        category="Salaire",
                        frequency="Monthly",
                        day_of_month=pay_day,
                        to_account_id=main_acc.id if main_acc else None
                    )
                    db.add(new_tpl)
                db.commit()

                from app.routers.recurrences import generate_recurrences
                generate_recurrences(db=db)
        except Exception as e:
            pass
    
    # Automatically generate recurrences using the new window settings if modified
    if "recurrence_generation_months" in data:
        try:
            from app.routers.recurrences import generate_recurrences
            generate_recurrences(db=db)
        except Exception:
            pass
            
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
