from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
def get_setup_status(db: Session = Depends(get_db)):
    """Check if initial setup is needed (no accounts = first launch or DB wiped)."""
    has_accounts = db.query(Account).first() is not None
    return {"needs_setup": not has_accounts}


@router.post("/seed-demo")
def seed_demo_data(db: Session = Depends(get_db)):
    """Injecte un jeu de données de démonstration propre et représentatif."""
    from datetime import date, timedelta
    from app.models import (
        Account, Category, RecurrenceTemplate, Transaction, Budget, BudgetCategory, GlobalConfig
    )
    from app.services import stats_cache

    # 1. Comptes
    cc = db.query(Account).filter(Account.name == "Compte Courant").first()
    if not cc:
        cc = Account(name="Compte Courant", type="Compte courant", initial_balance=2450.0, color="#3366ff", currency="EUR")
        db.add(cc)
    livret = db.query(Account).filter(Account.name == "Livret A").first()
    if not livret:
        livret = Account(name="Livret A", type="Livret", initial_balance=8500.0, color="#36b37e", currency="EUR")
        db.add(livret)
    db.commit()
    db.refresh(cc)
    db.refresh(livret)

    # Compte principal
    from app.routers.stats import set_main_account
    try:
        set_main_account(cc.id, db=db)
    except Exception:
        pass

    # 2. Catégories clés
    demo_cats = [
        ("Logement", "expense_fixed"),
        ("Abonnements", "expense_fixed"),
        ("Alimentation", "expense_var"),
        ("Transports", "expense_var"),
        ("Loisirs & Sorties", "expense_var"),
        ("Santé", "expense_var"),
        ("Salaire", "income"),
        ("Épargne", "transfer")
    ]
    for c_name, c_type in demo_cats:
        exists = db.query(Category).filter(Category.name == c_name).first()
        if not exists:
            db.add(Category(name=c_name, type=c_type))
    db.commit()

    # 3. Enveloppes budgétaires
    b_alim = db.query(Budget).filter(Budget.name == "Alimentation").first()
    if not b_alim:
        b_alim = Budget(name="Alimentation", monthly_amount=450.0, envelope_type="spending", period="monthly")
        db.add(b_alim)
        db.commit()
        db.refresh(b_alim)
        db.add(BudgetCategory(budget_id=b_alim.id, category_name="Alimentation"))
    
    b_loisirs = db.query(Budget).filter(Budget.name == "Loisirs").first()
    if not b_loisirs:
        b_loisirs = Budget(name="Loisirs", monthly_amount=200.0, envelope_type="spending", period="monthly")
        db.add(b_loisirs)
        db.commit()
        db.refresh(b_loisirs)
        db.add(BudgetCategory(budget_id=b_loisirs.id, category_name="Loisirs & Sorties"))
    db.commit()

    # 4. Modèles de récurrence
    today = date.today()
    templates = [
        ("Salaire Entreprise", 2800.0, "income", "Salaire", "Monthly", 28, None, cc.id),
        ("Loyer Appartement", -850.0, "expense_fixed", "Logement", "Monthly", 5, cc.id, None),
        ("Fibre Internet & Mobile", -49.99, "expense_fixed", "Abonnements", "Monthly", 12, cc.id, None),
        ("Électricité & Énergie", -75.0, "expense_fixed", "Logement", "Monthly", 15, cc.id, None),
        ("Virement Épargne Livret A", 200.0, "transfer", "Épargne", "Monthly", 29, cc.id, livret.id),
    ]
    for desc, amt, t_type, cat, freq, day, from_acc, to_acc in templates:
        exists = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.description == desc).first()
        if not exists:
            db.add(RecurrenceTemplate(
                description=desc, amount=amt, type=t_type, category=cat,
                frequency=freq, day_of_month=day, from_account_id=from_acc, to_account_id=to_acc
            ))
    db.commit()

    # 5. Quelques transactions réelles passées pour animer les graphiques
    sample_txs = [
        (today - timedelta(days=2), "Courses Supermarché Bio", -68.40, "expense_var", "Alimentation", cc.id, b_alim.id),
        (today - timedelta(days=4), "Boulangerie & Épicerie", -14.20, "expense_var", "Alimentation", cc.id, b_alim.id),
        (today - timedelta(days=5), "Cinéma & Sortie", -28.00, "expense_var", "Loisirs & Sorties", cc.id, b_loisirs.id),
        (today - timedelta(days=7), "Plein Essence Station", -62.50, "expense_var", "Transports", cc.id, None),
        (today - timedelta(days=10), "Pharmacie & Soins", -18.90, "expense_var", "Santé", cc.id, None),
        (today - timedelta(days=12), "Restaurant Italien", -45.00, "expense_var", "Loisirs & Sorties", cc.id, b_loisirs.id),
    ]
    for d_op, desc, amt, t_type, cat, acc_id, bud_id in sample_txs:
        t_exist = db.query(Transaction).filter(
            Transaction.date_operation == d_op,
            Transaction.description == desc
        ).first()
        if not t_exist:
            db.add(Transaction(
                date_operation=d_op, description=desc, amount=amt,
                type=t_type, category=cat, from_account_id=acc_id,
                budget_id=bud_id, reconciliation_date=d_op
            ))
    db.commit()

    # 6. Config générale
    for k, v in [
        ("base_pay_day", "28"),
        ("base_pay_amount", "2800.00"),
        ("base_currency", "EUR"),
        ("enable_overview", "true")
    ]:
        cfg = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
        if cfg:
            cfg.value = v
        else:
            db.add(GlobalConfig(key=k, value=v))
    db.commit()

    # 7. Génération des récurrences
    try:
        from app.routers.recurrences import generate_recurrences
        generate_recurrences(db=db)
    except Exception:
        pass

    stats_cache.invalidate()
    return {"ok": True, "message": "Jeu de données de démonstration initialisé avec succès."}

