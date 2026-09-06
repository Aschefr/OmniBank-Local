// static/js/views/bank_sync_review.js — Modale de revue des opérations
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    async openReviewModal(connId, previewData, targetAccountId = null) {
        this.ensureModalsExist();
        if (!previewData) {
            if (this.previewData && this.previewData.accounts && this.previewData.accounts.length > 0) {
                previewData = this.previewData;
            } else if (typeof this.openPendingReviewModal === 'function') {
                return await this.openPendingReviewModal(null, targetAccountId);
            }
        }
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (_) {
                window.app.categoriesList = [];
            }
        }
        this.activeConnId = connId;
        this._reviewSource = previewData?._source || 'bank_sync';
        const isCsvImport = this._reviewSource === 'csv_import';

        // Charger les descriptions historiques pour l'autocomplétion / saisie assistée
        try {
            this.descriptions = await API.get('/api/transactions/descriptions');
            const dataList = document.getElementById('bankSyncDescList');
            if (dataList && this.descriptions) {
                dataList.innerHTML = Object.keys(this.descriptions).map(d => `<option value="${(window.escapeHtml ? window.escapeHtml(d) : d).replace(/"/g, '&quot;')}">`).join('');
            }
        } catch (e) {
            console.warn('[BankSync] Erreur chargement descriptions:', e);
            this.descriptions = {};
        }

        // 0. Re-calcule dynamiquement en direct le rapprochement par rapport à l'état actuel de la base SQLite
        //    (sauf en mode import CSV — pas de connexion bancaire ni d'overrides à appliquer)
        if (!isCsvImport && previewData && previewData.accounts && previewData.accounts.length > 0) {
            try {
                const payload = {
                    ...previewData,
                    rejected_matches: connId ? this.getRejectedMatches(connId) : [],
                    force_matches: connId ? this.getForceMatches(connId) : []
                };
                const refreshed = await API.post('/api/bank-sync/re-evaluate-preview', payload);
                if (refreshed && refreshed.accounts) {
                    previewData = refreshed;
                    if (connId) {
                        this.saveCachedPreview(connId, previewData);
                    }
                }
            } catch (e) {
                console.warn('[BankSync] Erreur re-évaluation temps réel du preview:', e);
            }
        }

        // Dédupliquer les comptes dans previewData.accounts si besoin
        if (previewData && previewData.accounts && previewData.accounts.length > 1) {
            const seenRevAccs = new Set();
            previewData.accounts = previewData.accounts.filter(a => {
                const k = a.account_id ? `id_${a.account_id}` : `name_${(a.account_name || a.name || a.section_title || '').trim().toLowerCase()}`;
                if (seenRevAccs.has(k)) return false;
                seenRevAccs.add(k);
                return true;
            });
        }

        this.previewData = previewData;
        let selectedIdx = -1;
        if (targetAccountId != null) {
            selectedIdx = (previewData?.accounts || []).findIndex(acc => String(acc.account_id) === String(targetAccountId));
        }
        if (selectedIdx < 0) {
            selectedIdx = (previewData?.accounts || []).findIndex(acc => {
                return (acc.transactions || []).some(tx => {
                    const isIgnored = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
                    return !isIgnored;
                });
            });
        }
        this.currentAccountIndex = selectedIdx >= 0 ? selectedIdx : 0;
        this.currentFilter = 'pending';
        this.showMatchScores = localStorage.getItem('omnibank_review_show_scores') === 'true';

        const scoreBtn = document.getElementById('btnSyncToggleScores');
        if (scoreBtn) {
            scoreBtn.style.background = this.showMatchScores ? 'rgba(99, 102, 241, 0.15)' : 'transparent';
            scoreBtn.style.borderColor = this.showMatchScores ? 'var(--accent)' : 'var(--border-color)';
            scoreBtn.style.color = this.showMatchScores ? 'var(--accent)' : 'var(--text-muted)';
            scoreBtn.style.fontWeight = this.showMatchScores ? '700' : 'normal';
        }

        // 1. Résolution proactive Smart Label pour garantir l'application des règles et la conservation du nom brut
        try {
            const unrecTxs = [];
            (this.previewData?.accounts || []).forEach(acc => {
                (acc.transactions || []).forEach(t => {
                    if (!t.is_reconciled) {
                        unrecTxs.push(t);
                    }
                });
            });

            if (unrecTxs.length > 0) {
                const rawLabels = Array.from(new Set(unrecTxs.map(t => t.raw_description || t.description)));
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    unrecTxs.forEach(t => {
                        const raw = t.raw_description || t.description;
                        t.raw_description = raw;
                        if (smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                t.description = r.description;
                                if (r.category && !t.category) {
                                    t.category = r.category;
                                }
                                t.smart_suggested = true;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[BankSync] Erreur smart label resolve dans review modal:', e);
        }

        // ── Adaptation dynamique du cockpit selon le mode d'entrée ──
        const titleIcon = document.getElementById('reviewModalIcon');
        const titleText = document.getElementById('reviewModalTitleText');
        const subtitle = document.getElementById('reviewModalSubtitle');
        const csvBar = document.getElementById('reviewCsvBar');
        const comingBtn = document.getElementById('btnSyncFilterComing');
        const commitBtn = document.getElementById('btnCommitSync');

        if (isCsvImport) {
            if (titleIcon) titleIcon.textContent = '📄';
            if (titleText) titleText.textContent = window.i18n ? window.i18n.t('import_review_title') || 'Import de Relevé Bancaire' : 'Import de Relevé Bancaire';
            if (subtitle) subtitle.textContent = window.i18n ? window.i18n.t('import_review_subtitle') || 'Vérifiez, modifiez les catégories ou ignorez des opérations avant d\'enregistrer.' : 'Vérifiez, modifiez les catégories ou ignorez des opérations avant d\'enregistrer.';
            if (comingBtn) comingBtn.style.display = 'none';
            if (commitBtn) commitBtn.textContent = window.i18n ? window.i18n.t('btn_validate_save') || 'Valider et Sauvegarder' : 'Valider et Sauvegarder';

            // Afficher la barre CSV (compte + alertes)
            if (csvBar) {
                csvBar.style.display = 'block';
                // Peupler la liste des comptes
                const accSelect = document.getElementById('reviewCsvAccountSelect');
                if (accSelect) {
                    const currentVal = this.previewData?.accounts?.[this.currentAccountIndex || 0]?.account_id || '';
                    accSelect.innerHTML = `<option value="">${window.i18n ? window.i18n.t('opt_no_account') || '-- Aucun compte sélectionné --' : '-- Aucun compte sélectionné --'}</option>`;
                    if (window.app && window.app.accounts) {
                        window.app.accounts.filter(a => !a.is_closed).forEach(acc => {
                            const sel = acc.id == currentVal ? 'selected' : '';
                            accSelect.innerHTML += `<option value="${acc.id}" ${sel}>${window.escapeHtml ? window.escapeHtml(acc.name) : acc.name}</option>`;
                        });
                    }
                }
                // Afficher les alertes CSV si présentes
                this._renderCsvAlerts();
            }
        } else {
            if (titleIcon) titleIcon.textContent = '📥';
            if (titleText) titleText.textContent = window.i18n ? window.i18n.t('bank_sync_review_title') : 'Revue des opérations synchronisées';
            if (subtitle) subtitle.textContent = window.i18n ? window.i18n.t('bank_sync_review_subtitle') : '';
            if (comingBtn) comingBtn.style.display = '';
            if (commitBtn) commitBtn.textContent = window.i18n ? window.i18n.t('bank_sync_btn_commit') : 'Valider la synchronisation';
            if (csvBar) csvBar.style.display = 'none';
        }

        const modal = document.getElementById('bankSyncReviewModal');
        if (modal) modal.style.display = 'flex';

        // Adapter la visibilité du bouton IA global selon paramètre enable_ai
        const aiBtn = document.getElementById('btnSyncCategorizeAllAI');
        if (aiBtn) {
            aiBtn.style.display = this.isAIEnabled() ? 'inline-flex' : 'none';
        }

        this.renderAccountTabs();
        this.setReviewFilter('pending');
    },

    closeReviewModal() {
        document.getElementById('bankSyncReviewModal').style.display = 'none';
        this.previewData = null;
        this._reviewSource = 'bank_sync';
        // Masquer la barre CSV
        const csvBar = document.getElementById('reviewCsvBar');
        if (csvBar) csvBar.style.display = 'none';
    },

    // ── Méthodes spécifiques au mode CSV Import ──────────────────────
    _renderCsvAlerts() {
        const alertBox = document.getElementById('reviewCsvAlertBox');
        if (!alertBox || !this.previewData) return;
        const currentAcc = this.previewData.accounts?.[this.currentAccountIndex || 0];
        const alerts = currentAcc?.alerts || this.previewData._csvAlerts || {};
        const warningMsgs = [];
        if (alerts.all_duplicate) {
            warningMsgs.push(`⚠️ ${window.i18n ? window.i18n.t('import_alert_all_duplicate') || 'Toutes les opérations existent déjà en base.' : 'Toutes les opérations existent déjà en base.'}`);
        }
        if (alerts.is_old_file) {
            let msg = window.i18n ? window.i18n.t('import_alert_old_file') || 'Fichier antérieur à la dernière importation.' : 'Fichier antérieur à la dernière importation.';
            if (alerts.latest_import_date) msg = msg.replace('{date_import}', alerts.latest_import_date);
            if (alerts.latest_db_date) msg = msg.replace('{date_db}', alerts.latest_db_date);
            warningMsgs.push(`⚠️ ${msg}`);
        }
        if (alerts.has_gap) {
            let msg = window.i18n ? window.i18n.t('import_alert_gap') || 'Il y a un écart de dates entre la base et l\'import.' : 'Il y a un écart de dates entre la base et l\'import.';
            warningMsgs.push(`⚠️ ${msg}`);
        }
        if (warningMsgs.length > 0) {
            alertBox.style.display = 'block';
            alertBox.innerHTML = warningMsgs.map(m => `<div style="margin-bottom: 3px;">${m}</div>`).join('');
        } else {
            alertBox.style.display = 'none';
        }
    },

    onCsvAccountChanged() {
        if (this._reviewSource !== 'csv_import' || !this.previewData) return;
        const accSelect = document.getElementById('reviewCsvAccountSelect');
        const newAccId = accSelect ? parseInt(accSelect.value) || null : null;
        const currentAcc = this.previewData.accounts?.[this.currentAccountIndex || 0];
        if (currentAcc) {
            currentAcc.account_id = newAccId;
            const acc = window.app?.accounts?.find(a => a.id == newAccId);
            if (acc) currentAcc.account_name = acc.name;
        }
        this.renderAccountTabs();
        this.renderReviewTable();
        this.updateReviewSummary();
    },

    renderAccountTabs() {
        const container = document.getElementById('reviewAccountTabs');
        if (!container || !this.previewData || !this.previewData.accounts) return;

        const accs = this.previewData.accounts;
        if (accs.length <= 1) {
            container.innerHTML = `<span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${accs[0]?.account_name || 'Compte'}</span>`;
            return;
        }

        container.innerHTML = accs.map((acc, idx) => `
            <button class="btn btn-sm ${idx === this.currentAccountIndex ? 'btn-primary' : 'btn-secondary'}" 
                    onclick="window.BankSyncView.switchAccountTab(${idx})" 
                    style="padding: 4px 12px; font-size: 12px; border-radius: 8px;">
                ${acc.account_name || 'Compte'} (${acc.transactions?.length || 0})
            </button>
        `).join('');
    },

    switchAccountTab(idx) {
        this.currentAccountIndex = idx;
        const accSelect = document.getElementById('reviewCsvAccountSelect');
        if (accSelect && this.previewData?.accounts?.[idx]) {
            accSelect.value = this.previewData.accounts[idx].account_id || '';
        }
        if (this._reviewSource === 'csv_import') {
            this._renderCsvAlerts();
        }
        this.renderAccountTabs();
        this.renderReviewTable();
    },

    setReviewFilter(filter) {
        this.currentFilter = filter;

        ['btnSyncFilterPending', 'btnSyncFilterAll', 'btnSyncFilterAdd', 'btnSyncFilterReconcile', 'btnSyncFilterComing', 'btnSyncFilterIgnored'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'var(--border-color)';
                btn.style.color = 'var(--text-muted)';
            }
        });

        const activeMap = {
            'pending': 'btnSyncFilterPending',
            'all': 'btnSyncFilterAll',
            'add': 'btnSyncFilterAdd',
            'reconcile': 'btnSyncFilterReconcile',
            'coming': 'btnSyncFilterComing',
            'ignored': 'btnSyncFilterIgnored'
        };
        const activeBtn = document.getElementById(activeMap[filter]);
        if (activeBtn) {
            activeBtn.style.background = filter === 'coming' ? '#d97706' : (filter === 'pending' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : 'var(--accent)');
            activeBtn.style.borderColor = filter === 'coming' ? '#d97706' : (filter === 'pending' ? '#92400e' : 'var(--accent)');
            activeBtn.style.color = 'white';
        }

        this.renderReviewTable();
    },

    toggleReviewScores() {
        this.showMatchScores = !this.showMatchScores;
        localStorage.setItem('omnibank_review_show_scores', this.showMatchScores ? 'true' : 'false');
        const btn = document.getElementById('btnSyncToggleScores');
        if (btn) {
            btn.style.background = this.showMatchScores ? 'rgba(99, 102, 241, 0.15)' : 'transparent';
            btn.style.borderColor = this.showMatchScores ? 'var(--accent)' : 'var(--border-color)';
            btn.style.color = this.showMatchScores ? 'var(--accent)' : 'var(--text-muted)';
            btn.style.fontWeight = this.showMatchScores ? '700' : 'normal';
        }
        this.renderReviewTable();
    },

    renderReviewTable() {
        const tbody = document.getElementById('bankSyncReviewBody');
        if (!tbody || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions')}</td></tr>`;
            return;
        }

        const bankBal = (typeof currentAcc.bank_balance === 'number') ? currentAcc.bank_balance : null;
        const localBal = (typeof currentAcc.local_reconciled_balance === 'number') ? currentAcc.local_reconciled_balance : null;
        const delta = (bankBal !== null && localBal !== null) ? Math.round((bankBal - localBal) * 100) / 100 : null;

        const txs = currentAcc.transactions;
        const categories = window.app?.categoriesList || [];
        const aiEnabled = this.isAIEnabled();

        // Identifier les opérations qui résolvent l'écart
        txs.forEach(tx => {
            tx._resolves_diff = false;
            if (!tx.is_reconciled && delta !== null && Math.abs(delta) >= 0.005) {
                const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                if (Math.abs(rawAmt - delta) < 0.005) {
                    tx._resolves_diff = true;
                }
            }
        });

        let visibleTxs = txs.filter(tx => {
            const isIgnoredOrExcluded = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'pending') {
                // Affiche uniquement les opérations à rapprocher, en attente et nouvelles (exclut les ignorées et déjà en base)
                return !isIgnoredOrExcluded;
            }
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'coming') return !!tx.is_coming;
            if (this.currentFilter === 'ignored') return isIgnoredOrExcluded;
            if (this.currentFilter === 'reconcile') return (tx.is_reconciled && !tx.already_reconciled && !tx.is_coming && !tx._excluded && !tx.is_dismissed);
            if (this.currentFilter === 'add') return (!tx.is_reconciled && !tx.is_coming && !tx._excluded && !tx.is_dismissed && !tx.is_auto_dismissed);
            return true;
        });

        // Tri chronologique décroissant (les opérations les plus récentes en haut)
        visibleTxs.sort((a, b) => (b.date_operation || '').localeCompare(a.date_operation || ''));

        if (visibleTxs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions_filter')}</td></tr>`;
            this.updateReviewSummary();
            this._updateMasterCheckboxState();
            return;
        }

        const lblInDb = window.i18n.t('bank_sync_in_db') || 'En base :';
        const lblAutoCat = window.i18n.t('bank_sync_auto_cat') || '(Automatique)';
        const lblSelectCat = window.i18n.t('bank_sync_select_category') || '-- Catégorie --';
        const lblIgnoreRow = window.i18n.t('bank_sync_ignore_row_tooltip') || 'Ignorer cette ligne';
        const lblUnlink = (window.i18n && window.i18n.t('bank_sync_unlink_tooltip')) || 'Annuler ce rapprochement automatique';
        const lblRelink = (window.i18n && window.i18n.t('bank_sync_relink_tooltip')) || 'Associer manuellement à une opération en base';
        const lblRowCheck = (window.i18n && window.i18n.t('bank_sync_row_check_tooltip')) || 'Inclure cette opération dans la synchronisation';

        tbody.innerHTML = visibleTxs.map((tx) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;
            const isExcluded = !!tx._excluded;

            let statusBadge = '';
            let actionText = '';
            let actionColor = '';

            const resolvesBadge = tx._resolves_diff
                ? `<span class="badge resolves-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;" title="${(window.i18n ? window.i18n.t('bank_sync_resolves_diff_tooltip') : 'La validation de cette opération permettra d\'aligner le solde OmniBank sur celui de la banque.').replace(/"/g, '&quot;')}"><span>🎯</span> <span>${window.i18n ? window.i18n.t('bank_sync_resolves_diff') : 'Résout l\'écart'}</span></span>`
                : '';

            if (tx.is_dismissed) {
                const badgeLabel = (window.i18n && window.i18n.t('bank_sync_status_dismissed')) || '🚫 Ignorée';
                const badgeTip = (window.i18n ? window.i18n.t('bank_sync_dismissed_tooltip') || 'Opération ignorée manuellement.' : 'Opération ignorée manuellement.').replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background:var(--bg-surface); color:var(--text-muted); border:1px solid var(--border-color); cursor:help; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="${badgeTip}">${badgeLabel}</span>`;
                actionText = (window.i18n && window.i18n.t('bank_sync_action_dismissed')) || 'Ignorée (manuelle)';
                actionColor = `color: var(--text-muted);`;
            } else if (tx.is_auto_dismissed) {
                const badgeLabel = (window.i18n && window.i18n.t('bank_sync_status_conformed_ignored')) || '🛡️ Solde conforme';
                const badgeTip = (window.i18n ? window.i18n.t('bank_sync_conformed_balance_tip') || 'Compte déjà conforme : ancienne opération ignorée automatiquement.' : 'Compte déjà conforme : ancienne opération ignorée automatiquement.').replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background:rgba(16, 185, 129, 0.12); color:#10b981; border:1px solid rgba(16, 185, 129, 0.35); font-weight:600; cursor:help; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="${badgeTip}">${badgeLabel}</span>`;
                actionText = (window.i18n && window.i18n.t('bank_sync_action_conformed_ignored')) || 'Ignorée (solde conforme)';
                actionColor = `color: #10b981;`;
            } else if (isRec && tx.is_orphan_transfer_link) {
                const targetName = tx.orphan_account_name || 'autre compte';
                const badgeLabel = window.i18n.t('bank_sync_orphan_transfer_badge') || 'Liaison virement';
                const badgeTip = (window.i18n.t('bank_sync_orphan_transfer_tooltip') || 'Une écriture isolée du même montant existe déjà sur un autre compte. La validation fusionnera ces écritures en un virement interne sans créer de doublon.').replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3); font-weight: 700; cursor: help; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="${badgeTip}"><span>🔗</span> <span>${badgeLabel}</span></span>`;
                actionText = (window.i18n.tp ? window.i18n.tp('bank_sync_orphan_transfer_action', { account: targetName }) : `Lier au compte ${targetName}`);
                actionColor = `color: #8b5cf6; font-weight: 600;`;
            } else if (isRec && alreadyRec) {
                if (tx.is_mirror_transfer) {
                    const badgeLabel = window.i18n.t('bank_sync_mirror_transfer_badge') || 'Virement miroir';
                    const badgeTip = (window.i18n.t('bank_sync_mirror_transfer_tooltip') || 'Écriture miroir d\'un virement interne déjà enregistré.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background:rgba(99,102,241,0.12); color:var(--accent); border:1px solid rgba(99,102,241,0.3); cursor:help; white-space: nowrap; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>🔗 ${badgeLabel}</span> <span style="font-size:11px; opacity:0.8;">ℹ️</span></span>`;
                    actionText = window.i18n.t('bank_sync_mirror_transfer_action') || 'Ignorée (miroir de virement)';
                    actionColor = `color: var(--text-muted);`;
                } else if (tx.is_coming) {
                    const badgeLabel = window.i18n.t('bank_sync_discrepancy_badge') || 'Rapprochée / En attente banque';
                    const badgeTip = (window.i18n.t('bank_sync_discrepancy_tooltip') || 'Cette opération a déjà été rapprochée dans OmniBank, mais la banque l\'affiche encore dans ses opérations en attente / autorisations.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; cursor: help; white-space: nowrap; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>⏳ ${badgeLabel}</span></span>`;
                    actionText = window.i18n.t('bank_sync_discrepancy_action') || 'Ignorée (déjà rapprochée en local)';
                    actionColor = `color: #d97706; font-weight: 500;`;
                } else {
                    const alreadyLabel = window.i18n.t('bank_sync_status_already_reconciled') || '✅ Déjà rapprochée';
                    statusBadge = `<span class="badge" style="background:var(--bg-surface); color:var(--text-muted); border:1px solid var(--border-color); white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">${alreadyLabel}</span>`;
                    actionText = window.i18n.t('bank_sync_action_ignored_duplicate') || 'Ignorée (doublon)';
                    actionColor = `color: var(--text-muted);`;
                }
            } else if (isRec && !alreadyRec) {
                if (tx.is_coming) {
                    const badgeLabel = window.i18n.t('bank_sync_coming_to_reconcile') || '⏳ En attente banque';
                    const badgeTip = (window.i18n.t('bank_sync_coming_to_reconcile_tooltip') || 'Opération en attente banque correspondant à une opération locale non encore rapprochée. Elle reste non rapprochée jusqu\'à son débit effectif.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; cursor: help; white-space: nowrap; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>${badgeLabel}</span></span>`;
                    actionText = window.i18n.t('bank_sync_action_coming_matched') || 'En attente banque (non rapprochée)';
                    actionColor = `color: #d97706; font-weight: 500;`;
                } else {
                    const reconLabel = window.i18n.t('bank_sync_status_to_reconcile') || '⚡ À rapprocher';
                    statusBadge = `<span class="badge" style="background:var(--color-income, #10b981); color:white; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">${reconLabel}</span>`;
                    actionText = window.i18n.t('bank_sync_action_will_reconcile') || 'Sera rapprochée';
                    actionColor = `color: var(--color-income, #10b981);`;
                }
            } else if (!isRec && tx.is_coming) {
                const badgeLabel = window.i18n.t('bank_sync_coming_new') || '⏳ En attente (Nouvelle)';
                statusBadge = `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; white-space: nowrap; display:inline-flex; align-items:center; gap:4px;"><span>${badgeLabel}</span></span>`;
                actionText = window.i18n.t('bank_sync_action_coming_new') || window.i18n.t('bank_sync_coming_action') || 'Nouvelle (en attente banque)';
                actionColor = `color: #6366f1;`;
            } else {
                const newLabel = window.i18n.t('bank_sync_status_to_add') || '🆕 Nouvelle opération';
                statusBadge = `<span class="badge" style="background:var(--color-expense, #6366f1); color:white; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">${newLabel}</span>`;
                actionText = window.i18n.t('bank_sync_action_new_operation') || 'Nouvelle opération';
                actionColor = `color: var(--color-expense, #6366f1);`;
            }

            const showRaw = tx.raw_description && tx.raw_description !== tx.description;
            const tipSuggested = (window.i18n ? window.i18n.t('smart_label_suggested_tooltip') || window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique / règles' : 'Suggéré d’après votre historique / règles').replace(/"/g, '&quot;');
            const rawSubHtml = showRaw 
                ? `<div class="review-raw-desc" style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 3px; font-weight: normal; opacity: 0.85; display: flex; align-items: center; gap: 4px;"><span>🏛️</span> <span>${window.escapeHtml ? window.escapeHtml(tx.raw_description) : tx.raw_description}</span> ${tx.smart_suggested ? `<span title="${tipSuggested}" style="cursor:help; font-size:11px;">💡</span>` : ''}</div>` 
                : '';
            const dbDesc = (tx.db_description && tx.db_description !== tx.description) 
                ? `<div class="review-db-desc" style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${lblInDb} ${window.escapeHtml ? window.escapeHtml(tx.db_description) : tx.db_description}</div>` 
                : '';

            const descInput = isRec 
                ? `${dbDesc}<input type="text" class="sync-desc input-styled" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 4px; color: var(--text-muted);" readonly>${rawSubHtml}` 
                : `${dbDesc}<input type="text" class="sync-desc input-styled" list="bankSyncDescList" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 4px;" oninput="window.BankSyncView.onSyncDescInput(${this.currentAccountIndex}, '${tx.csv_id}', this)" onchange="window.BankSyncView.updateTxDesc(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">${rawSubHtml}`;

            const catOptions = `<option value="">${lblSelectCat}</option>` + categories.filter(c => !c.is_closed).map(c => 
                `<option value="${c.name.replace(/"/g, '&quot;')}" ${tx.category === c.name ? 'selected' : ''}>${c.name}</option>`
            ).join('');

            const aiButtonHtml = (!isRec && aiEnabled) ? `
                <button class="btn btn-secondary review-ai-btn" style="padding: 3px 6px; font-size: 11px; border-radius: 6px;" onclick="window.BankSyncView.categorizeRowAI('${tx.csv_id}', this)" title="${window.i18n.t('bank_categorize_ai_tooltip')}">🧠</button>
            ` : '';

            const catSelect = isRec 
                ? `<span class="review-cat-auto" style="color: var(--text-muted); font-size: 12px; font-style: italic;">${lblAutoCat}</span>`
                : `
                <div class="review-cat-wrap" style="display: flex; gap: 4px; align-items: center;">
                    <select class="input-styled sync-cat" id="catSel_${tx.csv_id}" style="flex: 1; padding: 4px;" onchange="window.BankSyncView.updateTxCat(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                        ${catOptions}
                    </select>
                    ${aiButtonHtml}
                </div>
                `;

            const amountColor = (tx.raw_amount < 0) ? '#ef4444' : '#10b981';
            const amountInput = isRec 
                ? `<span class="review-amount-text" style="font-weight: 700; color: ${amountColor};">${(tx.raw_amount < 0 ? '-' : '+')} ${tx.amount.toFixed(2)} €</span>`
                : `<input type="number" step="0.01" class="input-styled review-amount-input" value="${tx.amount.toFixed(2)}" style="width: 80px; text-align: right; padding: 4px; font-weight: 700; color: ${amountColor};" onchange="window.BankSyncView.updateTxAmount(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">`;

            let rowStyle = 'border-bottom: 1px solid var(--border-color); transition: opacity 0.2s ease, filter 0.2s ease;';
            if (isExcluded || tx.is_dismissed || tx.is_auto_dismissed) {
                rowStyle += ' opacity: 0.4; filter: grayscale(0.7);';
            } else if (tx.is_coming) {
                rowStyle += ' background: rgba(245, 158, 11, 0.05); border-left: 3px solid #f59e0b;';
            } else if (alreadyRec) {
                rowStyle += ' opacity: 0.6;';
            }

            const comingDateIcon = tx.is_coming 
                ? `<span class="review-coming-icon" title="${(window.i18n ? window.i18n.t('bank_sync_coming_badge') : 'Opération à venir / En attente banque').replace(/"/g, '&quot;')}" style="color: #f59e0b; font-weight: 700; margin-right: 4px; cursor: help;">⏳</span>` 
                : '';

            let linkActionBtn = '';
            if (isRec && !alreadyRec) {
                linkActionBtn = `<button class="btn-action-icon" style="color: #f59e0b;" onclick="window.BankSyncView.unlinkReviewRow('${tx.csv_id}')" title="${lblUnlink}"><span>⛓️‍💥</span></button>`;
            } else if (!isRec && !alreadyRec && !tx.is_dismissed && !tx.is_auto_dismissed) {
                linkActionBtn = `<button class="btn-action-icon" style="color: var(--accent, #6366f1);" onclick="window.BankSyncView.openLinkFromReview('${tx.csv_id}')" title="${lblRelink}"><span>🔗</span></button>`;
            }

            let scoreBadge = '';
            if (this.showMatchScores && isRec && typeof tx.match_score === 'number' && tx.match_score > 0) {
                const s = tx.match_score;
                let sColor = '#10b981';
                let sBg = 'rgba(16, 185, 129, 0.15)';
                let sIcon = '🟢';
                if (s < 50) {
                    sColor = '#ef4444';
                    sBg = 'rgba(239, 68, 68, 0.15)';
                    sIcon = '🔴';
                } else if (s < 65) {
                    sColor = '#d97706';
                    sBg = 'rgba(245, 158, 11, 0.15)';
                    sIcon = '🟡';
                }
                const scoreTip = (window.i18n && window.i18n.tp) ? window.i18n.tp('bank_sync_score_tooltip', { score: s }) : `Score de confiance : ${s}/100`;
                scoreBadge = `<span class="badge" style="background:${sBg}; color:${sColor}; border:1px solid ${sColor}40; font-size:10px; font-weight:700; display:inline-flex; align-items:center; gap:2px; margin-left:4px; padding:2px 5px; border-radius:4px;" title="${scoreTip}"><span>${sIcon}</span> <span>${s}</span></span>`;
            }

            let deleteOrRestoreBtn = '';
            if (tx.is_dismissed || tx.is_auto_dismissed || isExcluded) {
                const lblRestore = (window.i18n && window.i18n.t('bank_sync_btn_restore')) || 'Rétablir';
                deleteOrRestoreBtn = `<button class="btn btn-secondary review-restore-btn" style="font-size: 11px; padding: 2px 8px; border-radius: 6px; height: 24px; display: inline-flex; align-items: center; gap: 4px; color: var(--accent);" onclick="window.BankSyncView.restoreReviewRow('${tx.csv_id}')" title="${lblRestore}"><span>↩️</span> <span>${lblRestore}</span></button>`;
            } else {
                deleteOrRestoreBtn = `<button class="btn-action-del" onclick="window.BankSyncView.removeTxRow('${tx.csv_id}')" title="${lblIgnoreRow}">✕</button>`;
            }

            return `
            <tr id="syncRow_${tx.csv_id}" class="review-tx-row ${isExcluded ? 'is-excluded' : ''} ${tx.is_coming ? 'is-coming' : ''} ${alreadyRec ? 'is-already-rec' : ''}" style="${rowStyle}">
                <td class="review-cell-check" style="padding: 10px 14px; text-align: center;">
                    <input type="checkbox" class="sync-row-check" ${isExcluded ? '' : 'checked'} onchange="window.BankSyncView.toggleTxCheck(${this.currentAccountIndex}, '${tx.csv_id}', this.checked)" title="${lblRowCheck}" style="cursor: pointer; transform: scale(1.15);">
                </td>
                <td class="review-cell-date" style="padding: 10px 14px; white-space: nowrap;">
                    <div class="review-date-wrap">${comingDateIcon}<input type="date" class="input-styled sync-date" value="${tx.date_operation}" style="width: 120px; padding: 4px;" ${isRec ? 'disabled' : ''} onchange="window.BankSyncView.updateTxDate(${this.currentAccountIndex}, '${tx.csv_id}', this.value)"></div>
                </td>
                <td class="review-cell-desc" style="padding: 10px 14px;">${descInput}</td>
                <td class="review-cell-cat" style="padding: 10px 14px;">${catSelect}</td>
                <td class="review-cell-amount" style="padding: 10px 14px; text-align: right;">
                    ${amountInput}
                </td>
                <td class="review-cell-status">
                    <div class="review-status-wrap">
                        <div class="review-status-badges">
                            ${statusBadge}
                            ${resolvesBadge}
                        </div>
                        ${scoreBadge ? `<div class="review-score-wrap">${scoreBadge}</div>` : ''}
                    </div>
                </td>
                <td class="review-cell-actions">
                    <div class="review-actions-wrap">
                        <span class="review-action-text" style="${actionColor}">${actionText}</span>
                        <div class="review-action-btns">
                            ${linkActionBtn}
                            ${deleteOrRestoreBtn}
                        </div>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        this.updateReviewSummary();
        this._updateMasterCheckboxState();
    },

    toggleTxCheck(accIdx, csvId, isChecked) {
        const acc = this.previewData?.accounts?.[accIdx];
        const tx = acc?.transactions?.find(t => t.csv_id === csvId);
        if (!tx) return;

        tx._excluded = !isChecked;

        const row = document.getElementById(`syncRow_${csvId}`);
        if (row) {
            if (tx._excluded) {
                row.style.opacity = '0.4';
                row.style.filter = 'grayscale(0.7)';
                row.classList.add('is-excluded');
            } else {
                row.style.opacity = (tx.already_reconciled) ? '0.6' : '1';
                row.style.filter = 'none';
                row.classList.remove('is-excluded');
            }
        }

        this._updateMasterCheckboxState();
        this.updateReviewSummary();
    },

    toggleCheckAll(isChecked) {
        if (!this.previewData || !this.previewData.accounts) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        const txs = currentAcc.transactions;
        let visibleTxs = txs.filter(tx => {
            const isIgnoredOrExcluded = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'pending') return !isIgnoredOrExcluded;
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'coming') return !!tx.is_coming;
            if (this.currentFilter === 'ignored') return isIgnoredOrExcluded;
            if (this.currentFilter === 'reconcile') return (tx.is_reconciled && !tx.already_reconciled && !tx.is_coming && !tx._excluded && !tx.is_dismissed);
            if (this.currentFilter === 'add') return (!tx.is_reconciled && !tx.is_coming && !tx._excluded && !tx.is_dismissed && !tx.is_auto_dismissed);
            return true;
        });

        visibleTxs.forEach(tx => {
            tx._excluded = !isChecked;
        });

        const masterCheck = document.getElementById('syncCheckAll');
        const masterCheckMobile = document.getElementById('syncCheckAllMobile');
        if (masterCheck) masterCheck.checked = isChecked;
        if (masterCheckMobile) masterCheckMobile.checked = isChecked;

        this.renderReviewTable();
    },

    _updateMasterCheckboxState() {
        const masterCheck = document.getElementById('syncCheckAll');
        const masterCheckMobile = document.getElementById('syncCheckAllMobile');
        if (!this.previewData?.accounts) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        let visibleTxs = currentAcc.transactions.filter(tx => {
            const isIgnoredOrExcluded = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'pending') return !isIgnoredOrExcluded;
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'coming') return !!tx.is_coming;
            if (this.currentFilter === 'ignored') return isIgnoredOrExcluded;
            if (this.currentFilter === 'reconcile') return (tx.is_reconciled && !tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'add') return (!tx.is_reconciled && !tx.is_coming);
            return true;
        });

        const chks = [masterCheck, masterCheckMobile].filter(Boolean);
        if (chks.length === 0) return;

        if (visibleTxs.length === 0) {
            chks.forEach(c => { c.checked = false; c.indeterminate = false; });
            return;
        }

        const checkedCount = visibleTxs.filter(t => !t._excluded).length;
        if (checkedCount === visibleTxs.length) {
            chks.forEach(c => { c.checked = true; c.indeterminate = false; });
        } else if (checkedCount === 0) {
            chks.forEach(c => { c.checked = false; c.indeterminate = false; });
        } else {
            chks.forEach(c => { c.checked = false; c.indeterminate = true; });
        }
    },

    unlinkReviewRow(csvId) {
        if (!this.previewData || !this.previewData.accounts) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions?.find(t => t.csv_id === csvId);
        if (!tx) return;

        // Si la transaction était liée à un id en base, enregistrer l'exclusion pour persister au F5 / re-evaluate
        if (tx.matched_db_id && this.activeConnId) {
            this.addRejectedMatch(this.activeConnId, csvId, tx.matched_db_id);
            this.removeForceMatch(this.activeConnId, csvId);
        }

        // Réinitialiser la transaction en "nouvelle opération" non rapprochée
        tx.is_reconciled = false;
        tx.already_reconciled = false;
        tx.matched_db_id = null;
        tx.db_description = null;
        tx.is_mirror_transfer = false;
        tx.is_orphan_transfer_link = false;
        tx.orphan_account_id = null;
        tx.orphan_account_name = null;

        if (this.activeConnId) {
            this.saveCachedPreview(this.activeConnId, this.previewData);
        }

        this.renderReviewTable();
        const msg = window.i18n ? window.i18n.t('bank_sync_unlink_success') || 'Rapprochement annulé — l\'opération est redevenue nouvelle' : 'Rapprochement annulé — l\'opération est redevenue nouvelle';
        this.showToast(msg, 'info');
    },

    async openLinkFromReview(csvId) {
        if (!this.previewData || !this.previewData.accounts) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions?.find(t => t.csv_id === csvId);
        if (!tx) return;

        this._linkFromReviewContext = {
            csvId: csvId,
            accountIndex: this.currentAccountIndex
        };

        // Alimenter un pseudo-ghost avec les données de la ligne de revue
        const ghostLike = {
            csv_id: tx.csv_id,
            description: tx.description,
            raw_description: tx.raw_description,
            amount: tx.amount,
            raw_amount: tx.raw_amount,
            date_operation: tx.date_operation,
            account_id: currentAcc.account_id,
            account_name: currentAcc.account_name,
            category: tx.category
        };

        this._linkGhostCurrentGhost = ghostLike;
        this._linkGhostSelectedTarget = null;
        this._linkGhostFieldSources = { desc: 'db', amount: 'online', cat: 'db' };

        this.ensureModalsExist();
        const modal = document.getElementById('linkGhostModal');
        if (!modal) return;

        if (window.i18n && typeof window.i18n.translateDOM === 'function') {
            window.i18n.translateDOM(modal);
        }

        // Peupler la liste des catégories
        const catSelect = document.getElementById('linkFinalCategory');
        if (catSelect) {
            let catNames = [];
            try {
                if (!window.app?.categoriesList || !window.app.categoriesList.length) {
                    window.app = window.app || {};
                    window.app.categoriesList = await API.get('/api/categories/');
                }
                catNames = (window.app?.categoriesList || []).map(c => typeof c === 'string' ? c : c?.name).filter(Boolean);
            } catch (_) {}
            if (!catNames.length) {
                catNames = ['Alimentation', 'Loisirs', 'Transport', 'Logement', 'Salaire', 'Autre'];
            }
            catNames = Array.from(new Set(catNames)).sort((a, b) => a.localeCompare(b));
            catSelect.innerHTML = `<option value="">-- ${window.i18n ? window.i18n.t('no_category') || 'Sans catégorie' : 'Sans catégorie'} --</option>` + catNames.map(cat => `<option value="${window.escapeHtml ? window.escapeHtml(cat) : cat}">${window.escapeHtml ? window.escapeHtml(cat) : cat}</option>`).join('');
        }

        // Rendu du résumé de l'opération source
        const summaryEl = document.getElementById('linkGhostSourceSummary');
        if (summaryEl) {
            const rawAmt = typeof ghostLike.raw_amount !== 'undefined' ? parseFloat(ghostLike.raw_amount) : (parseFloat(ghostLike.amount) || 0);
            const isPositive = rawAmt >= 0;
            const absAmt = Math.abs(parseFloat(ghostLike.amount) || rawAmt || 0);
            const amtFmt = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = ghostLike.date_operation ? String(ghostLike.date_operation).substring(0, 10) : '';

            summaryEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="badge ghost-badge" style="background: rgba(99, 102, 241, 0.2); color: #6366f1; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 11px;">📋 ${window.i18n ? window.i18n.t('bank_sync_status_to_add') || 'Revue' : 'Revue'}</span>
                        <span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${window.escapeHtml ? window.escapeHtml(ghostLike.description) : ghostLike.description}</span>
                    </div>
                    <span style="font-weight: 800; font-size: 14px; color: ${amtColor};">${amtFmt}</span>
                </div>
                <div style="display: flex; gap: 12px; font-size: 11.5px; color: var(--text-muted); flex-wrap: wrap;">
                    <span>📅 ${dateStr}</span>
                    <span>•</span>
                    <span>💳 ${window.escapeHtml ? window.escapeHtml(ghostLike.account_name || '') : (ghostLike.account_name || '')}</span>
                    ${ghostLike.raw_description && ghostLike.raw_description !== ghostLike.description ? `<span>•</span><span style="font-style: italic;">🏦 ${window.escapeHtml ? window.escapeHtml(ghostLike.raw_description) : ghostLike.raw_description}</span>` : ''}
                </div>
            `;
        }

        // Réinitialiser le panneau de résolution et le bouton
        const resPanel = document.getElementById('linkGhostResolutionPanel');
        if (resPanel) resPanel.style.display = 'none';
        const btnSubmit = document.getElementById('btnSubmitLinkGhost');
        if (btnSubmit) btnSubmit.disabled = true;

        const searchInput = document.getElementById('linkGhostSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }

        modal.style.display = 'flex';

        // Lancer la recherche initiale
        this.searchDbTransactions('', ghostLike.account_id, true);
    },

    onSyncDescInput(accIdx, csvId, inputEl) {
        const desc = inputEl.value;
        this.updateTxDesc(accIdx, csvId, desc);

        // Si la description correspond à un élément connu de l'historique : auto-compléter la catégorie
        if (this.descriptions && this.descriptions[desc]) {
            const data = this.descriptions[desc];
            if (data.category) {
                this.updateTxCat(accIdx, csvId, data.category);
                const catSel = document.getElementById(`catSel_${csvId}`);
                if (catSel) {
                    catSel.value = data.category;
                    catSel.style.transition = 'box-shadow 0.2s ease, border-color 0.2s ease';
                    catSel.style.borderColor = 'var(--accent, #6366f1)';
                    catSel.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.25)';
                    setTimeout(() => {
                        catSel.style.borderColor = '';
                        catSel.style.boxShadow = '';
                    }, 800);
                }
            }
        }
    },

    updateTxDesc(accIdx, csvId, newDesc) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.description = newDesc;
    },

    updateTxCat(accIdx, csvId, newCat) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.category = newCat || null;
    },

    updateTxDate(accIdx, csvId, newDate) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.date_operation = newDate;
    },

    updateTxAmount(accIdx, csvId, newAmt) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) {
            const val = parseFloat(newAmt) || 0;
            tx.amount = Math.abs(val);
            tx.raw_amount = tx.raw_amount < 0 ? -Math.abs(val) : Math.abs(val);
        }
    },

    async removeTxRow(csvId) {
        if (!this.previewData) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (currentAcc) {
            const tx = currentAcc.transactions.find(t => t.csv_id === csvId);
            if (tx) {
                tx._excluded = true;
                tx.is_dismissed = true;
            }
            try {
                await API.post(`/api/bank-sync/dismiss-ghost/${encodeURIComponent(csvId)}`);
            } catch (_) {}
            this.renderReviewTable();
            this.showToast(window.i18n ? window.i18n.t('ghost_dismissed') || 'Opération ignorée' : 'Opération ignorée', 'info');
        }
    },

    async restoreReviewRow(csvId) {
        if (!this.previewData) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (currentAcc) {
            const tx = currentAcc.transactions.find(t => t.csv_id === csvId);
            if (tx) {
                tx._excluded = false;
                tx.is_dismissed = false;
                tx.is_auto_dismissed = false;
            }
            try {
                await API.post(`/api/bank-sync/restore-ghost/${encodeURIComponent(csvId)}`);
            } catch (_) {}
            this.renderReviewTable();
            this.showToast(window.i18n ? window.i18n.t('bank_sync_restored_success') || 'Opération réintégrée dans la synchronisation' : 'Opération réintégrée dans la synchronisation', 'success');
        }
    },

    // ── AUTO-CATÉGORISATION IA (Conditionnelle) ──────────────────────
    async categorizeRowAI(csvId, btnEl) {
        if (!this.isAIEnabled()) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions.find(t => t.csv_id === csvId);
        if (!tx) return;

        const originalText = btnEl.innerText;
        btnEl.innerText = '⏳';
        btnEl.disabled = true;

        try {
            const res = await API.post('/api/ai/categorize', { description: tx.description });
            if (res && res.category) {
                tx.category = res.category;
                const sel = document.getElementById(`catSel_${csvId}`);
                if (sel) sel.value = res.category;
                this.showToast(`Catégorie suggérée : ${res.category}`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur IA : ' + (err.detail || err.message), 'error');
        } finally {
            btnEl.innerText = originalText;
            btnEl.disabled = false;
        }
    },

    async categorizeAllNewAI() {
        if (!this.isAIEnabled() || !this.previewData) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        const uncatTxs = currentAcc.transactions.filter(t => !t.is_reconciled && !t.category);
        if (uncatTxs.length === 0) {
            this.showToast('Toutes les nouvelles opérations sont déjà catégorisées.', 'info');
            return;
        }

        const btn = document.getElementById('btnSyncCategorizeAllAI');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> <span>Catégorisation IA en cours...</span>';
        }

        try {
            const descriptions = uncatTxs.map(t => t.description);
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res && res.categories) {
                uncatTxs.forEach((tx, idx) => {
                    const assigned = res.categories[idx];
                    if (assigned) {
                        tx.category = assigned;
                    }
                });
                this.renderReviewTable();
                this.showToast(`${uncatTxs.length} opération(s) catégorisée(s) par l'IA !`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur catégorisation IA en lot : ' + (err.detail || err.message), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>✨</span> <span>${window.i18n.t('bank_categorize_all_ai')}</span>`;
            }
        }
    },

    updateReviewSummary() {
        const box = document.getElementById('reviewSummaryBox');
        if (!box || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const currentTxs = currentAcc?.transactions || [];

        // Compteurs pour le compte actuellement affiché
        let accNew = 0;
        let accReconciled = 0;
        let accComing = 0;
        let accIgnored = 0;
        let accComingAmount = 0.0;

        currentTxs.forEach(tx => {
            const isIgnored = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
            if (isIgnored) {
                accIgnored++;
            } else if (tx.is_coming) {
                accComing++;
                const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                accComingAmount += rawAmt;
            } else if (tx.is_reconciled) {
                accReconciled++;
            } else {
                accNew++;
            }
        });

        // Mise à jour dynamique des boutons de filtre avec les compteurs
        const btnPending = document.getElementById('btnSyncFilterPending');
        const btnAll = document.getElementById('btnSyncFilterAll');
        const btnAdd = document.getElementById('btnSyncFilterAdd');
        const btnRec = document.getElementById('btnSyncFilterReconcile');
        const btnComing = document.getElementById('btnSyncFilterComing');
        const btnIgnored = document.getElementById('btnSyncFilterIgnored');

        const accPending = accNew + accReconciled + accComing;
        const lblPending = (window.i18n && window.i18n.t('bank_sync_filter_pending')) || 'À traiter';
        const lblAll = (window.i18n && window.i18n.t('bank_sync_filter_all')) || 'Toutes';
        const lblAdd = (window.i18n && window.i18n.t('bank_sync_filter_add')) || 'À ajouter';
        const lblRec = (window.i18n && window.i18n.t('bank_sync_filter_reconcile')) || 'À rapprocher';
        const lblComing = (window.i18n && window.i18n.t('bank_sync_filter_coming')) || 'En attente en ligne';
        const lblIgnored = (window.i18n && window.i18n.t('bank_sync_status_already_processed_short')) || 'Déjà traitées';

        if (btnPending) btnPending.textContent = `⚡ ${lblPending} (${accPending})`;
        if (btnAll) btnAll.textContent = `${lblAll} (${currentTxs.length})`;
        if (btnAdd) btnAdd.textContent = `${lblAdd} (+${accNew})`;
        if (btnRec) btnRec.textContent = `${lblRec} (${accReconciled})`;
        if (btnComing) {
            btnComing.textContent = `⏳ ${lblComing} (${accComing})`;
            btnComing.style.display = accComing > 0 ? 'inline-block' : 'none';
        }
        if (btnIgnored) btnIgnored.textContent = `${lblIgnored} (${accIgnored})`;

        // Compteurs globaux pour le résumé
        let totalNew = 0;
        let totalReconciled = 0;
        let totalComing = 0;
        let totalIgnored = 0;

        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                const isIgnored = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
                if (isIgnored) {
                    totalIgnored++;
                } else if (tx.is_coming) {
                    totalComing++;
                } else if (tx.is_reconciled) {
                    totalReconciled++;
                } else {
                    totalNew++;
                }
            });
        });

        const toAddStr = window.i18n.tp('bank_sync_summary_to_add', { count: totalNew });
        const toRecStr = window.i18n.tp('bank_sync_summary_to_reconcile', { count: totalReconciled });
        const comingStr = window.i18n.tp ? window.i18n.tp('bank_sync_summary_coming', { count: totalComing }) : `${totalComing} en attente en ligne`;
        const ignoredStr = (window.i18n.tp ? window.i18n.tp('bank_sync_summary_ignored', { count: totalIgnored }) : `${totalIgnored} déjà en base`).replace(/\(déjà en base\)/i, '(déjà traitées ou exclues)');

        // ── Badge solde fichier CSV ou solde bancaire ──
        const isCsvMode = this._reviewSource === 'csv_import';
        let balanceBadgeHtml = '';

        if (isCsvMode) {
            // Mode Import CSV — badge solde fichier
            const fileBalance = this.previewData?._fileBalance;
            if (fileBalance != null) {
                balanceBadgeHtml = `<span class="badge" style="background: rgba(99, 102, 241, 0.12); color: var(--accent); border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; padding: 3px 10px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;" title="${(window.i18n ? window.i18n.t('import_file_balance_tooltip') || 'Solde détecté dans le fichier importé' : 'Solde détecté dans le fichier importé').replace(/"/g, '&quot;')}">📊 ${window.i18n ? window.i18n.t('import_file_balance') || 'Solde fichier' : 'Solde fichier'} : ${parseFloat(fileBalance).toFixed(2)} €</span>`;
            }
        } else if (currentAcc && typeof currentAcc.bank_balance === 'number' && typeof currentAcc.local_reconciled_balance === 'number') {
            const delta = Math.round((currentAcc.bank_balance - currentAcc.local_reconciled_balance) * 100) / 100;
            if (Math.abs(delta) < 0.005) {
                balanceBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_tooltip_synced') : 'Soldes conformes').replace(/"/g, '&quot;')}">🟢 ${window.i18n ? window.i18n.t('bank_sync_balance_synced') || 'Soldes conformes' : 'Soldes conformes'} (${currentAcc.bank_balance.toFixed(2)} €)</span>`;
            } else {
                const diffFormatted = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' €';

                // Calculer l'impact net des opérations actives (non exclues) qui vont modifier le solde rapproché
                let netSyncImpact = 0.0;
                let hasResolvingTx = false;
                currentTxs.forEach(tx => {
                    const isIgnored = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled);
                    if (!isIgnored) {
                        const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                        if (!tx.is_coming) {
                            netSyncImpact += rawAmt;
                        }
                        if (tx._resolves_diff) {
                            hasResolvingTx = true;
                        }
                    }
                });

                const isResolvedBySync = hasResolvingTx || Math.abs(Math.round(netSyncImpact * 100) / 100 - delta) < 0.01;
                const isExplainedByComing = !isResolvedBySync && accComing > 0 && Math.abs(Math.abs(accComingAmount) - Math.abs(delta)) < 0.01;

                let explanationText = '';
                if (isResolvedBySync) {
                    explanationText = ` • 💡 ${window.i18n ? window.i18n.t('bank_sync_delta_resolved_by_sync') || 'Sera résolu par la validation des opérations.' : 'Sera résolu par la validation des opérations.'}`;
                } else if (isExplainedByComing) {
                    explanationText = ` • 💡 ${window.i18n ? window.i18n.tp('bank_sync_delta_explained_by_coming', { count: accComing }) : `Correspond aux ${accComing} opération(s) en attente en ligne.`}`;
                }

                const deltaTip = isResolvedBySync
                    ? (window.i18n ? window.i18n.t('bank_sync_delta_resolved_by_sync_tip') || "L'écart sera automatiquement comblé lors de l'enregistrement de vos opérations sélectionnées." : "L'écart sera automatiquement comblé lors de l'enregistrement de vos opérations sélectionnées.").replace(/"/g, '&quot;')
                    : (isExplainedByComing
                        ? (window.i18n ? window.i18n.tp('bank_sync_delta_explained_by_coming', { count: accComing }) : `L'écart de ${diffFormatted} s'explique par les opérations en attente de débit par la banque.`).replace(/"/g, '&quot;')
                        : (window.i18n ? window.i18n.t('bank_sync_balance_tooltip_diff') : 'Écart de solde').replace(/"/g, '&quot;'));

                const shouldShowAdjustBtn = !isResolvedBySync && !isExplainedByComing;

                const escapedAccName = (window.escapeHtml ? window.escapeHtml(currentAcc.account_name || 'Compte') : (currentAcc.account_name || 'Compte')).replace(/'/g, "\\'");
                const adjustBtnHtml = `<span onclick="window.BankSyncView.openBalanceAdjustModal(${currentAcc.account_id}, '${escapedAccName}', ${currentAcc.bank_balance}, ${currentAcc.local_reconciled_balance}, ${delta})" style="cursor: pointer; background: rgba(239, 68, 68, 0.2); padding: 1px 5px; border-radius: 3px; font-size: 10px; margin-left: 6px;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_adjust_tooltip') : 'Cliquer pour ajuster le solde').replace(/"/g, '&quot;')}">${window.i18n ? window.i18n.t('bank_sync_balance_adjust_btn') || '⚡ Ajuster' : '⚡ Ajuster'}</span>`;

                const badgeBg = isResolvedBySync ? 'rgba(16, 185, 129, 0.12)' : (isExplainedByComing ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)');
                const badgeColor = isResolvedBySync ? '#10b981' : (isExplainedByComing ? '#d97706' : '#ef4444');
                const badgeBorder = isResolvedBySync ? 'rgba(16, 185, 129, 0.35)' : (isExplainedByComing ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.3)');

                const rawReconciled = window.i18n ? window.i18n.t('bank_sync_reconciled_word') : '';
                const lblReconciled = (rawReconciled && rawReconciled !== 'bank_sync_reconciled_word') ? rawReconciled : 'Rapproché';
                balanceBadgeHtml = `<span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-weight: 700; padding: 3px 10px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;" title="${deltaTip}"><span>⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart'} : ${diffFormatted} (Banque: ${currentAcc.bank_balance.toFixed(2)} € • ${lblReconciled}: ${currentAcc.local_reconciled_balance.toFixed(2)} €)${explanationText}</span>${shouldShowAdjustBtn ? adjustBtnHtml : ''}</span>`;
            }
        }

        box.innerHTML = `
            <span>🟢 <strong>${toAddStr}</strong></span>
            <span>🔵 <strong>${toRecStr}</strong></span>
            ${!isCsvMode && totalComing > 0 ? `<span style="color: #d97706; cursor: pointer;" onclick="window.BankSyncView.setReviewFilter('coming')" title="Filtrer les opérations en attente">⏳ <strong>${comingStr}</strong></span>` : ''}
            <span style="color: var(--text-muted);">⚪ <strong>${ignoredStr}</strong></span>
            ${balanceBadgeHtml ? `<span style="border-left: 1px solid var(--border-color); padding-left: 12px; margin-left: 4px;">${balanceBadgeHtml}</span>` : ''}
        `;
    },

    async commitSync() {
        if (!this.previewData) return;
        const isCsvImport = this._reviewSource === 'csv_import';

        // En mode CSV, vérifier que tous les comptes concernés sont assignés
        if (isCsvImport) {
            const unassignedAcc = this.previewData.accounts?.find(a => !a.account_id && a.transactions && a.transactions.some(t => !t._excluded));
            if (unassignedAcc) {
                this.showToast(window.i18n ? window.i18n.t('msg_select_account') || 'Veuillez sélectionner un compte pour chaque onglet avant de valider.' : 'Veuillez sélectionner un compte pour chaque onglet avant de valider.', 'warning');
                return;
            }
        } else if (!this.activeConnId) {
            return;
        }

        const allTxs = [];
        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                if (tx._excluded) return; // Ignorer les opérations décochées par l'utilisateur
                allTxs.push({
                    account_id: acc.account_id,
                    date_operation: tx.date_operation,
                    description: tx.description,
                    raw_description: tx.raw_description || tx.description,
                    amount: tx.raw_amount != null ? tx.raw_amount : tx.amount,
                    raw_amount: tx.raw_amount,
                    category: tx.category,
                    csv_id: tx.csv_id,
                    is_reconciled: tx.is_reconciled,
                    already_reconciled: tx.already_reconciled,
                    matched_db_id: tx.matched_db_id,
                    is_coming: !!tx.is_coming,
                    attachments: tx.attachments || null,
                    check_slip_number: tx.check_slip_number || null
                });
            });
        });

        if (allTxs.length === 0) {
            this.showToast(window.i18n ? window.i18n.t('bank_sync_no_selected_txs') || 'Aucune opération sélectionnée à valider.' : 'Aucune opération sélectionnée à valider.', 'warning');
            return;
        }

        try {
            const targetConnId = isCsvImport ? -1 : this.activeConnId;
            const res = await API.post(`/api/bank-sync/connections/${targetConnId}/commit`, {
                transactions: allTxs
            });

            // Mettre à jour le preview en conservant les opérations non traitées (décochées) et les opérations en attente banque
            const committedCsvSet = new Set(allTxs.filter(t => !t.is_coming).map(t => t.csv_id).filter(Boolean));
            let hasRemaining = false;
            if (this.previewData && this.previewData.accounts) {
                this.previewData.accounts.forEach(acc => {
                    if (acc.transactions) {
                        acc.transactions = acc.transactions.filter(t => !committedCsvSet.has(t.csv_id));
                        if (acc.transactions.length > 0) hasRemaining = true;
                    }
                });
            }

            this.closeReviewModal();

            if (isCsvImport) {
                if (hasRemaining) {
                    this.saveCachedPreview('csv_import', this.previewData);
                    this.saveCachedPreview(-1, this.previewData);
                } else {
                    this.clearCachedPreview('csv_import');
                    this.clearCachedPreview(-1);
                    this.clearMatchOverrides('csv_import');
                    this.clearMatchOverrides(-1);
                }
                const count = res.imported || allTxs.length;
                const recCount = res.reconciled || 0;
                let msg = window.i18n ? window.i18n.tp('msg_import_done', { count }) || `${count} opération(s) importée(s).` : `${count} opération(s) importée(s).`;
                if (recCount > 0) {
                    msg += ` (✔ ${recCount} rapprochée(s))`;
                }
                this.showToast(msg, 'success');
                await this.loadPendingSync(true);
            } else {
                if (this.activeConnId) {
                    if (hasRemaining) {
                        this.saveCachedPreview(this.activeConnId, this.previewData);
                    } else {
                        this.clearCachedPreview(this.activeConnId);
                        this.clearMatchOverrides(this.activeConnId);
                    }
                }
                const comingCount = allTxs.filter(t => t.is_coming).length;
                let toastMsg = (window.i18n && window.i18n.tp)
                    ? window.i18n.tp('bank_sync_commit_toast', { imported: res.imported, reconciled: res.reconciled }) || `Synchronisation validée : +${res.imported} ajoutée(s), ✔ ${res.reconciled} rapprochée(s)`
                    : `Synchronisation validée : +${res.imported} ajoutée(s), ✔ ${res.reconciled} rapprochée(s)`;
                if (comingCount > 0) {
                    const comingSuffix = (window.i18n && window.i18n.tp)
                        ? window.i18n.tp('bank_sync_commit_toast_coming', { count: comingCount }) || `, ⏳ ${comingCount} en attente banque`
                        : `, ⏳ ${comingCount} en attente banque`;
                    toastMsg += comingSuffix;
                }
                this.showToast(toastMsg, 'success');
                await this.loadConnections();
                await this.loadPendingSync(true);
            }

            // Rafraîchir toutes les vues
            if (window.OverviewView && window.OverviewView.init) {
                window.OverviewView.init();
            }
            if (window.AccountsView && window.AccountsView.loadData) {
                window.AccountsView.loadData();
            }
            if (window.TimelineView && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.AllOperationsView && window.AllOperationsView.loadData) {
                window.AllOperationsView.loadData();
            }
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
        } catch (err) {
            this.showToast('Erreur lors de la validation : ' + (err.detail || err.message), 'error');
        }
    },

});
