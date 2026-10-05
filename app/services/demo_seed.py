"""Jeu de données de démonstration enrichi + remise à zéro sélective (wizard d'accueil).

Principes :
- Les montants sont stockés en valeur absolue ; le sens est porté par from/to_account_id.
- Déterministe (graine fixe) et idempotent : un manifeste JSON (GlobalConfig `demo_seed_manifest`)
  liste précisément ce que la démo a créé, ce qui permet de ne supprimer que ces éléments.
- Les comptes / catégories déjà présents (créés par l'utilisateur) sont réutilisés mais jamais
  marqués « démo », donc jamais supprimés par le reset.
"""
import json
import random
from datetime import date

from dateutil.relativedelta import relativedelta
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    Account, AutopilotDecisionLog, Budget, BudgetAllocation, BudgetCategory,
    Category, GlobalConfig, RecurrenceTemplate, Transaction,
)

MANIFEST_KEY = "demo_seed_manifest"
DEMO_FLAG_KEY = "demo_mode_active"
DEMO_BATCH_ID = "demo-seed"
DEMO_CSV_PREFIX = "demo-"


def _get_cfg(db: Session, key: str):
    return db.query(GlobalConfig).filter(GlobalConfig.key == key).first()


def _set_cfg(db: Session, key: str, value: str) -> None:
    row = _get_cfg(db, key)
    if row:
        row.value = value
    else:
        db.add(GlobalConfig(key=key, value=value))


def is_demo_active(db: Session) -> bool:
    row = _get_cfg(db, DEMO_FLAG_KEY)
    return bool(row and row.value == "true")


def _load_manifest(db: Session) -> dict:
    row = _get_cfg(db, MANIFEST_KEY)
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except (ValueError, TypeError):
        return {}


