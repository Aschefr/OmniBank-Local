#!/usr/bin/env python3
"""Étoffe un profil de test (par défaut « Demonstration ») pour les essais des budgets et des suggestions.

Ajoute, sans toucher à l'existant :
- la suite des dépenses libres des catégories déjà présentes, de leur dernière opération à aujourd'hui ;
- six mois d'historique pour de nouvelles catégories libres, choisies pour les cas de test :
  certaines ont leur place dans une enveloppe existante (Café & Bar, Primeur & Marché, Péages & Parking,
  Jeux vidéo & Applis), d'autres appellent une nouvelle enveloppe (Bricolage & Jardin, Beauté & Coiffure,
  Pharmacie), d'autres sont ponctuelles (Cadeaux, Vacances & Voyages) ;
- un abonnement de salle de sport porté par une récurrence (charge prévue : jamais proposé en enveloppe) ;
- quelques recettes ponctuelles (remboursement, vente).

Tout ce qui est créé est marqué (csv_id « enrich-… », manifeste dans global_config) : relancer le script
régénère le jeu jusqu'à la date du jour, `--remove` le retire.

À lancer dans le conteneur, qui a le code de l'application et les bases des profils :
    docker exec -i omnibank-local-api-1 python - --profile p_bfa7acea < scripts/enrich_demo_profile.py
"""
import argparse
import json
import random
import sys
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

sys.path.insert(0, "/app")

MANIFEST_KEY = "demo_enrich_manifest"
PREFIX = "enrich-"
ACCOUNT_ID = 1  # compte courant du profil de démonstration

# (catégorie, type, opérations par mois, montant min, max, libellés)
CONTINUED = [
    ("Alimentation", "expense_var", 4.3, 55, 115, ["Courses E.Leclerc", "Carrefour Market", "Lidl", "Drive Auchan"]),
    ("Boulangerie & Pâtisserie", "expense_var", 7, 2.8, 9.5, ["Boulangerie Tradition", "Pâtisserie des Gourmands", "Boulangerie du Marché"]),
    ("Restauration & Sorties", "expense_var", 3, 16, 58, ["Pizzeria Napoli", "Sushi Shop", "Brasserie du Parc", "Burger & Co"]),
    ("Transport & Carburant", "expense_var", 2, 48, 74, ["Station TotalEnergies - Carburant", "Intermarché Carburant"]),
    ("Loisirs & Culture", "expense_var", 2, 10, 45, ["Cinéma Pathé", "Fnac - Livres", "Bowling Strike"]),
    ("Shopping & Habillement", "expense_var", 1.2, 22, 95, ["Kiabi", "Decathlon", "Zara"]),
    ("Animaux & Vétérinaire", "expense_var", 2, 18, 46, ["Maxi Zoo - Alimentation", "Animalis - Litière"]),
]
NEW = [
    ("Café & Bar", "expense_var", 5, 2.5, 14, ["Café de la Gare", "Starbucks", "Bar Le Central"]),
    ("Primeur & Marché", "expense_var", 3, 9, 28, ["Marché du samedi", "Primeur Au Jardin"]),
    ("Péages & Parking", "expense_var", 2, 2.5, 19, ["Péage A7 - Vinci", "Parking Indigo Centre"]),
    ("Jeux vidéo & Applis", "expense_var", 1, 4.99, 59.99, ["Steam", "Nintendo eShop", "App Store"]),
    ("Bricolage & Jardin", "expense_var", 1, 18, 140, ["Leroy Merlin", "Castorama", "Jardiland"]),
    ("Beauté & Coiffure", "expense_var", 0.7, 26, 48, ["Salon Coiff'Style", "Sephora"]),
    ("Pharmacie", "expense_var", 1, 6, 24, ["Pharmacie du Centre"]),
]
ONE_OFF = [  # (catégorie, mois relatif à aujourd'hui, jour, libellé, montant)
    ("Cadeaux", -5, 19, "Cadeau fête des pères", 45.0),
    ("Cadeaux", -2, 12, "Cadeau anniversaire Léa", 60.0),
    ("Vacances & Voyages", -4, 3, "SNCF Connect - Billets", 186.0),
    ("Vacances & Voyages", -4, 5, "Airbnb - Location", 520.0),
    ("Vacances & Voyages", -3, 9, "Camping Les Pins", 340.0),
    ("Animaux & Vétérinaire", -1, 21, "Clinique vétérinaire - consultation", 68.0),
]
INCOMES = [  # (catégorie, mois relatif, jour, libellé, montant)
    ("Revenus divers", -2, 23, "Vinted - Vente", 35.0),
    ("Remboursement", -1, 15, "Remboursement Sécurité sociale", 16.10),
]
SUBSCRIPTION = ("Sport & Fitness", "Abonnement Basic-Fit", 29.99, 3)  # catégorie, libellé, montant, jour


