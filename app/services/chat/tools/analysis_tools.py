"""
app/services/chat/tools/analysis_tools.py — Outils d'analyse approfondie (anomalies, audit intégrité).
"""
import json
import logging
import calendar
import statistics as _stats
from datetime import date, timedelta
from typing import List, Optional
from collections import defaultdict
from sqlalchemy.orm import Session

from app.models import (
    Transaction, Account, Category, RecurrenceTemplate,
    Budget, BudgetAllocation, AIFact, OrgUser, ActionHistory, GlobalConfig
)
from app.services.finance_engine import (
    calculate_balances, get_net_worth, calculate_rest_to_live,
    predict_next_paycheck, get_main_account
)
from app.services.history_service import record_action, snapshot_entity
from app.services.chat.tools.read_tools import get_active_recurrence_templates

logger = logging.getLogger(__name__)

def detect_anomalies_and_subscriptions_tool(db: Session) -> dict:
    from app.models import Transaction, Account, RecurrenceTemplate
    from datetime import date, timedelta
    from collections import defaultdict
    import statistics
    from app.services.finance_engine import get_overdraft_warning
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    thirty_days_ago = today - timedelta(days=30)
    
    accounts_map = {a.id: a.name for a in db.query(Account).all()}
    active_templates = get_active_recurrence_templates(db)
    template_descs = {t.description.strip().lower() for t in active_templates if t.description}
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).order_by(Transaction.date_operation.desc(), Transaction.id.desc()).all()
    
    # 1. Subscription & Price Increase Detection
    candidates = defaultdict(list)
    for t in txs:
        if t.type in ("expense_var", "expense_fixed") and t.amount > 3.0:
            candidates[t.description.strip().lower()].append(t)
            
    detected_subs = []
    price_increases = []
    unregistered_subs = []
    
    for desc, items in candidates.items():
        if len(items) >= 3:
            amounts = [i.amount for i in items]
            dates = sorted([i.date_operation for i in items])
            intervals = [(dates[idx] - dates[idx-1]).days for idx in range(1, len(dates))]
            avg_interval = statistics.mean(intervals) if intervals else 0
            
            if 24 <= avg_interval <= 36: # Monthly pattern
                acc_name = accounts_map.get(items[0].from_account_id or items[0].to_account_id, "Compte courant")
                recent_amt = items[0].amount
                sub_entry = {
                    "description": items[0].description,
                    "amount_euros": recent_amt,
                    "annual_cost_euros": round(recent_amt * 12, 2),
                    "account_name": acc_name,
                    "interval_days": round(avg_interval, 1),
                    "frequency": "Monthly",
                    "charges_count_6m": len(items)
                }
                detected_subs.append(sub_entry)
                
                # Check for price increases (compare most recent vs older charges)
                older_amounts = [it.amount for it in items[1:]]
                min_old = min(older_amounts)
                if recent_amt > min_old * 1.05 and (recent_amt - min_old) >= 1.0:
                    delta = round(recent_amt - min_old, 2)
                    pct = round((delta / min_old) * 100, 1)
                    price_increases.append({
                        "description": items[0].description,
                        "old_amount_euros": min_old,
                        "new_amount_euros": recent_amt,
                        "increase_euros": delta,
                        "increase_percent": f"+{pct}%",
                        "account_name": acc_name
                    })
                    
                # Check if unregistered in recurrence templates
                if desc not in template_descs and not any(desc in td or td in desc for td in template_descs):
                    unregistered_subs.append(sub_entry)

    # 2. Recent Spending Spikes (outliers vs category median OR budget envelope ratio)
    from app.models import Budget, BudgetCategory
    budget_cats = db.query(BudgetCategory).all()
    cat_to_budget_obj = {}
    for bc in budget_cats:
        if bc.category_name and bc.budget_id:
            b_obj = db.query(Budget).filter(Budget.id == bc.budget_id, Budget.is_closed == False).first()
            if b_obj:
                cat_to_budget_obj[bc.category_name.strip().lower()] = b_obj

    recent_txs = [t for t in txs if t.date_operation >= thirty_days_ago and t.type in ("expense_var", "expense_fixed")]
    by_cat = defaultdict(list)
    for t in txs:
        if t.category and t.type in ("expense_var", "expense_fixed"):
            by_cat[t.category.strip().lower()].append(t.amount)
            
    recent_spikes = []
    for t in recent_txs:
        cat_key = (t.category or "").strip().lower()
        cat_amounts = by_cat.get(cat_key, [])
        is_spike = False
        spike_detail = {}
        
        # Method A: Historical statistical outlier (>= 5 charges)
        if len(cat_amounts) >= 5 and t.amount > 50.0:
            cat_med = statistics.median(cat_amounts)
            if t.amount > max(cat_med * 3.0, 100.0):
                is_spike = True
                spike_detail = {
                    "detection_basis": "historical_median_outlier",
                    "category_median_euros": round(cat_med, 2),
                    "note": f"Dépense > 3x la médiane habituelle ({cat_med:.2f} €) de la catégorie."
                }
        # Method B: Fallback on Budget Envelope (Cold start / few transactions)
        elif cat_key in cat_to_budget_obj and t.amount >= 50.0:
            b_obj = cat_to_budget_obj[cat_key]
            b_limit = b_obj.monthly_amount or 0.0
            if b_limit > 0 and t.amount >= (0.40 * b_limit):
                pct_env = round((t.amount / b_limit) * 100, 1)
                is_spike = True
                spike_detail = {
                    "detection_basis": "budget_envelope_consumption",
                    "envelope_name": b_obj.name,
                    "envelope_monthly_limit_euros": b_limit,
                    "consumed_envelope_percent": f"{pct_env}%",
                    "note": f"Achat isolé consommant {pct_env}% de l'enveloppe mensuelle '{b_obj.name}'."
                }
                
        if is_spike:
            spike_data = {
                "transaction_id": t.id,
                "date": t.date_operation.isoformat() if t.date_operation else None,
                "description": t.description,
                "amount_euros": t.amount,
                "category": t.category,
            }
            spike_data.update(spike_detail)
            recent_spikes.append(spike_data)

    # 3. Overdraft Warning from Engine
    overdraft_info = None
    try:
        od = get_overdraft_warning(db)
        if od:
            overdraft_info = {
                "will_overdraft": True,
                "projected_date": od["date"].isoformat() if isinstance(od["date"], date) else str(od["date"]),
                "transaction_description": od["transaction_description"],
                "transaction_amount_euros": od["transaction_amount"],
                "projected_negative_balance_euros": od["projected_balance"],
                "transaction_id": od.get("transaction_id")
            }
    except Exception as e:
        logger.warning(f"[detect_anomalies] Error calculating overdraft warning: {e}")

    # 4. Duplicate detection with accounting & bank reconciliation awareness
    duplicates = []
    seen = {}
    for t in txs:
        if t.type in ("expense_var", "expense_fixed"):
            acc_id = t.from_account_id or t.to_account_id
            acc_name = accounts_map.get(acc_id, "Compte courant")
            is_rec = t.reconciliation_date is not None
            key = (acc_id, t.date_operation, t.description.strip().lower(), round(t.amount, 2))
            
            if key in seen:
                orig = seen[key]
                orig_rec = orig.reconciliation_date is not None
                
                if orig_rec and is_rec:
                    continue
                
                if not orig_rec and is_rec:
                    rec_status = "one_unreconciled_phantom_one_bank"
                    target_delete_id = orig.id
                    accounting_advice = (
                        f"Saisie manuelle/prévisionnelle #{orig.id} en doublon avec l'opération bancaire réelle #{t.id} sur {acc_name}. "
                        f"La suppression de la saisie manuelle #{orig.id} nettoiera le doublon sans impacter le solde bancaire officiel."
                    )
                elif orig_rec and not is_rec:
                    rec_status = "one_bank_one_unreconciled_phantom"
                    target_delete_id = t.id
                    accounting_advice = (
                        f"Saisie manuelle/prévisionnelle #{t.id} en doublon avec l'opération bancaire réelle #{orig.id} sur {acc_name}. "
                        f"La suppression de la saisie manuelle #{t.id} nettoiera le doublon sans impacter le solde bancaire officiel."
                    )
                else:
                    rec_status = "both_unreconciled"
                    target_delete_id = t.id
                    accounting_advice = (
                        f"Deux saisies manuelles ou prévisionnelles non rapprochées sur {acc_name}. "
                        f"La suppression de l'une d'elles (#{t.id}) est sûre et évite un double décompte prévisionnel."
                    )
                
                duplicates.append({
                    "original_transaction_id": orig.id,
                    "original_date": orig.date_operation.isoformat(),
                    "original_is_reconciled": orig_rec,
                    "duplicate_transaction_id": t.id,
                    "duplicate_date": t.date_operation.isoformat(),
                    "duplicate_is_reconciled": is_rec,
                    "target_unreconciled_id_to_delete": target_delete_id,
                    "account_name": acc_name,
                    "description": t.description,
                    "amount_euros": t.amount,
                    "reconciliation_status": rec_status,
                    "accounting_advice": accounting_advice
                })
            else:
                seen[key] = t
                
    return {
        "overdraft_warning": overdraft_info,
        "detected_subscriptions": detected_subs,
        "price_increases_detected": price_increases,
        "unregistered_subscriptions": unregistered_subs,
        "recent_spending_spikes": recent_spikes[:5],
        "potential_duplicate_charges": duplicates
    }

