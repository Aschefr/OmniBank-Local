"""Profil qui démarre : les catégories sont créées par l'IA (quota élargi) ou, sans IA, par mots-clés ; un fourre-tout
n'est jamais tenu pour sûr ; le salaire déclaré sert à reconnaître la paie sans créer d'opération."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Category, GlobalConfig, Transaction
from app.services.chat import ollama_client
from app.services.smart_label import resolver
from app.services.smart_label.categories import starter_category_for


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Category(name="Dépenses diverses", type="expense_var"), Category(name="Revenus divers", type="income")])
    s.commit()
    yield s
    s.close()


@pytest.mark.parametrize("label,tx_type,expected", [
    ("CB UEP*ALIM SUPER U LYON", "expense_var", "Courses"),
    ("CB UEP*DAC SUPER U LYON", "expense_var", "Carburant"),
    ("DIRECTION GENERALE DES FINANCES", "expense_var", "Impôts"),
    ("Free Telecom", "expense_var", "Télécoms et internet"),
    ("FULLI - PEAGES", "expense_var", "Péages et parking"),
    ("ASSU. MAIF HABITATION", "expense_var", "Assurances"),
    ("00000012345 ECHEANCE", "expense_var", "Prêts et crédits"),
    ("Remboursement cotisation carte", "income", "Remboursements"),
    ("CB DR MARTIN CABINET", "expense_var", "Santé"),
    ("Wero vers JEAN D", "expense_var", "Virements envoyés"),
    ("VIR INST DE M. DUPONT", "income", "Virements reçus"),
    ("SPB", "expense_var", "Assurances"),
])
def test_starter_keywords(label, tx_type, expected):
    found = starter_category_for(label, tx_type)
    assert (found[0] if found else None) == expected


def test_without_ai_keywords_create_categories_to_be_checked(db):
    res = resolver.resolve_smart_labels_batch(
        db, ["CB UEP*ALIM SUPER U LYON", "Wero vers JEAN D"],
        tx_types={"CB UEP*ALIM SUPER U LYON": "expense_var", "Wero vers JEAN D": "expense_var"},
        use_ai_fallback=True, auto_fallback_category=True,
    )
    shop = res["CB UEP*ALIM SUPER U LYON"]
    assert shop["category"] == "Courses" and shop["source"] == "keyword"
    assert shop["smart_is_new_category"] is True and shop["confidence"] < 0.85
    assert res["Wero vers JEAN D"]["category"] == "Virements envoyés"


def test_with_ai_on_a_starting_profile_the_model_may_create_many_categories(db, monkeypatch):
    db.add_all([GlobalConfig(key="enable_ai", value="true"), GlobalConfig(key="ollama_url", value="http://ollama.test:11434"),
                GlobalConfig(key="ollama_model", value="bonsai-2:27b")])
    db.commit()
    seen = {}

    def fake_batch(descriptions, categories, cfg=None, user_habits=None, suggest_names=False, **kw):
        seen.update(kw)
        return {d: {"name": d, "category": "Dépenses diverses" if "Wero" in d else "Courses", "category_is_new": "Wero" not in d}
                for d in descriptions}

    monkeypatch.setattr(ollama_client, "call_ollama_batch", fake_batch)
    labels = {"CB SUPER U": "expense_var", "Wero vers JEAN D": "expense_var"}
    res = resolver.resolve_smart_labels_batch(db, list(labels), tx_types=labels, use_ai_fallback=True, auto_fallback_category=True)
    assert seen["starting_profile"] is True and seen["max_new_categories"] >= 10
    assert res["CB SUPER U"]["category"] == "Courses" and res["CB SUPER U"]["source"] == "ai"
    # Le fourre-tout choisi par l'IA n'est pas tenu pour sûr
    wero = res["Wero vers JEAN D"]
    assert wero["smart_is_fallback"] is True and wero["confidence"] < 0.85


def test_batch_parsing_merges_a_category_created_earlier_in_the_same_batch():
    raw = '{"A": {"name": "A", "category": "Courses"}, "B": {"name": "B", "category": "Course"}, "C": {"name": "C", "category": "Carburant"}}'
    res = ollama_client._parse_and_validate_batch_response(raw, ["A", "B", "C"], ["Dépenses diverses"], suggest_names=True, max_new_categories=15)
    assert res["A"]["category"] == "Courses" and res["B"]["category"] == "Courses"
    assert res["C"]["category"] == "Carburant" and res["C"]["category_is_new"] is True


def test_declared_pay_creates_nothing_and_is_used_to_recognise_the_salary(db):
    from app.services.finance_engine import predict_next_paycheck
    acc = Account(name="Compte", type="Compte courant", initial_balance=0)
    db.add(acc)
    db.add_all([GlobalConfig(key="base_pay_day", value="28"), GlobalConfig(key="base_pay_amount", value="2400.00")])
    db.commit()
    pay = predict_next_paycheck(db)
    assert pay["amount"] == 2400.0
    assert db.query(Transaction).count() == 0

    # Une vraie paie autour du jour déclaré est reconnue et prend le pas sur le montant déclaré
    today = date.today()
    m = today.month - 1 or 12
    y = today.year if today.month > 1 else today.year - 1
    db.add(Transaction(date_operation=date(y, m, 28) + timedelta(days=2), amount=2487.68, type="income", to_account_id=acc.id,
                       description="ACME SAS", category="Revenus divers", reconciliation_date=date(y, m, 28) + timedelta(days=2)))
    db.commit()
    assert predict_next_paycheck(db)["amount"] == 2487.68


def test_unambiguous_keywords_come_before_the_ai_and_reuse_the_users_categories(db, monkeypatch):
    """« UEP*DAC » est une pompe à carburant : les modèles testés le classaient en courses. Le mot-clé passe avant
    l'IA, tenu pour sûr, et retrouve la catégorie équivalente de l'utilisateur au lieu d'en créer une autre."""
    db.add_all([GlobalConfig(key="enable_ai", value="true"), GlobalConfig(key="ollama_url", value="http://ollama.test:11434"),
                GlobalConfig(key="ollama_model", value="m")])
    db.commit()
    asked = []

    def fake(descriptions, categories, cfg=None, user_habits=None, suggest_names=False, **kw):
        asked.extend(descriptions)
        return {d: {"name": d, "category": "Courses", "category_is_new": True} for d in descriptions}

    monkeypatch.setattr(ollama_client, "call_ollama_batch", fake)
    labels = {"CB UEP*DAC SUPER U LYON": "expense_var", "FULLI - PEAGES": "expense_var", "CB UEP*ALIM SUPER U LYON": "expense_var"}
    res = resolver.resolve_smart_labels_batch(db, list(labels), tx_types=labels, use_ai_fallback=True, auto_fallback_category=True)
    assert res["CB UEP*DAC SUPER U LYON"]["category"] == "Carburant" and res["CB UEP*DAC SUPER U LYON"]["confidence"] >= 0.85
    assert res["FULLI - PEAGES"]["category"] == "Péages et parking"
    assert res["CB UEP*ALIM SUPER U LYON"]["source"] == "ai"  # le reste va à l'IA
    assert not any("Dac" in d or "Fulli" in d for d in asked)

    from app.services.smart_label.categories import strong_category_for
    assert strong_category_for(db, "RETRAIT DAB 05/11 LYON", "expense_var") == ("Retraits", True)

    db.add_all([Category(name="Essence", type="expense_var"), Category(name="Péage tickets", type="expense_var")])
    db.commit()
    res = resolver.resolve_smart_labels_batch(db, ["CB UEP*DAC SUPER U LYON", "FULLI - PEAGES"],
                                              tx_types={"CB UEP*DAC SUPER U LYON": "expense_var", "FULLI - PEAGES": "expense_var"})
    assert res["CB UEP*DAC SUPER U LYON"]["category"] == "Essence" and not res["CB UEP*DAC SUPER U LYON"]["smart_is_new_category"]
    assert res["FULLI - PEAGES"]["category"] == "Péage tickets"