def seed_demo(db: Session) -> dict:
    """Injecte la démo enrichie. Retourne un résumé (comptes, opérations...)."""
    if _load_manifest(db):
        return {"ok": True, "already_seeded": True, "message": "Données de démonstration déjà présentes."}

    rng = random.Random(42)
    today = date.today()
    manifest = {"accounts": [], "categories": [], "budgets": [], "templates": [], "config_keys": []}

    # ── 1. Comptes ────────────────────────────────────────────────
    def ensure_account(name, typ, balance, color, **extra):
        acc = db.query(Account).filter(Account.name == name).first()
        if acc:
            return acc
        acc = Account(name=name, type=typ, initial_balance=balance, color=color, currency="EUR", **extra)
        db.add(acc)
        db.flush()
        manifest["accounts"].append(acc.id)
        return acc

    cc = ensure_account("Compte Courant", "Compte courant", 1850.0, "#3366ff")
    livret = ensure_account("Livret A", "Livret", 8500.0, "#36b37e", interest_rate=1.7)
    projet = ensure_account("Épargne Projet Vacances", "Livret", 600.0, "#ffab00", interest_rate=2.0)
    pea = ensure_account("PEA Long Terme", "PEA", 4200.0, "#6554c0")

    from app.routers.stats import set_main_account
    if not _get_cfg(db, "main_account_id"):
        try:
            set_main_account(cc.id, db=db)
        except Exception:
            pass

    # ── 2. Catégories ────────────────────────────────────────────
    cats = [
        ("Logement", "expense_fixed"), ("Énergie", "expense_fixed"), ("Abonnements", "expense_fixed"),
        ("Assurances", "expense_fixed"), ("Mutuelle", "expense_fixed"), ("Sport", "expense_fixed"),
        ("Alimentation", "expense_var"), ("Transports", "expense_var"),
        ("Loisirs & Sorties", "expense_var"), ("Santé", "expense_var"), ("Shopping", "expense_var"),
        ("Restaurants", "expense_var"), ("Cadeaux", "expense_var"),
        ("Salaire", "income"), ("Remboursements", "income"), ("Primes", "income"),
        ("Épargne", "transfer"), ("Investissement", "transfer"),
    ]
    for name, typ in cats:
        if not db.query(Category).filter(Category.name == name).first():
            c = Category(name=name, type=typ)
            db.add(c)
            db.flush()
            manifest["categories"].append(c.id)

    # ── 3. Enveloppes budgétaires ────────────────────────────────
    def ensure_budget(name, amount, cat_names, **extra):
        b = db.query(Budget).filter(Budget.name == name).first()
        if b:
            return b
        b = Budget(name=name, monthly_amount=amount, envelope_type=extra.pop("envelope_type", "spending"),
                   period=extra.pop("period", "monthly"), **extra)
        db.add(b)
        db.flush()
        manifest["budgets"].append(b.id)
        for cn in cat_names:
            db.add(BudgetCategory(budget_id=b.id, category_name=cn))
        return b

    b_alim = ensure_budget("Alimentation", 380.0, ["Alimentation"])          # sera dépassée ce mois-ci
    b_loisirs = ensure_budget("Loisirs", 220.0, ["Loisirs & Sorties"])       # sous-consommée
    b_resto = ensure_budget("Restaurants", 120.0, ["Restaurants"])
    b_transport = ensure_budget("Transports", 150.0, ["Transports"])
    b_sante = ensure_budget("Santé", 60.0, ["Santé"])
    b_vac = ensure_budget("Vacances d'été", 2500.0, [], envelope_type="savings", period="indefinite", is_project=True)

    for i, amt in enumerate([300.0, 250.0, 300.0, 200.0]):
        d = today - relativedelta(months=3 - i)
        db.add(BudgetAllocation(budget_id=b_vac.id, amount=amt, date=d.replace(day=min(d.day, 28)),
                                note="Mise de côté", account_id=projet.id))

    # ── 4. Modèles de récurrence ─────────────────────────────────
    #  (clé, description, montant, type, catégorie, jour, from, to)
    tpl_defs = [
        ("salaire", "Salaire Entreprise", 2800.0, "income", "Salaire", 28, None, cc.id),
        ("loyer", "Loyer Appartement", 850.0, "expense_fixed", "Logement", 5, cc.id, None),
        ("internet", "Fibre Internet & Mobile", 49.99, "expense_fixed", "Abonnements", 12, cc.id, None),
        ("elec", "Électricité & Énergie", 75.0, "expense_fixed", "Énergie", 15, cc.id, None),
        ("netflix", "Netflix", 13.49, "expense_fixed", "Abonnements", 8, cc.id, None),
        ("spotify", "Spotify", 10.99, "expense_fixed", "Abonnements", 20, cc.id, None),
        ("salle", "Salle de sport", 29.90, "expense_fixed", "Sport", 3, cc.id, None),
        ("assur", "Assurance Habitation", 18.40, "expense_fixed", "Assurances", 10, cc.id, None),
        ("mutuelle", "Mutuelle Santé", 42.00, "expense_fixed", "Mutuelle", 18, cc.id, None),
        ("epargne", "Virement Épargne Livret A", 200.0, "transfer", "Épargne", 29, cc.id, livret.id),
        ("vacances", "Virement Épargne Vacances", 100.0, "transfer", "Épargne", 27, cc.id, projet.id),
        ("pea", "Versement PEA", 150.0, "transfer", "Investissement", 2, cc.id, pea.id),
    ]
    tpls = {}
    for key, desc, amt, typ, cat, day, f_acc, t_acc in tpl_defs:
        t = RecurrenceTemplate(description=desc, amount=amt, type=typ, category=cat, frequency="Monthly",
                               day_of_month=day, from_account_id=f_acc, to_account_id=t_acc)
        db.add(t)
        db.flush()
        tpls[key] = t
        manifest["templates"].append(t.id)

    # ── 5. Historique sur 6 mois ─────────────────────────────────
    seq = {"n": 0}

    def add_tx(d, desc, amt, typ, cat, f_acc=None, t_acc=None, tpl=None, bud=None,
               reconciled=True, review=False, conf=None):
        if d > today:
            return None
        seq["n"] += 1
        tx = Transaction(
            csv_id=f"{DEMO_CSV_PREFIX}{seq['n']:04d}", date_saisie=d, date_operation=d, description=desc,
            amount=round(abs(amt), 2), type=typ, category=cat, from_account_id=f_acc, to_account_id=t_acc,
            recurrence_id=tpl.id if tpl else None, budget_id=bud.id if bud else None,
            is_monthly=bool(tpl), reconciliation_date=d if reconciled else None,
            needs_review=review, confidence_score=conf,
        )
        db.add(tx)
        return tx

    def on_day(month_offset, day):
        base = date(today.year, today.month, 1) - relativedelta(months=month_offset)
        return base + relativedelta(day=min(day, 28))

    recent_cut = today - relativedelta(days=7)
    for m in range(6, -1, -1):
        for key, desc, amt, typ, cat, day, f_acc, t_acc in tpl_defs:
            d = on_day(m, day)
            real_amt = amt
            if key == "elec":
                real_amt = round(amt * rng.uniform(0.85, 1.20), 2)          # montant déviant
            if key == "netflix" and m <= 2:
                real_amt = 15.99                                              # hausse tarifaire x3
            if key == "mutuelle" and m <= 1:
                continue                                                      # 2 échéances jamais prélevées
            if key == "salaire" and m == 0 and d > today:
                continue
            add_tx(d, desc, real_amt, typ, cat, f_acc, t_acc, tpls[key], reconciled=d <= recent_cut)

        # Dépenses variables
        n_groc = 7 if m != 0 else 8
        for _ in range(n_groc):
            d = on_day(m, rng.randint(1, 28))
            amt = rng.uniform(18, 62) if m != 0 else rng.uniform(45, 85)     # mois en cours : dépassement
            add_tx(d, rng.choice(["Courses Supermarché", "Boulangerie & Épicerie", "Marché Bio", "Drive Courses"]),
                   amt, "expense_var", "Alimentation", cc.id, bud=b_alim, reconciled=d <= recent_cut)
        for _ in range(2):
            d = on_day(m, rng.randint(1, 28))
            add_tx(d, "Plein Essence Station", rng.uniform(48, 72), "expense_var", "Transports", cc.id,
                   bud=b_transport, reconciled=d <= recent_cut)
        for _ in range(rng.randint(1, 2)):
            d = on_day(m, rng.randint(1, 28))
            add_tx(d, rng.choice(["Cinéma & Sortie", "Concert", "Bowling entre amis"]),
                   rng.uniform(14, 36), "expense_var", "Loisirs & Sorties", cc.id, bud=b_loisirs,
                   reconciled=d <= recent_cut)
        for _ in range(rng.randint(1, 3)):
            d = on_day(m, rng.randint(1, 28))
            add_tx(d, rng.choice(["Restaurant Italien", "Brasserie du Coin", "Sushi Bar"]),
                   rng.uniform(22, 58), "expense_var", "Restaurants", cc.id, bud=b_resto,
                   reconciled=d <= recent_cut)
        if m in (5, 3, 1, 0):
            d = on_day(m, rng.randint(1, 28))
            add_tx(d, "Pharmacie & Soins", rng.uniform(9, 34), "expense_var", "Santé", cc.id, bud=b_sante,
                   reconciled=d <= recent_cut)
        if m in (4, 2):
            d = on_day(m, rng.randint(1, 28))
            add_tx(d, "Boutique Vêtements", rng.uniform(45, 110), "expense_var", "Shopping", cc.id,
                   reconciled=True)
        if m == 3:
            add_tx(on_day(m, 15), "Remboursement Mutuelle", 64.50, "income", "Remboursements", None, cc.id)
        if m == 2:
            add_tx(on_day(m, 20), "Prime Exceptionnelle", 500.0, "income", "Primes", None, cc.id)
        if m == 1:
            add_tx(on_day(m, 12), "Cadeau Anniversaire", 55.0, "expense_var", "Cadeaux", cc.id)

    # Opérations arrivées du « sas » : non pointées, à relire
    review_items = [
        (1, "CB AMZN MKTP FR*2K4", 37.90, "Shopping", 72.0),
        (2, "PRLV SEPA SALLE FIT PLUS", 29.90, "Sport", 64.0),
        (4, "CB BOULANGERIE DUPONT", 6.80, "Alimentation", 78.0),
    ]
    review_tx = []
    for days_ago, raw, amt, cat, conf in review_items:
        d = today - relativedelta(days=days_ago)
        tx = add_tx(d, raw.title(), amt, "expense_var", cat, cc.id, reconciled=False, review=True, conf=conf)
        if tx:
            tx.raw_description = raw
            review_tx.append(tx)
    db.flush()

    # ── 6. Journal Auto-Pilote ───────────────────────────────────
    sample_recon = db.query(Transaction).filter(
        Transaction.csv_id.like(f"{DEMO_CSV_PREFIX}%"), Transaction.recurrence_id == tpls["loyer"].id
    ).order_by(Transaction.date_operation.desc()).first()
    if sample_recon:
        db.add(AutopilotDecisionLog(
            batch_id=DEMO_BATCH_ID, decision_type="reconciliation", action="AUTO_COMMIT",
            entity_type="transaction", entity_id=sample_recon.id, conn_id=-1, account_id=cc.id,
            confidence_score=97.0))
    for tx in review_tx:
        db.add(AutopilotDecisionLog(
            batch_id=DEMO_BATCH_ID, decision_type="new_entry", action="SUGGESTED",
            entity_type="transaction", entity_id=tx.id, conn_id=-1, account_id=cc.id,
            confidence_score=tx.confidence_score))
    db.add(AutopilotDecisionLog(
        batch_id=DEMO_BATCH_ID, decision_type="budget_recalibration", action="SUGGESTED",
        entity_type="budget", entity_id=b_alim.id, conn_id=-1, account_id=cc.id, confidence_score=88.0))
    db.add(AutopilotDecisionLog(
        batch_id=DEMO_BATCH_ID, decision_type="recurrence_promotion", action="SUGGESTED",
        entity_type="recurrence_template", entity_id=tpls["netflix"].id, conn_id=-1, account_id=cc.id,
        confidence_score=91.0))

    # ── 7. Config générale ───────────────────────────────────────
    for k, v in [("base_pay_day", "28"), ("base_pay_amount", "2800.00"), ("base_currency", "EUR"),
                 ("enable_overview", "true")]:
        if not _get_cfg(db, k):
            manifest["config_keys"].append(k)
        _set_cfg(db, k, v)
    _set_cfg(db, DEMO_FLAG_KEY, "true")
    _set_cfg(db, MANIFEST_KEY, json.dumps(manifest))
    db.commit()

    # ── 8. Échéances à venir ─────────────────────────────────────
    try:
        from app.routers.recurrences import generate_recurrences
        generate_recurrences(db=db)
    except Exception:
        pass

    from app.services import stats_cache
    stats_cache.invalidate()
    n_tx = db.query(Transaction).filter(Transaction.csv_id.like(f"{DEMO_CSV_PREFIX}%")).count()
    return {"ok": True, "accounts": len(manifest["accounts"]), "transactions": n_tx,
            "message": "Jeu de données de démonstration initialisé avec succès."}


