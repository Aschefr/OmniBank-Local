# Fiche de Connaissances : Auto-Pilote, Rapprochement Bancaire et Traçabilité

## 1. Rôle de l'Auto-Pilote
L'Auto-Pilote d'OmniBank est un moteur d'automatisation bancaire autonome fonctionnant 100% hors-ligne. Il assure :
- Le rapprochement automatique des opérations bancaires avec les échéances prévues.
- La détection et la création de nouvelles récurrences régulières.
- La catégorisation intelligente des opérations par apprentissage local.
- L'audit continu et la prévention des anomalies financières.

## 2. Cycle de Vie des Débits et Badges d'État
Lorsqu'un prélèvement récurrent (ex. abonnement fibre, électricité, loyer) survient, il traverse deux phases distinctes :
1. **Opération à Venir Liée (`LINKED_COMING`)** :
   - Badge : `⏳ Opération à venir liée` (couleur ambre).
   - Signification : La banque annonce un prélèvement futur (`is_coming: True`). L'Auto-Pilote le détecte et le lie par anticipation à l'échéance planifiée de l'échéancier. Cela sécurise le Reste à Vivre sans créer de doublon.
2. **Rapprochement Confirmé (`AUTO_COMMIT`)** :
   - Badge : `⚡ Rapprochement confirmé` (couleur émeraude).
   - Signification : Le débit effectif est validé sur le relevé bancaire officiel (`is_coming: False`). L'Auto-Pilote confirme définitivement le pointage de l'échéance.

## 3. Niveaux de Certitude et Sas de Revue Humaine
- **Haute Certitude ($\ge 90\%$)** : L'Auto-Pilote applique automatiquement la décision (rapprochement direct, mise à jour des variations de tarif habituelles).
- **Moyenne Certitude / Incertitude ($60\% - 89\%$)** : L'opération est placée dans le **Sas de revue humaine**. L'utilisateur voit une proposition avec un bouton `[✓ C'est OK]` pour valider en 1 clic ou un formulaire d'ajustement.
- **Basse Certitude ($< 60\%$)** : Aucune action automatique n'est prise, l'opération reste à catégoriser ou pointer manuellement.

## 4. Tolérance de Montant
L'Auto-Pilote dispose d'un paramètre de tolérance (ex. 85% à 100%) permettant de reconnaître un abonnement même si le montant varie légèrement (ex. facture d'électricité fluctuante ou réévaluation annuelle de forfait).

## 5. Réversibilité Totale et Journal d'Audit
- Chaque action effectuée par l'Auto-Pilote est enregistrée dans la table des décisions avec son horodatage, son niveau de certitude et ses paramètres d'origine.
- L'utilisateur peut annuler n'importe quelle décision unitairement ou par lot (Rollback 1-clic) depuis le Centre de Contrôle Auto-Pilote ou le popover des dernières actions.

## 6. Protection Anti-Inversion et Chevauchement d'Historique
Avant d'exécuter des actions automatiques lors d'une synchronisation bancaire, l'Auto-Pilote analyse le chevauchement d'empreinte (*statement overlap*). Si une inversion de compte ou un décalage anormal est suspecté, les actions autonomes sont immédiatement bloquées pour protéger les relevés bancaires.