def test_starting_profile_hides_the_catch_alls_from_the_ai_and_guards_income_categories(db, monkeypatch):
    """Avec quelques catégories déjà créées par les mots-clés, l'IA rangeait tout dans « Dépenses diverses ». Sur un
    profil qui démarre, les fourre-tout ne lui sont plus proposés ; et un revenu ne prend pas une catégorie qui décrit
    le métier de celui qui paie (un salaire classé « Matériaux »)."""
    db.add_all([Category(name="Carburant", type="expense_var"), GlobalConfig(key="enable_ai", value="true"),
                GlobalConfig(key="ollama_url", value="http://ollama.test:11434"), GlobalConfig(key="ollama_model", value="m")])
    db.commit()
    offered = {}

    def fake(descriptions, categories, cfg=None, user_habits=None, suggest_names=False, **kw):
        offered["categories"] = list(categories)
        cats = {"Acme Sas": "Matériaux", "Remboursement": "Remboursements", "Cb Super U": "Courses"}
        return {d: {"name": d, "category": cats.get(d, "Courses"), "category_is_new": True} for d in descriptions}

    monkeypatch.setattr(ollama_client, "call_ollama_batch", fake)
    types = {"ACME SAS": "income", "REMBOURSEMENT": "income", "CB SUPER U": "expense_var"}
    res = resolver.resolve_smart_labels_batch(db, list(types), tx_types=types, use_ai_fallback=True, auto_fallback_category=True)
    assert "Dépenses diverses" not in offered["categories"] and "Revenus divers" not in offered["categories"]
    assert res["ACME SAS"]["category"] == "Revenus divers" and res["ACME SAS"]["smart_is_fallback"] is True
    assert res["REMBOURSEMENT"]["category"] == "Remboursements"
    assert res["CB SUPER U"]["category"] == "Courses"


def test_keywords_take_over_when_the_ai_is_enabled_but_unreachable(db, monkeypatch):
    """IA activée mais serveur injoignable (« Connection refused ») : call_ollama_batch rend un lot sans catégorie.
    Les mots-clés de départ prennent alors le relais au lieu de tout laisser dans le fourre-tout."""
    db.add_all([GlobalConfig(key="enable_ai", value="true"), GlobalConfig(key="ollama_url", value="http://127.0.0.1:11434"),
                GlobalConfig(key="ollama_model", value="m")])
    db.commit()
    monkeypatch.setattr(ollama_client, "call_ollama_batch",
                        lambda descriptions, categories, **kw: {d: {"name": None, "category": None} for d in descriptions})
    types = {"CB UEP*ALIM SUPER U LYON": "expense_var", "Wero vers JEAN D": "expense_var"}
    res = resolver.resolve_smart_labels_batch(db, list(types), tx_types=types, use_ai_fallback=True, auto_fallback_category=True)
    assert res["CB UEP*ALIM SUPER U LYON"]["category"] == "Courses" and res["CB UEP*ALIM SUPER U LYON"]["source"] == "keyword"
    assert res["Wero vers JEAN D"]["category"] == "Virements envoyés"