def reset_demo(db: Session) -> dict:
    """Supprime uniquement les données créées par la démo (via le manifeste)."""
    m = _load_manifest(db)
    acc_ids = m.get("accounts", [])
    cat_ids = m.get("categories", [])
    bud_ids = m.get("budgets", [])
    tpl_ids = m.get("templates", [])

    conds = [Transaction.csv_id.like(f"{DEMO_CSV_PREFIX}%")]
    if tpl_ids:
        conds.append(Transaction.recurrence_id.in_(tpl_ids))
    if acc_ids:
        conds.append(Transaction.from_account_id.in_(acc_ids))
        conds.append(Transaction.to_account_id.in_(acc_ids))
    if bud_ids:
        conds.append(Transaction.budget_id.in_(bud_ids))
    removed_tx = db.query(Transaction).filter(or_(*conds)).delete(synchronize_session=False)

    db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.batch_id == DEMO_BATCH_ID).delete(
        synchronize_session=False)
    if bud_ids:
        db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(bud_ids)).delete(synchronize_session=False)
        db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(bud_ids)).delete(synchronize_session=False)
        db.query(Budget).filter(Budget.id.in_(bud_ids)).delete(synchronize_session=False)
    if tpl_ids:
        db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id.in_(tpl_ids)).delete(synchronize_session=False)
    if cat_ids:
        db.query(Category).filter(Category.id.in_(cat_ids)).delete(synchronize_session=False)
    if acc_ids:
        main = _get_cfg(db, "main_account_id")
        if main and main.value.isdigit() and int(main.value) in acc_ids:
            db.delete(main)
        db.query(Account).filter(Account.id.in_(acc_ids)).delete(synchronize_session=False)
    for k in m.get("config_keys", []):
        row = _get_cfg(db, k)
        if row:
            db.delete(row)
    for k in (DEMO_FLAG_KEY, MANIFEST_KEY):
        row = _get_cfg(db, k)
        if row:
            db.delete(row)
    db.commit()

    from app.services import stats_cache
    stats_cache.invalidate()
    remaining = db.query(Account).count()
    return {"ok": True, "removed_transactions": removed_tx, "needs_setup": remaining == 0}
