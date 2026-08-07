#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate a realistic 3.5-year demo dataset (2023 - 2026) for OmniBank screenshots.
Visual Enhancements:
1. 10 Rich, Multicolor Categories with Emojis (Logement, Énergie, Alimentation, Transport, Restauration, Loisirs, Santé, Téléphonie, Shopping, Épargne).
2. Seasonality Events: Summer vacation expenses in July/August (Camping, Péages) & Christmas expenses in December.
3. Check Transactions: Check payment with check number ('Chèque N° 458921') in March.
4. Single Isolated Extraordinary Overdraft (-242 €) in Nov 2023 refunded in Dec 2023.
5. Peak Event in Oct 2025 (+3,500 € insurance reimbursement & savings transfer).
6. Gentle, modest upward slope (+420 € over 3.5 years) with no repeating monthly overdrafts.
7. Target Reste à vivre: ~850 € in mid-August 2026 before pay day.
"""

import random
from datetime import date, timedelta

def generate_demo_csv(out_filepath="demo_dataset_omnibank.csv", start_year=2023, end_year=2026):
    random.seed(42)  # Deterministic realistic output

    headers = [
        'Date de saisie', 'Date opération', 'Description', 'Montant', 'Type', 
        'Catégorie', 'Date de rapprochement', 'Répétition mensuelle', 
        'Répétition annuelle', 'Depuis', 'Vers', 'ID'
    ]

    rows = []
    tx_id = 1

    def fmt_date(d):
        return d.strftime('%d/%m/%Y')

    def fmt_amt(val):
        return f'{val:.2f}'.replace('.', ',')

    start_date = date(start_year, 1, 1)
    end_date = date(end_year, 8, 6)

    # 0. Initial opening balance on 01/01/2023 (~1,150 €)
    rows.append({
        'ID': tx_id,
        'Date de saisie': '01/01/2023',
        'Date opération': '01/01/2023',
        'Description': 'Solde initial Compte Courant',
        'Montant': fmt_amt(1150.00),
        'Type': 'Recettes',
        'Catégorie': 'Solde initial',
        'Date de rapprochement': '01/01/2023',
        'Répétition mensuelle': 'FAUX',
        'Répétition annuelle': 'FAUX',
        'Depuis': '',
        'Vers': 'Compte Courant Principal'
    })
    tx_id += 1

    current_month = start_date.replace(day=1)

    while current_month <= end_date:
        y = current_month.year
        m = current_month.month
        
        # 1. Monthly Salary (around 27th-28th) with realistic minor variations (+/- 15 €)
        sal_day = min(28, 27 + random.randint(0, 1))
        salary_date = date(y, m, sal_day)
        if salary_date <= end_date:
            saisie_date = salary_date - timedelta(days=1)
            recon_date = salary_date if salary_date < date(2026, 8, 1) else None
            salary_amt = round(1765.21 + random.uniform(-15.0, 15.0), 2)
            
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(saisie_date),
                'Date opération': fmt_date(salary_date),
                'Description': 'Salaire Mensuel 💶',
                'Montant': fmt_amt(salary_amt),
                'Type': 'Recettes',
                'Catégorie': 'Salaire',
                'Date de rapprochement': fmt_date(recon_date) if recon_date else '',
                'Répétition mensuelle': 'VRAI',
                'Répétition annuelle': 'FAUX',
                'Depuis': '',
                'Vers': 'Compte Courant Principal'
            })
            tx_id += 1

        # 2. Fixed Expenses (with seasonal energy bill adjustment)
        elec_amt = round(85.00 + (10.00 if m in [11, 12, 1, 2] else -6.00) + random.uniform(-2.0, 2.0), 2)
        fixed_items = [
            (2, 'Virement Épargne Mensuelle 🐷', 120.00, 'Épargne', 'Virement', 'Livret A'),
            (5, 'Loyer & Charges 🏠', 620.00, 'Logement', 'Dépenses fixes', ''),
            (10, 'Facture Électricité & Gaz ⚡', elec_amt, 'Énergie & Eau', 'Dépenses fixes', ''),
            (12, 'Abonnement Fibre & Mobile 📱', 48.00, 'Téléphonie & Internet', 'Dépenses fixes', ''),
            (18, 'Assurance Habitation & Auto 🛡️', round(68.00 + random.uniform(-2.0, 2.0), 2), 'Assurance', 'Dépenses fixes', ''),
            (20, 'Abonnement Streaming 🎬', 22.00, 'Abonnements & Médias', 'Dépenses fixes', ''),
            (22, 'Cotisation Mutuelle 💊', 32.00, 'Santé & Mutuelle', 'Dépenses fixes', '')
        ]

        for day, desc, amt, cat, t_type, vers in fixed_items:
            op_d = date(y, m, min(day, 28))
            if op_d > end_date:
                continue
            s_d = op_d - timedelta(days=random.randint(1, 2))
            r_d = op_d if op_d <= date(2026, 8, 2) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(s_d),
                'Date opération': fmt_date(op_d),
                'Description': desc,
                'Montant': fmt_amt(amt),
                'Type': t_type,
                'Catégorie': cat,
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'VRAI',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': vers
            })
            tx_id += 1

        # 3. Variable Expenses (Targeting ~755 €/month total so net monthly growth is a gentle +10 € to +15 € / month)
        supermarket_brands = [
            ('Courses Carrefour 🛒', 'Alimentation'),
            ('Courses Lidl 🛒', 'Alimentation'),
            ('Courses E.Leclerc 🛒', 'Alimentation'),
            ('Courses Auchan 🛒', 'Alimentation')
        ]
        for base_day in [3, 11, 19, 26]:
            day = max(1, min(28, base_day + random.randint(-1, 1)))
            op_d = date(y, m, day)
            if op_d > end_date:
                continue
            desc, cat = random.choice(supermarket_brands)
            amt = round(random.uniform(88.0, 98.0), 2)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': desc,
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': cat,
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # Carburant (2x/month, jitter +/- 2 days)
        for base_day in [7, 21]:
            day = max(1, min(28, base_day + random.randint(-2, 2)))
            op_d = date(y, m, day)
            if op_d > end_date:
                continue
            amt = round(random.uniform(55.0, 63.0), 2)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': 'Station TotalEnergies - Carburant ⛽',
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': 'Transport & Carburant',
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # Restauration (2x/month, jitter +/- 2 days)
        restos = ['Brasserie du Centre 🍕', 'Pizzeria Bella Vista 🍕', 'Bistrot Gourmand 🍕']
        for base_day in [8, 23]:
            day = max(1, min(28, base_day + random.randint(-2, 2)))
            op_d = date(y, m, day)
            if op_d > end_date:
                continue
            amt = round(random.uniform(32.0, 42.0), 2)
            resto = random.choice(restos)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': resto,
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': 'Restauration & Sorties',
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # Pharmacie / Santé (1x/month, jitter +/- 3 days)
        day = max(1, min(28, 15 + random.randint(-3, 3)))
        op_d = date(y, m, day)
        if op_d <= end_date:
            amt = round(random.uniform(20.0, 28.0), 2)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': 'Pharmacie Centrale 💊',
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': 'Santé & Mutuelle',
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # Loisirs / Culture (1x/month, jitter +/- 2 days)
        shops = ['Pathé Gaumont - Cinéma 🎬', 'Fnac - Livres & Musique 📚', 'Decathlon - Loisirs ⚽']
        day = max(1, min(28, 24 + random.randint(-2, 2)))
        op_d = date(y, m, day)
        if op_d <= end_date:
            amt = round(random.uniform(115.0, 135.0), 2)
            shop = random.choice(shops)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': shop,
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': 'Loisirs & Culture',
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # Shopping / Habillement (1x/month)
        day = max(1, min(28, 14 + random.randint(-2, 2)))
        op_d = date(y, m, day)
        if op_d <= end_date:
            amt = round(random.uniform(35.0, 55.0), 2)
            r_d = op_d if op_d <= date(2026, 8, 3) else None
            rows.append({
                'ID': tx_id,
                'Date de saisie': fmt_date(op_d),
                'Date opération': fmt_date(op_d),
                'Description': 'Shopping Habillement 🛍️',
                'Montant': fmt_amt(amt),
                'Type': 'Dépenses variables',
                'Catégorie': 'Shopping & Habillement',
                'Date de rapprochement': fmt_date(r_d) if r_d else '',
                'Répétition mensuelle': 'FAUX',
                'Répétition annuelle': 'FAUX',
                'Depuis': 'Compte Courant Principal',
                'Vers': ''
            })
            tx_id += 1

        # 4. Seasonality Expenses (July/August Vacations & December Christmas)
        if m in [7, 8]:
            vac_d = date(y, m, 16)
            if vac_d <= end_date:
                amt = 90.00 if m == 7 else 35.00
                desc = 'Camping Les Pins - Vacances 🏖️' if m == 7 else 'Péages & Autoroute 🛣️'
                cat = 'Loisirs & Culture' if m == 7 else 'Transport & Carburant'
                r_d = vac_d if vac_d <= date(2026, 8, 3) else None
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(vac_d),
                    'Date opération': fmt_date(vac_d),
                    'Description': desc,
                    'Montant': fmt_amt(amt),
                    'Type': 'Dépenses variables',
                    'Catégorie': cat,
                    'Date de rapprochement': fmt_date(r_d) if r_d else '',
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': 'Compte Courant Principal',
                    'Vers': ''
                })
                tx_id += 1

        if m == 12:
            xmas_d = date(y, m, 18)
            if xmas_d <= end_date:
                amt = 85.00
                r_d = xmas_d if xmas_d <= date(2026, 8, 3) else None
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(xmas_d),
                    'Date opération': fmt_date(xmas_d),
                    'Description': 'Cadeaux de Noël & Fêtes 🎁',
                    'Montant': fmt_amt(amt),
                    'Type': 'Dépenses variables',
                    'Catégorie': 'Shopping & Habillement',
                    'Date de rapprochement': fmt_date(r_d) if r_d else '',
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': 'Compte Courant Principal',
                    'Vers': ''
                })
                tx_id += 1

        # Check Payment in March
        if m == 3:
            chk_d = date(y, m, 14)
            if chk_d <= end_date:
                amt = 35.00
                r_d = chk_d if chk_d <= date(2026, 8, 3) else None
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(chk_d),
                    'Date opération': fmt_date(chk_d),
                    'Description': 'Chèque N° 458921 - Cotisation Club 🎨',
                    'Montant': fmt_amt(amt),
                    'Type': 'Dépenses variables',
                    'Catégorie': 'Loisirs & Culture',
                    'Date de rapprochement': fmt_date(r_d) if r_d else '',
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': 'Compte Courant Principal',
                    'Vers': ''
                })
                tx_id += 1

        # 5. ONE-TIME Extraordinary Event: Single unexpected car repair in Nov 2023 (-1,400 €), causing brief isolated overdraft to -242 €
        if y == 2023 and m == 11:
            op_d = date(2023, 11, 24)
            if op_d <= end_date:
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(op_d),
                    'Date opération': fmt_date(op_d),
                    'Description': 'Frais Auto Exceptionnels 🔧',
                    'Montant': fmt_amt(1400.00),
                    'Type': 'Dépenses variables',
                    'Catégorie': 'Transport & Carburant',
                    'Date de rapprochement': fmt_date(op_d),
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': 'Compte Courant Principal',
                    'Vers': ''
                })
                tx_id += 1
        if y == 2023 and m == 12:
            op_d = date(2023, 12, 15)
            if op_d <= end_date:
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(op_d),
                    'Date opération': fmt_date(op_d),
                    'Description': 'Remboursement Assurance Auto 🛡️',
                    'Montant': fmt_amt(1400.00),
                    'Type': 'Recettes',
                    'Catégorie': 'Remboursement',
                    'Date de rapprochement': fmt_date(op_d),
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': '',
                    'Vers': 'Compte Courant Principal'
                })
                tx_id += 1

        # 6. One-time peak in Oct 2025
        if y == 2025 and m == 10:
            sp_in = date(2025, 10, 4)
            sp_out = date(2025, 10, 18)
            if sp_in <= end_date:
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(sp_in),
                    'Date opération': fmt_date(sp_in),
                    'Description': 'Remboursement Assurance 🏦',
                    'Montant': fmt_amt(3500.00),
                    'Type': 'Recettes',
                    'Catégorie': 'Remboursement',
                    'Date de rapprochement': fmt_date(sp_in),
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': '',
                    'Vers': 'Compte Courant Principal'
                })
                tx_id += 1
            if sp_out <= end_date:
                rows.append({
                    'ID': tx_id,
                    'Date de saisie': fmt_date(sp_out),
                    'Date opération': fmt_date(sp_out),
                    'Description': 'Virement Épargne Exceptionnel 🐷',
                    'Montant': fmt_amt(3500.00),
                    'Type': 'Virement',
                    'Catégorie': 'Épargne',
                    'Date de rapprochement': fmt_date(sp_out),
                    'Répétition mensuelle': 'FAUX',
                    'Répétition annuelle': 'FAUX',
                    'Depuis': 'Compte Courant Principal',
                    'Vers': 'Livret A'
                })
                tx_id += 1

        if m == 12:
            current_month = date(y + 1, 1, 1)
        else:
            current_month = date(y, m + 1, 1)

    with open(out_filepath, 'w', encoding='utf-8-sig') as f:
        f.write(';'.join(headers) + '\n')
        for r in rows:
            line = ';'.join(str(r[h]) for h in headers)
            f.write(line + '\n')

    print(f"Generated {len(rows)} transactions ({start_year} to {end_year}) in '{out_filepath}'")

if __name__ == "__main__":
    generate_demo_csv()
