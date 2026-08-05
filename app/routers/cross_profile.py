"""
app/routers/cross_profile.py — Router API pour les virements inter-profils (passerelles).
"""
import uuid
import logging
from datetime import date, datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db, get_engine
from app.models import Transaction, Account
from app.profile_manager import load_profiles_data, get_active_profile
from app.schemas.api_schemas import (
    CrossProfileTransferRequest,
    CrossProfileValidationRequest,
    TransactionOut
)
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cross-profile", tags=["cross-profile"])


@router.get("/{profile_id}/accounts")
def get_remote_profile_accounts(profile_id: str):
    """
    Retourne la liste des comptes (nom, type, couleur, devise) d'un profil distant.
    Sécurité: N'expose NI les soldes initiaux, NI les transactions. Pas de PIN requis.
    """
    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil distant introuvable.")

    active = get_active_profile()
    if active["id"] == profile_id:
        raise HTTPException(status_code=400, detail="Veuillez sélectionner un autre profil.")

    try:
        eng = get_engine(profile_id)
        SessionTarget = sessionmaker(bind=eng)
        session = SessionTarget()
        try:
            accounts = session.query(Account).filter(Account.is_closed == False).all()
            return [
                {
                    "id": a.id,
                    "name": a.name,
                    "type": a.type,
                    "color": a.color,
                    "currency": a.currency or "EUR"
                }
                for a in accounts
            ]
        finally:
            session.close()
    except Exception as e:
        logger.error(f"[CrossProfile] Erreur lors de la lecture des comptes du profil {profile_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Échec d'accès au profil distant: {str(e)}")


@router.post("/transfer")
def create_cross_profile_transfer(req: CrossProfileTransferRequest, db: Session = Depends(get_db)):
    """
    Crée un virement inter-profil :
    - Émetteur (profil actif) : transaction type transfer, from_account=source, status='accepted'
    - Récepteur (profil distant) : transaction type transfer, to_account=target, status='pending'
    """
    active_prof = get_active_profile()
    if active_prof["id"] == req.target_profile_id:
        raise HTTPException(status_code=400, detail="Impossible de faire un virement inter-profil vers le même profil.")

    data = load_profiles_data()
    target_prof = next((p for p in data.get("profiles", []) if p["id"] == req.target_profile_id), None)
    if not target_prof:
        raise HTTPException(status_code=404, detail="Profil destinataire introuvable.")

    # Vérification du compte source dans le profil actif
    source_acc = db.query(Account).filter(Account.id == req.source_account_id).first()
    if not source_acc:
        raise HTTPException(status_code=404, detail="Compte source introuvable dans le profil actif.")

    # Ouverture de la session DB du profil distant
    target_eng = get_engine(req.target_profile_id)
    SessionTarget = sessionmaker(bind=target_eng)
    target_db = SessionTarget()

    try:
        target_acc = target_db.query(Account).filter(Account.id == req.target_account_id).first()
        if not target_acc:
            raise HTTPException(status_code=404, detail="Compte destinataire introuvable dans le profil cible.")

        link_id = f"cp_{uuid.uuid4().hex[:12]}"
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

        label_for_source = f"{target_prof.get('icon', '👤')} {target_prof['name']} — {target_acc.name}"
        label_for_target = f"{active_prof.get('icon', '👤')} {active_prof['name']} — {source_acc.name}"

        # Detect source and target account effective currencies for multi-currency conversion
        from app.services.finance_engine import get_base_currency
        source_base = get_base_currency(db)
        target_base = get_base_currency(target_db)

        source_acc_curr = getattr(source_acc, "currency", None)
        target_acc_curr = getattr(target_acc, "currency", None)

        source_curr = (source_acc_curr if (source_acc_curr and source_acc_curr != "EUR") else source_base).upper().strip()
        target_curr = (target_acc_curr if (target_acc_curr and target_acc_curr != "EUR") else target_base).upper().strip()

        if source_curr != target_curr:
            from app.services.finance_engine import convert_currency
            converted_amount = convert_currency(target_db, abs(req.amount), source_curr, target_curr)
            target_amount = round(converted_amount, 2)
            orig_amount = abs(req.amount)
            orig_curr = source_curr
        else:
            target_amount = abs(req.amount)
            orig_amount = None
            orig_curr = None

        # 1. Transaction émetteur (profil actif)
        source_tx = Transaction(
            date_saisie=date.today(),
            date_operation=req.date_operation,
            description=req.description or "Virement inter-profil",
            amount=abs(req.amount),
            type="transfer",
            category=req.category,
            from_account_id=req.source_account_id,
            to_account_id=None,
            cross_profile_link_id=link_id,
            cross_profile_id=req.target_profile_id,
            cross_profile_label=label_for_source,
            cross_profile_status="accepted",
            created_by=req.created_by,
            created_at=now_str
        )
        db.add(source_tx)
        db.flush()
        action_id = record_action(db, "transaction", source_tx.id, "CREATE", None, snapshot_entity(source_tx), user_name=req.created_by)

        # 2. Transaction récepteur (profil distant — en attente)
        target_tx = Transaction(
            date_saisie=date.today(),
            date_operation=req.date_operation,
            description=req.description or "Virement inter-profil",
            amount=target_amount,
            original_amount=orig_amount,
            original_currency=orig_curr,
            type="transfer",
            category=req.category,
            from_account_id=None,
            to_account_id=req.target_account_id,
            cross_profile_link_id=link_id,
            cross_profile_id=active_prof["id"],
            cross_profile_label=label_for_target,
            cross_profile_status="pending",
            created_by=req.created_by,
            created_at=now_str
        )
        target_db.add(target_tx)
        target_db.flush()
        record_action(target_db, "transaction", target_tx.id, "CREATE", None, snapshot_entity(target_tx), user_name=req.created_by)

        db.commit()
        target_db.commit()

        db.refresh(source_tx)
        source_tx.action_id = action_id

        logger.info(f"[CrossProfile] Virement créé: {active_prof['name']} -> {target_prof['name']} ({req.amount} EUR, link_id={link_id})")
        return source_tx
    except Exception as e:
        db.rollback()
        target_db.rollback()
        logger.error(f"[CrossProfile] Erreur lors de la création du virement inter-profil: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Échec de création du virement: {str(e)}")
    finally:
        target_db.close()