def audit_transactions_integrity_tool(db: Session) -> dict:
    from app.models import Transaction, RecurrenceTemplate
    from datetime import date, timedelta
    
    today = date.today()
    thirty_days_ago = today - timedelta(days=30)
    forty_five_days_ago = today - timedelta(days=45)
    
    # 1. Past unreconciled transactions (> 30 days old)
    past_unreconciled = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < thirty_days_ago,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).limit(20).all()
    
    past_unrec_list = [
        {
            "id": t.id,
            "date": t.date_operation.isoformat() if t.date_operation else None,
            "description": t.description,
            "amount_euros": t.amount,
            "category": t.category,
            "days_overdue": (today - t.date_operation).days if t.date_operation else 0
        }
        for t in past_unreconciled
    ]
    
    # 2. Uncategorized transactions
    uncategorized = db.query(Transaction).filter(
        (Transaction.category == None) | (Transaction.category == "") | (Transaction.category == "Sans catégorie"),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).limit(20).all()
    
    uncat_list = [
        {
            "id": t.id,
            "date": t.date_operation.isoformat() if t.date_operation else None,
            "description": t.description,
            "amount_euros": t.amount,
            "type": t.type
        }
        for t in uncategorized
    ]
    
    # 3. Suspicious or inverted transactions
    suspicious = []
    recent_txs = db.query(Transaction).filter(
        Transaction.date_operation >= today - timedelta(days=90),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    
    for t in recent_txs:
        issue = None
        if t.amount is None or t.amount <= 0:
            issue = "Montant nul ou négatif invalide"
        elif t.type == "income" and any(k in (t.description or "").lower() for k in ["retrait", "carte", "cb ", "paiement", "prelevement"]):
            issue = "Recette potentiellement classée par erreur en débit"
        elif t.type in ("expense_var", "expense_fixed") and any(k in (t.description or "").lower() for k in ["salaire", "remboursement", "virement reçu", "caf", "cpam"]):
            issue = "Dépense potentiellement classée par erreur (semble être un revenu ou remboursement)"
            
        if issue:
            suspicious.append({
                "id": t.id,
                "date": t.date_operation.isoformat() if t.date_operation else None,
                "description": t.description,
                "amount_euros": t.amount,
                "current_type": t.type,
                "potential_issue": issue
            })

    # 4. Missing expected recurring charges
    active_templates = get_active_recurrence_templates(db, template_types=("expense_fixed", "expense_var"))
    
    missing_recurrences = []
    for tpl in active_templates:
        tx_found = db.query(Transaction).filter(
            Transaction.date_operation >= forty_five_days_ago,
            (Transaction.recurrence_id == tpl.id) | (Transaction.description.ilike(f"%{tpl.description}%"))
        ).first()
        if not tx_found:
            missing_recurrences.append({
                "template_id": tpl.id,
                "description": tpl.description,
                "expected_amount_euros": tpl.amount,
                "frequency": tpl.frequency,
                "day_of_month": tpl.day_of_month,
                "note": "Aucun débit constaté sur les 45 derniers jours pour ce modèle récurrent actif."
            })
            
    return {
        "summary": {
            "unreconciled_past_count": len(past_unrec_list),
            "uncategorized_count": len(uncat_list),
            "suspicious_entries_count": len(suspicious),
            "missing_recurring_charges_count": len(missing_recurrences)
        },
        "unreconciled_past_transactions": past_unrec_list,
        "uncategorized_transactions": uncat_list,
        "suspicious_transactions": suspicious[:10],
        "missing_recurring_charges": missing_recurrences
    }