def remove(db):
    from app.models import Category, GlobalConfig, RecurrenceTemplate, Transaction
    row = db.query(GlobalConfig).filter(GlobalConfig.key == MANIFEST_KEY).first()
    manifest = json.loads(row.value) if row and row.value else {}
    tpl_ids = manifest.get("templates", [])
    n = db.query(Transaction).filter(Transaction.csv_id.like(f"{PREFIX}%")).delete(synchronize_session=False)
    if tpl_ids:
        n += db.query(Transaction).filter(Transaction.recurrence_id.in_(tpl_ids)).delete(synchronize_session=False)
        db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id.in_(tpl_ids)).delete(synchronize_session=False)
    for cid in manifest.get("categories", []):
        cat = db.get(Category, cid)
        if cat and not db.query(Transaction).filter(Transaction.category == cat.name).count():
            db.delete(cat)
    if row:
        db.delete(row)
    db.commit()
    return n


def seed(db, today):
    from app.models import Category, GlobalConfig, RecurrenceTemplate, Transaction
    rng = random.Random(f"omnibank-demo-{today.isoformat()}")
    manifest = {"categories": [], "templates": []}
    seq = {"n": 0}
    recent = today - timedelta(days=7)

    def ensure_category(name, typ):
        cat = db.query(Category).filter(Category.name == name).first()
        if not cat:
            cat = Category(name=name, type=typ)
            db.add(cat)
            db.flush()
            manifest["categories"].append(cat.id)

    def add(d, desc, amount, typ, cat, frm=ACCOUNT_ID, to=None, tpl=None):
        if d > today:
            return
        seq["n"] += 1
        db.add(Transaction(
            csv_id=f"{PREFIX}{seq['n']:05d}", date_saisie=d, date_operation=d, description=desc,
            amount=round(abs(amount), 2), type=typ, category=cat, from_account_id=frm, to_account_id=to,
            recurrence_id=tpl, is_monthly=bool(tpl), reconciliation_date=d if d <= recent else None,
        ))

    def spread(cat, typ, per_month, lo, hi, labels, start):
        """Opérations réparties au hasard, au rythme moyen voulu, de `start` à aujourd'hui."""
        d = start
        mean_gap = 30.0 / per_month
        while True:
            d = d + timedelta(days=max(1, round(rng.uniform(0.5, 1.5) * mean_gap)))
            if d > today:
                break
            add(d, rng.choice(labels), rng.uniform(lo, hi), typ, cat)

    start_new = (today.replace(day=1) - relativedelta(months=6))
    for cat, typ, per_month, lo, hi, labels in CONTINUED:
        last = db.query(Transaction.date_operation).filter(
            Transaction.category == cat, Transaction.date_operation <= today,
            ~Transaction.csv_id.like(f"{PREFIX}%")).order_by(Transaction.date_operation.desc()).first()
        spread(cat, typ, per_month, lo, hi, labels, max(last[0] if last else start_new, start_new))
    for cat, typ, per_month, lo, hi, labels in NEW:
        ensure_category(cat, typ)
        spread(cat, typ, per_month, lo, hi, labels, start_new)
    for cat, months, day, desc, amount in ONE_OFF:
        ensure_category(cat, "expense_var")
        add((today.replace(day=1) + relativedelta(months=months, day=day)), desc, amount, "expense_var", cat)
    for cat, months, day, desc, amount in INCOMES:
        ensure_category(cat, "income")
        add((today.replace(day=1) + relativedelta(months=months, day=day)), desc, amount, "income", cat, frm=None, to=ACCOUNT_ID)

    # Abonnement porté par une récurrence : une charge prévue, même dans une catégorie « libre »
    cat, desc, amount, day = SUBSCRIPTION
    ensure_category(cat, "expense_var")
    tpl = RecurrenceTemplate(description=desc, amount=amount, type="expense_var", category=cat,
                             frequency="Monthly", day_of_month=day, from_account_id=ACCOUNT_ID)
    db.add(tpl)
    db.flush()
    manifest["templates"].append(tpl.id)
    for k in range(5, -1, -1):
        add(today.replace(day=1) - relativedelta(months=k) + relativedelta(day=day), desc, amount, "expense_var", cat, tpl=tpl.id)

    db.add(GlobalConfig(key=MANIFEST_KEY, value=json.dumps(manifest)))
    db.commit()
    try:  # échéances à venir de la nouvelle récurrence
        from app.routers.recurrences import generate_recurrences
        generate_recurrences(db=db)
    except Exception as e:
        print("generate_recurrences:", e)
    return seq["n"], manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="p_bfa7acea")
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()

    from sqlalchemy.orm import sessionmaker
    from app.database import get_engine
    db = sessionmaker(bind=get_engine(args.profile))()
    try:
        removed = remove(db)
        print(f"retirées : {removed} opérations du précédent enrichissement")
        if not args.remove:
            n, manifest = seed(db, date.today())
            print(f"ajoutées : {n} opérations, {len(manifest['categories'])} catégories, {len(manifest['templates'])} récurrence")
    finally:
        db.close()


if __name__ == "__main__":
    main()