@router.get("/pending", response_model=List[TransactionOut])
def get_pending_cross_transfers(db: Session = Depends(get_db)):
    """Retourne les virements inter-profils en attente de validation pour le profil actif."""
    return db.query(Transaction).filter(Transaction.cross_profile_status == "pending").order_by(Transaction.date_operation.desc()).all()


@router.get("/pending/count")
def get_pending_count(db: Session = Depends(get_db)):
    """Retourne le nombre de virements en attente de validation."""
    count = db.query(Transaction).filter(Transaction.cross_profile_status == "pending").count()
    return {"count": count}


@router.post("/validate/{link_id}")
def validate_cross_profile_transfer(link_id: str, req: CrossProfileValidationRequest, db: Session = Depends(get_db)):
    """
    Accepte ou meut au statut 'rejected' un virement inter-profil entrant en attente.
    """
    if req.action not in ["accept", "reject"]:
        raise HTTPException(status_code=400, detail="Action invalide. Doit être 'accept' ou 'reject'.")

    tx = db.query(Transaction).filter(
        Transaction.cross_profile_link_id == link_id,
        Transaction.cross_profile_status == "pending"
    ).first()

    if not tx:
        raise HTTPException(status_code=404, detail="Virement en attente introuvable.")

    old_snapshot = snapshot_entity(tx)
    new_status = "accepted" if req.action == "accept" else "rejected"
    tx.cross_profile_status = new_status
    tx.modified_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    record_action(db, "transaction", tx.id, "UPDATE", old_snapshot, snapshot_entity(tx))

    # Si le profil partenaire existe encore et qu'on a rejeté, mettre à jour la transaction partenaire aussi
    if req.action == "reject" and tx.cross_profile_id:
        data = load_profiles_data()
        partner_prof = next((p for p in data.get("profiles", []) if p["id"] == tx.cross_profile_id), None)
        if partner_prof:
            try:
                partner_eng = get_engine(tx.cross_profile_id)
                SessionPartner = sessionmaker(bind=partner_eng)
                partner_db = SessionPartner()
                try:
                    p_tx = partner_db.query(Transaction).filter(Transaction.cross_profile_link_id == link_id).first()
                    if p_tx:
                        p_old = snapshot_entity(p_tx)
                        p_tx.cross_profile_status = "rejected"
                        p_tx.modified_at = datetime.now().strftime("%Y-%m-%d %H:%M")
                        record_action(partner_db, "transaction", p_tx.id, "UPDATE", p_old, snapshot_entity(p_tx))
                        partner_db.commit()
                finally:
                    partner_db.close()
            except Exception as e:
                logger.warning(f"[CrossProfile] Impossible de mettre à jour le statut partenaire rejeté: {e}")

    db.commit()
    db.refresh(tx)
    logger.info(f"[CrossProfile] Virement {link_id} validé avec statut '{new_status}'")
    return {"ok": True, "status": new_status, "transaction_id": tx.id}


@router.delete("/transfer/{link_id}")
def delete_cross_profile_transfer(link_id: str, db: Session = Depends(get_db)):
    """Supprime un virement inter-profil (supprime la transaction active et partenaire si existante)."""
    tx = db.query(Transaction).filter(Transaction.cross_profile_link_id == link_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction inter-profil introuvable.")

    partner_profile_id = tx.cross_profile_id
    old_snapshot = snapshot_entity(tx)
    tx_id = tx.id
    db.delete(tx)
    record_action(db, "transaction", tx_id, "DELETE", old_snapshot, None)

    # Tente de supprimer la transaction partenaire
    if partner_profile_id:
        data = load_profiles_data()
        if any(p["id"] == partner_profile_id for p in data.get("profiles", [])):
            try:
                partner_eng = get_engine(partner_profile_id)
                SessionPartner = sessionmaker(bind=partner_eng)
                partner_db = SessionPartner()
                try:
                    p_tx = partner_db.query(Transaction).filter(Transaction.cross_profile_link_id == link_id).first()
                    if p_tx:
                        p_old = snapshot_entity(p_tx)
                        p_id = p_tx.id
                        partner_db.delete(p_tx)
                        record_action(partner_db, "transaction", p_id, "DELETE", p_old, None)
                        partner_db.commit()
                finally:
                    partner_db.close()
            except Exception as e:
                logger.warning(f"[CrossProfile] Erreur lors de la suppression partenaire {link_id}: {e}")

    db.commit()
    return {"ok": True, "message": "Virement inter-profil supprimé."}
