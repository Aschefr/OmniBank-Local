"""
app/routers/simulator.py — Routeur API pour le Simulateur de Projets & Scénarios What-If (Sandbox).
Gère le CRUD des scénarios, la gestion des événements simulés et l'exécution de la projection.
"""
import logging
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Scenario, ScenarioEvent
from app.schemas.api_schemas import (
    ScenarioCreate,
    ScenarioUpdate,
    ScenarioOut,
    ScenarioEventCreate,
    ScenarioEventUpdate,
    ScenarioEventOut,
    SimulationRunRequest
)
from app.services.simulator_engine import run_simulation, get_simulator_presets

router = APIRouter(prefix="/api/simulator", tags=["simulator"])
logger = logging.getLogger(__name__)


# ─── Modèles Prédéfinis (Presets) ─────────────────────────────────────────────
@router.get("/presets")
def list_presets():
    """Retourne la liste des modèles de scénarios prêts à l'emploi."""
    return get_simulator_presets()


# ─── CRUD Scénarios ───────────────────────────────────────────────────────────
@router.get("/scenarios", response_model=List[ScenarioOut])
def list_scenarios(db: Session = Depends(get_db)):
    """Liste tous les scénarios du profil actif avec leurs événements."""
    scenarios = db.query(Scenario).order_by(Scenario.created_at.desc()).all()
    return scenarios


@router.post("/scenarios", response_model=ScenarioOut, status_code=status.HTTP_201_CREATED)
def create_scenario(payload: ScenarioCreate, db: Session = Depends(get_db)):
    """Crée un nouveau scénario et ses événements initiaux."""
    scenario = Scenario(
        name=payload.name,
        description=payload.description,
        color=payload.color or "#8b5cf6",
        is_active=payload.is_active
    )
    db.add(scenario)
    db.flush()

    if payload.events:
        for ev_in in payload.events:
            ev = ScenarioEvent(
                scenario_id=scenario.id,
                label=ev_in.label,
                event_type=ev_in.event_type,
                amount=ev_in.amount,
                account_id=ev_in.account_id,
                category=ev_in.category,
                start_date=ev_in.start_date,
                end_date=ev_in.end_date,
                duration_months=ev_in.duration_months,
                is_active=ev_in.is_active,
                notes=ev_in.notes
            )
            db.add(ev)

    db.commit()
    db.refresh(scenario)
    logger.info(f"[Simulateur] Scénario créé : #{scenario.id} - '{scenario.name}' ({len(scenario.events)} événements)")
    return scenario


@router.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def get_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Récupère les détails d'un scénario et tous ses événements."""
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")
    return scenario


@router.put("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(scenario_id: int, payload: ScenarioUpdate, db: Session = Depends(get_db)):
    """Met à jour les informations d'un scénario."""
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")

    if payload.name is not None:
        scenario.name = payload.name
    if payload.description is not None:
        scenario.description = payload.description
    if payload.color is not None:
        scenario.color = payload.color
    if payload.is_active is not None:
        scenario.is_active = payload.is_active

    db.commit()
    db.refresh(scenario)
    logger.info(f"[Simulateur] Scénario mis à jour : #{scenario.id} - '{scenario.name}'")
    return scenario


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Supprime un scénario et tous ses événements associés."""
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")

    db.delete(scenario)
    db.commit()
    logger.info(f"[Simulateur] Scénario supprimé : #{scenario_id}")
    return {"ok": True}


@router.post("/scenarios/{scenario_id}/duplicate", response_model=ScenarioOut, status_code=status.HTTP_201_CREATED)
def duplicate_scenario(scenario_id: int, db: Session = Depends(get_db)):
    """Duplique un scénario existant avec tous ses événements."""
    original = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not original:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")

    new_scenario = Scenario(
        name=f"{original.name} (Copie)",
        description=original.description,
        color=original.color,
        is_active=original.is_active
    )
    db.add(new_scenario)
    db.flush()

    for ev in original.events:
        new_ev = ScenarioEvent(
            scenario_id=new_scenario.id,
            label=ev.label,
            event_type=ev.event_type,
            amount=ev.amount,
            account_id=ev.account_id,
            category=ev.category,
            start_date=ev.start_date,
            end_date=ev.end_date,
            duration_months=ev.duration_months,
            is_active=ev.is_active,
            notes=ev.notes
        )
        db.add(new_ev)

    db.commit()
    db.refresh(new_scenario)
    logger.info(f"[Simulateur] Scénario #{scenario_id} dupliqué en nouveau scénario #{new_scenario.id}")
    return new_scenario


# ─── CRUD Événements d'un Scénario ────────────────────────────────────────────
@router.post("/scenarios/{scenario_id}/events", response_model=ScenarioEventOut, status_code=status.HTTP_201_CREATED)
def add_scenario_event(scenario_id: int, payload: ScenarioEventCreate, db: Session = Depends(get_db)):
    """Ajoute un événement simulé à un scénario existant."""
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")

    ev = ScenarioEvent(
        scenario_id=scenario.id,
        label=payload.label,
        event_type=payload.event_type,
        amount=payload.amount,
        account_id=payload.account_id,
        category=payload.category,
        start_date=payload.start_date,
        end_date=payload.end_date,
        duration_months=payload.duration_months,
        is_active=payload.is_active,
        notes=payload.notes
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    logger.info(f"[Simulateur] Événement ajouté au scénario #{scenario_id} : #{ev.id} - '{ev.label}'")
    return ev


@router.put("/events/{event_id}", response_model=ScenarioEventOut)
def update_scenario_event(event_id: int, payload: ScenarioEventUpdate, db: Session = Depends(get_db)):
    """Met à jour un événement simulé."""
    ev = db.query(ScenarioEvent).filter(ScenarioEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Événement introuvable.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ev, field, value)

    db.commit()
    db.refresh(ev)
    logger.info(f"[Simulateur] Événement #{event_id} mis à jour : '{ev.label}' (actif: {ev.is_active})")
    return ev


@router.delete("/events/{event_id}")
def delete_scenario_event(event_id: int, db: Session = Depends(get_db)):
    """Supprime un événement simulé."""
    ev = db.query(ScenarioEvent).filter(ScenarioEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Événement introuvable.")

    db.delete(ev)
    db.commit()
    logger.info(f"[Simulateur] Événement #{event_id} supprimé")
    return {"ok": True}


# ─── Exécution de Simulation (Moteur de Projection) ──────────────────────────
@router.post("/run")
def execute_simulation(payload: SimulationRunRequest, db: Session = Depends(get_db)):
    """
    Lance le calcul de projection prévisionnelle sur l'horizon demandé.
    Compare la trajectoire de base (réelle) avec les événements simulés.
    """
    custom_events_dicts = [e.model_dump() for e in payload.custom_events] if payload.custom_events else None
    result = run_simulation(
        db=db,
        horizon_months=payload.horizon_months,
        account_id=payload.account_id,
        scenario_id=payload.scenario_id,
        custom_events=custom_events_dicts,
        income_mode=payload.income_mode or "auto",
        custom_income_amount=payload.custom_income_amount,
        inflation_rate=payload.inflation_rate or 0.0,
        variable_expense_adjustment_pct=payload.variable_expense_adjustment_pct or 0.0,
        projection_profile=payload.projection_profile or "realistic",
        conservative_weight=payload.conservative_weight
    )
    return result

