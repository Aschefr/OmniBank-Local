// static/js/views/config/data_cleanup_modal.js — Boîte à Outils d'Assainissement & Santé des Données
window.DataCleanupModal = {
    overviewData: null,
    selectedToolId: 'abandoned_recurrences',
    isLoadingDetail: false,

    init() {
        if (document.getElementById('dataCleanupModal')) return;

        const modalHtml = `
        <div id="dataCleanupModal" class="modal-overlay" style="display:none; z-index:10001; backdrop-filter:blur(5px); background:rgba(15,23,42,0.75);">
            <div class="cleanup-modal-container">
                <!-- Header -->
                <div class="cleanup-modal-header">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:42px; height:42px; border-radius:12px; background:linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2)); border:1px solid rgba(99,102,241,0.4); display:flex; align-items:center; justify-content:center; font-size:22px;">
                            🧹
                        </div>
                        <div>
                            <h3 style="margin:0; font-size:17px; font-weight:800; color:var(--text-main); letter-spacing:-0.3px;" data-i18n="maintenance_cleanup_modal_title">
                                Boîte à Outils d'Assainissement & Santé des Données
                            </h3>
                            <p style="margin:2px 0 0 0; font-size:12px; color:var(--text-muted);" data-i18n="maintenance_cleanup_modal_subtitle">
                                Diagnostic automatique de l'intégrité de vos récurrences, transactions et catégories.
                            </p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="btn btn-secondary" onclick="window.DataCleanupModal.runOverviewAnalysis()" title="Relancer l'analyse" style="font-size:12px; padding:6px 10px; display:flex; align-items:center; gap:5px;">
                            🔄 <span data-i18n="btn_reanalyze">Réanalyser</span>
                        </button>
                        <button onclick="window.DataCleanupModal.close()" style="background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:6px 10px; border-radius:8px; transition:background 0.2s;" onmouseover="this.style.background='var(--bg-body)'" onmouseout="this.style.background='none'">✕</button>
                    </div>
                </div>

                <!-- Body -->
                <div class="cleanup-modal-body">
                    <!-- Status Banner -->
                    <div id="cleanupStatusBanner" class="cleanup-status-banner status-scanning">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span id="cleanupStatusBannerIcon" style="font-size:18px;">⏳</span>
                            <span id="cleanupStatusBannerText" style="font-weight:600;">Analyse globale en cours de votre base de données...</span>
                        </div>
                        <span id="cleanupStatusBannerBadge" class="cleanup-badge cleanup-badge-scanning">Scan en cours</span>
                    </div>

                    <!-- 5 Tools Grid -->
                    <div class="cleanup-tools-grid" id="cleanupToolsGrid">
                        <!-- Tool 1: Abandoned Recurrences -->
                        <div class="cleanup-tool-card" id="cleanupCard_abandoned_recurrences" onclick="window.DataCleanupModal.selectTool('abandoned_recurrences')">
                            <div class="cleanup-tool-card-head">
                                <div class="cleanup-tool-card-title">
                                    <span>🛑</span> <span data-i18n="cleanup_tool_abandoned_title">Récurrences abandonnées</span>
                                </div>
                                <span class="cleanup-badge cleanup-badge-scanning" id="cleanupBadge_abandoned_recurrences">⏳ Scan</span>
                            </div>
                            <p class="cleanup-tool-card-desc" data-i18n="cleanup_tool_abandoned_desc">
                                Clôture les modèles inactifs ou à 0 € et purge leurs opérations prévisionnelles fantômes.
                            </p>
                        </div>

                        <!-- Tool 2: Orphan Recurrences -->
                        <div class="cleanup-tool-card" id="cleanupCard_orphan_recurrences" onclick="window.DataCleanupModal.selectTool('orphan_recurrences')">
                            <div class="cleanup-tool-card-head">
                                <div class="cleanup-tool-card-title">
                                    <span>🧹</span> <span data-i18n="cleanup_tool_orphan_title">Opérations orphelines</span>
                                </div>
                                <span class="cleanup-badge cleanup-badge-scanning" id="cleanupBadge_orphan_recurrences">⏳ Scan</span>
                            </div>
                            <p class="cleanup-tool-card-desc" data-i18n="cleanup_tool_orphan_desc">
                                Supprime les échéances non pointées sur des années sans activité réelle ou modèles clos.
                            </p>
                        </div>

                        <!-- Tool 3: Misplaced Categories -->
                        <div class="cleanup-tool-card" id="cleanupCard_misplaced_categories" onclick="window.DataCleanupModal.selectTool('misplaced_categories')">
                            <div class="cleanup-tool-card-head">
                                <div class="cleanup-tool-card-title">
                                    <span>🏷️</span> <span data-i18n="cleanup_tool_cats_title">Catégories mal classées</span>
                                </div>
                                <span class="cleanup-badge cleanup-badge-scanning" id="cleanupBadge_misplaced_categories">⏳ Scan</span>
                            </div>
                            <p class="cleanup-tool-card-desc" data-i18n="cleanup_tool_cats_desc">
                                Détecte les catégories en contradiction avec les flux réels (virements, dépenses, recettes).
                            </p>
                        </div>

                        <!-- Tool 4: Inconsistent Types -->
                        <div class="cleanup-tool-card" id="cleanupCard_fix_type_mismatch" onclick="window.DataCleanupModal.selectTool('fix_type_mismatch')">
                            <div class="cleanup-tool-card-head">
                                <div class="cleanup-tool-card-title">
                                    <span>🔧</span> <span data-i18n="cleanup_tool_types_title">Types incohérents</span>
                                </div>
                                <span class="cleanup-badge cleanup-badge-scanning" id="cleanupBadge_fix_type_mismatch">⏳ Scan</span>
                            </div>
                            <p class="cleanup-tool-card-desc" data-i18n="cleanup_tool_types_desc">
                                Reclasse les dépenses variables avec récurrence en charges fixes légitimes.
                            </p>
                        </div>

                        <!-- Tool 5: Suspended Zeroed Recurrences -->
                        <div class="cleanup-tool-card" id="cleanupCard_convert_zeroed_to_skipped" onclick="window.DataCleanupModal.selectTool('convert_zeroed_to_skipped')">
                            <div class="cleanup-tool-card-head">
                                <div class="cleanup-tool-card-title">
                                    <span>🔄</span> <span data-i18n="cleanup_tool_zeroed_title">Récurrences à 0 €</span>
                                </div>
                                <span class="cleanup-badge cleanup-badge-scanning" id="cleanupBadge_convert_zeroed_to_skipped">⏳ Scan</span>
                            </div>
                            <p class="cleanup-tool-card-desc" data-i18n="cleanup_tool_zeroed_desc">
                                Convertit les échéances à 0 € en statuts « Ignorées » pour réactiver la génération.
                            </p>
                        </div>
                    </div>

                    <!-- Detail & Validation Panel -->
                    <div class="cleanup-detail-panel" id="cleanupDetailPanel">
                        <div style="display:flex; align-items:center; justify-content:center; height:180px; color:var(--text-muted); font-size:13px; gap:8px;">
                            <span>⏳</span> <span>Chargement du détail...</span>
                        </div>
                    </div>

                    <!-- Bottom padding spacer -->
                    <div style="height: 20px; flex-shrink: 0;"></div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    open() {
        this.init();
        const modal = document.getElementById('dataCleanupModal');
        if (modal) {
            modal.style.display = 'flex';
            this.runOverviewAnalysis();
        }
    },

    close() {
        const modal = document.getElementById('dataCleanupModal');
        if (modal) modal.style.display = 'none';
    },

    async runOverviewAnalysis() {
        this.init();
        const banner = document.getElementById('cleanupStatusBanner');
        const bannerIcon = document.getElementById('cleanupStatusBannerIcon');
        const bannerText = document.getElementById('cleanupStatusBannerText');
        const bannerBadge = document.getElementById('cleanupStatusBannerBadge');

        // Reset cards to animated scanning state
        const toolIds = [
            'abandoned_recurrences',
            'orphan_recurrences',
            'misplaced_categories',
            'fix_type_mismatch',
            'convert_zeroed_to_skipped'
        ];

        toolIds.forEach(id => {
            const badge = document.getElementById(`cleanupBadge_${id}`);
            if (badge) {
                badge.className = 'cleanup-badge cleanup-badge-scanning';
                badge.innerHTML = '⏳ Scan...';
            }
        });

        if (banner) {
            banner.className = 'cleanup-status-banner status-scanning';
            if (bannerIcon) bannerIcon.textContent = '🔍';
            if (bannerText) bannerText.textContent = window.i18n ? window.i18n.t('cleanup_scanning_in_progress') || "Analyse globale en cours de votre base de données..." : "Analyse globale en cours...";
            if (bannerBadge) {
                bannerBadge.className = 'cleanup-badge cleanup-badge-scanning';
                bannerBadge.textContent = 'Diagnostic...';
            }
        }

        try {
            const data = await API.get('/api/maintenance/overview');
            this.overviewData = data;

            // Render badges with count / conforme
            let firstWarningTool = null;

            toolIds.forEach(id => {
                const toolInfo = data.tools[id];
                const badge = document.getElementById(`cleanupBadge_${id}`);
                if (!badge || !toolInfo) return;

                if (toolInfo.count > 0) {
                    badge.className = 'cleanup-badge cleanup-badge-warning';
                    badge.innerHTML = `⚠️ ${toolInfo.count} à corriger`;
                    if (!firstWarningTool) firstWarningTool = id;
                } else {
                    badge.className = 'cleanup-badge cleanup-badge-ok';
                    badge.innerHTML = `✓ Conforme`;
                }
            });

            // Update banner
            if (banner) {
                if (data.total_anomalies > 0) {
                    banner.className = 'cleanup-status-banner status-warning';
                    if (bannerIcon) bannerIcon.textContent = '⚠️';
                    if (bannerText) {
                        const tText = (window.i18n && window.i18n.t) ? window.i18n.t('cleanup_banner_warning') || "Diagnostic : {count} suggestion(s) d'assainissement identifiée(s)." : "Diagnostic : {count} suggestion(s) d'assainissement identifiée(s).";
                        bannerText.innerHTML = tText.replace('{count}', `<strong>${data.total_anomalies}</strong>`);
                    }
                    if (bannerBadge) {
                        bannerBadge.className = 'cleanup-badge cleanup-badge-warning';
                        bannerBadge.textContent = `${data.total_anomalies} anomalie(s)`;
                    }
                } else {
                    banner.className = 'cleanup-status-banner status-ok';
                    if (bannerIcon) bannerIcon.textContent = '✨';
                    if (bannerText) bannerText.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('cleanup_banner_ok') || "Base saine : Aucune anomalie détectée sur l'ensemble des 5 outils de maintenance." : "Base saine : Aucune anomalie détectée.";
                    if (bannerBadge) {
                        bannerBadge.className = 'cleanup-badge cleanup-badge-ok';
                        bannerBadge.textContent = '✓ Intégrité 100%';
                    }
                }
            }

            // Update header trigger badge in config view if present
            const triggerBadge = document.getElementById('cleanupModalTriggerBadge');
            if (triggerBadge) {
                if (data.total_anomalies > 0) {
                    triggerBadge.style.display = 'inline-block';
                    triggerBadge.textContent = `${data.total_anomalies}`;
                } else {
                    triggerBadge.style.display = 'none';
                }
            }

            // Auto-select tool: prioritize the first tool with warnings, or keep current
            const targetTool = (this.selectedToolId && data.tools[this.selectedToolId]?.count > 0)
                ? this.selectedToolId
                : (firstWarningTool || this.selectedToolId || 'abandoned_recurrences');

            this.selectTool(targetTool);

        } catch (e) {
            console.error('[DataCleanupModal] Erreur scan overview:', e);
            if (bannerText) bannerText.textContent = "Erreur lors de l'analyse : " + e.message;
            if (banner) banner.className = 'cleanup-status-banner status-warning';
        }
    },

    selectTool(toolId) {
        this.selectedToolId = toolId;

        // Update active class
        const cards = document.querySelectorAll('.cleanup-tool-card');
        cards.forEach(card => card.classList.remove('active'));

        const activeCard = document.getElementById(`cleanupCard_${toolId}`);
        if (activeCard) activeCard.classList.add('active');

        // Render detail
        this.renderToolDetail(toolId);
    },

    async renderToolDetail(toolId) {
        const container = document.getElementById('cleanupDetailPanel');
        if (!container) return;

        container.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; height:180px; color:var(--text-muted); font-size:13px; gap:8px;">
                <span>⏳</span> <span>Chargement de l'outil...</span>
            </div>
        `;

        try {
            switch (toolId) {
                case 'abandoned_recurrences':
                    await this._renderAbandonedRecurrences(container);
                    break;
                case 'orphan_recurrences':
                    await this._renderOrphanRecurrences(container);
                    break;
                case 'misplaced_categories':
                    await this._renderMisplacedCategories(container);
                    break;
                case 'fix_type_mismatch':
                    await this._renderFixTypeMismatch(container);
                    break;
                case 'convert_zeroed_to_skipped':
                    await this._renderConvertZeroed(container);
                    break;
            }
        } catch (e) {
            console.error(`[DataCleanupModal] Erreur chargement détail ${toolId}:`, e);
            container.innerHTML = `
                <div style="padding:20px; color:#ef4444; background:rgba(239,68,68,0.1); border-radius:10px; border:1px solid rgba(239,68,68,0.25);">
                    <strong>Erreur de chargement :</strong> ${e.message}
                </div>
            `;
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Tool: Abandoned Recurrences
    // ──────────────────────────────────────────────────────────────────────────
    async _renderAbandonedRecurrences(container) {
        const preview = await API.get('/api/maintenance/abandoned_recurrences/preview');

        if (preview.count === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px;">
                    <div style="font-size:36px; margin-bottom:10px;">✨</div>
                    <h4 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:var(--text-main);">
                        ${window.i18n ? window.i18n.t('cleanup_abandoned_none_title') || "Aucune récurrence abandonnée détectée" : "Aucune récurrence abandonnée détectée"}
                    </h4>
                    <p style="margin:0; font-size:13px; color:var(--text-muted); max-width:480px; margin:0 auto; line-height:1.5;">
                        ${window.i18n ? window.i18n.t('cleanup_abandoned_none_desc') || "Tous vos modèles de récurrence actifs sont suivis régulièrement ou ont des opérations récentes." : "Tous vos modèles de récurrence actifs sont suivis régulièrement."}
                    </p>
                </div>
            `;
            return;
        }

        // Sort templates: suspicious ops first, then higher phantom count, then inactive
        const sortedTemplates = [...(preview.templates || [])].sort((a, b) => {
            const aSusp = (a.suspicious_ops?.length || 0);
            const bSusp = (b.suspicious_ops?.length || 0);
            if (bSusp !== aSusp) return bSusp - aSusp;
            const aPhant = (a.unpointed_count || 0);
            const bPhant = (b.unpointed_count || 0);
            if (bPhant !== aPhant) return bPhant - aPhant;
            return 0;
        });

        const templatesHtml = sortedTemplates.map(tpl => {
            const freqLabel = tpl.frequency === 'Monthly' ? 'Mensuel' : (tpl.frequency === 'Yearly' ? 'Annuel' : tpl.frequency);
            const amtStr = formatCurrency(tpl.amount);
            const phantomCount = tpl.unpointed_count || 0;
            const phantomBadge = phantomCount > 0
                ? `<span style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); padding:3px 9px; border-radius:6px; font-size:11px; font-weight:700;">🗑️ ${phantomCount} prévision(s) fantômes à purger</span>`
                : `<span style="background:rgba(16,185,129,0.12); color:#10b981; padding:3px 9px; border-radius:6px; font-size:11px; font-weight:600;">0 prévision en attente</span>`;

            const suspiciousOps = tpl.suspicious_ops || [];
            const phantomOps = tpl.phantom_ops || [];
            const confirmedOps = (tpl.recent_confirmed_sample || []).filter(c => !suspiciousOps.some(s => s.id === c.id));
            const hasSuspicious = suspiciousOps.length > 0;
            const totalOps = suspiciousOps.length + confirmedOps.length + phantomOps.length;

            // Suspicious real operations (PRESERVED)
            const suspiciousRowsHtml = suspiciousOps.map(op => `
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:8px 12px; background:var(--bg-surface); border-radius:8px; border:1px solid rgba(245,158,11,0.35); font-size:12px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="color:var(--text-muted); font-family:monospace; font-size:11px;">${op.date_operation}</span>
                        <strong style="color:var(--text-main); font-size:12.5px;">${op.description}</strong>
                        <span style="background:rgba(245,158,11,0.2); color:#f59e0b; border:1px solid rgba(245,158,11,0.4); padding:2px 7px; border-radius:4px; font-weight:700; font-size:10.5px;">
                            ⚠️ Rattachée par erreur
                        </span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <strong style="color:var(--text-main); font-size:13px;">${formatCurrency(op.amount)}</strong>
                        <span style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">
                            🛡️ Réelle • CONSERVÉE en compte
                        </span>
                    </div>
                </div>
            `).join('');

            // Standard confirmed real operations (PRESERVED)
            const confirmedRowsHtml = confirmedOps.map(op => `
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:7px 10px; background:var(--bg-surface); border-radius:6px; border:1px solid var(--border-color); font-size:12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--text-muted); font-family:monospace; font-size:11px;">${op.date_operation}</span>
                        <span style="color:var(--text-main); font-weight:500;">${op.description}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <strong style="color:var(--text-main); font-size:12.5px;">${formatCurrency(op.amount)}</strong>
                        <span style="background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); padding:2px 7px; border-radius:4px; font-size:10.5px; font-weight:600;">
                            🛡️ Réelle • CONSERVÉE
                        </span>
                    </div>
                </div>
            `).join('');

            // Phantom future operations (PURGED)
            const phantomRowsHtml = phantomOps.map(p => `
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:6px 10px; background:var(--bg-surface); border-radius:6px; border:1px solid var(--border-color); font-size:12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--text-muted); font-family:monospace; font-size:11px;">${p.date_operation}</span>
                        <span style="color:var(--text-main); font-weight:500;">${p.description}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="color:#ef4444; font-size:12px;">${formatCurrency(p.amount)}</strong>
                        <span style="background:rgba(239,68,68,0.12); color:#ef4444; border:1px solid rgba(239,68,68,0.25); padding:2px 6px; border-radius:4px; font-size:10.5px; font-weight:600;">
                            🗑️ Prévision non pointée (sera supprimée)
                        </span>
                    </div>
                </div>
            `).join('');

            return `
                <div class="cleanup-template-card" style="background:var(--bg-body); border:1px solid var(--border-color); border-radius:12px; padding:14px 16px; display:flex; flex-direction:column; gap:10px; flex-shrink:0;">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:700; font-size:14px; color:var(--text-main);">
                            <input type="checkbox" class="cleanup-abandoned-cb" value="${tpl.id}" checked style="width:17px; height:17px; accent-color:var(--accent); cursor:pointer;">
                            <span>${tpl.description}</span>
                            <span style="font-size:11.5px; font-weight:500; color:var(--text-muted); padding:2px 8px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:6px;">
                                ${freqLabel} • ${amtStr}
                            </span>
                        </label>
                        ${phantomBadge}
                    </div>

                    <div style="font-size:12.5px; color:#f59e0b; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:8px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span>⚠️</span>
                            <span>${tpl.reason}</span>
                        </div>
                        <button type="button" class="cleanup-inspect-btn" id="cleanupInspectBtn_${tpl.id}" data-total-ops="${totalOps}" onclick="window.DataCleanupModal.toggleInspect(${tpl.id})">
                            ${hasSuspicious ? '🙈 Masquer le détail (' + totalOps + ')' : '👁️ Voir les opérations (' + totalOps + ')'}
                        </button>
                    </div>

                    <!-- Inspection Box (Visible by default if suspicious op detected) -->
                    <div id="cleanupInspectBox_${tpl.id}" class="cleanup-inspect-box" style="display:${hasSuspicious ? 'flex' : 'none'};">
                        <!-- Reassuring Header Banner -->
                        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:9px 12px; display:flex; align-items:center; gap:8px; font-size:12px; color:#10b981; font-weight:600;">
                            <span>🛡️</span>
                            <span>Garantie d'intégrité : Aucune opération réelle confirmée n'est supprimée. Vos soldes et calculs bancaires restent 100% exacts.</span>
                        </div>

                        <!-- Suspicious Operations Section -->
                        ${hasSuspicious ? `
                        <div style="background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                                <div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#f59e0b; font-size:12px;">
                                    <span>⚠️</span> <span>Opération(s) suspecte(s) rattachée(s) par erreur lors d'un import</span>
                                </div>
                                <span style="font-size:11px; color:#10b981; font-weight:700;">NE SERONT PAS SUPPRIMÉES</span>
                            </div>
                            <p style="margin:0 0 6px 0; font-size:11.5px; color:var(--text-muted); line-height:1.4;">
                                Cette opération bancaire bien réelle (ex. <em>Retrait liquide</em>) a été associée par erreur à ce modèle après une longue interruption. <strong>Elle reste intacte sur votre compte</strong> : seul le lien avec le modèle est retiré pour vous permettre de clôturer la récurrence en toute sécurité.
                            </p>
                            <div style="display:flex; flex-direction:column; gap:5px;">
                                ${suspiciousRowsHtml}
                            </div>
                        </div>` : ''}

                        <!-- Real confirmed operations section -->
                        ${confirmedOps.length > 0 ? `
                        <div style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.22); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                                <div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#10b981; font-size:12px;">
                                    <span>🛡️</span> <span>Historique des opérations réelles confirmées (${confirmedOps.length})</span>
                                </div>
                                <span style="font-size:11px; color:#10b981; font-weight:700;">NE SERONT PAS SUPPRIMÉES</span>
                            </div>
                            <p style="margin:0 0 4px 0; font-size:11.5px; color:var(--text-muted); line-height:1.4;">
                                Ces opérations correspondent aux paiements passés réguliers. Elles sont conservées pour votre comptabilité.
                            </p>
                            <div style="display:flex; flex-direction:column; gap:4px; max-height:140px; overflow-y:auto; padding-right:4px;">
                                ${confirmedRowsHtml}
                            </div>
                        </div>` : ''}

                        <!-- Phantom operations section -->
                        ${phantomOps.length > 0 ? `
                        <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                                <div style="display:flex; align-items:center; gap:6px; font-weight:700; color:#ef4444; font-size:12px;">
                                    <span>🗑️</span> <span>Opérations prévisionnelles fantômes (${phantomOps.length} non pointées à supprimer)</span>
                                </div>
                                <span style="font-size:11px; color:var(--text-muted);">Générées pour les mois futurs</span>
                            </div>
                            <p style="margin:0 0 6px 0; font-size:11.5px; color:var(--text-muted); line-height:1.4;">
                                Ces échéances n'ont jamais été rapprochées sur vos relevés. Ce sont de simples prévisions créées automatiquement qui encombrent inutilement votre calendrier futur.
                            </p>
                            <div style="display:flex; flex-direction:column; gap:4px; max-height:180px; overflow-y:auto; padding-right:4px;">
                                ${phantomRowsHtml}
                            </div>
                        </div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:16px; flex-shrink:0;">
                <!-- Header Info -->
                <div style="display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border-color); padding-bottom:12px; flex-shrink:0;">
                    <div>
                        <h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                            <span>🛑</span> <span>Clôture des Récurrences Abandonnées & Purge des Fantômes</span>
                        </h4>
                        <p style="margin:0; font-size:12.5px; color:var(--text-muted); line-height:1.4;">
                            Ces modèles sont inactifs depuis des mois/années ou terminés par des échéances à 0,00 €. Les clôturer supprime leurs prévisions futures sans altérer vos opérations réelles.
                        </p>
                    </div>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:600; color:var(--accent);">
                        <input type="checkbox" id="abandonedSelectAll" checked onchange="document.querySelectorAll('.cleanup-abandoned-cb').forEach(cb => { cb.checked = this.checked; window.DataCleanupModal._updateAbandonedCount(); })">
                        <span>Tout sélectionner (${preview.count})</span>
                    </label>
                </div>

                <!-- Template Cards List (natural flow, no double scrollbar) -->
                <div style="display:flex; flex-direction:column; gap:12px; flex-shrink:0;">
                    ${templatesHtml}
                </div>

                <!-- Safe Options & Apply Action with Generous Padding -->
                <div style="border-top:1px solid var(--border-color); padding-top:22px; margin-top:14px; padding-bottom:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; flex-shrink:0;">
                    <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:13px; color:var(--text-main); font-weight:500;">
                        <input type="checkbox" id="cleanupUnlinkMismatched" checked style="accent-color:var(--accent); width:18px; height:18px; cursor:pointer;">
                        <span>Délier les opérations confirmées incompatibles (ex. retrait liquide sur virement)</span>
                    </label>

                    <button class="btn btn-primary" id="btnApplyAbandoned" onclick="window.DataCleanupModal.applyAbandonedFix()" style="display:flex; align-items:center; gap:10px; padding:12px 26px; font-size:14px; font-weight:700; background:linear-gradient(135deg, #ef4444, #dc2626); border-color:#dc2626; box-shadow:0 6px 18px rgba(239,68,68,0.28); border-radius:10px; cursor:pointer;">
                        <span>🗑️</span> <span id="btnApplyAbandonedText">Clôturer et purger la sélection (${preview.count})</span>
                    </button>
                </div>
            </div>
        `;

        // Attach change listeners to update count
        document.querySelectorAll('.cleanup-abandoned-cb').forEach(cb => {
            cb.addEventListener('change', () => this._updateAbandonedCount());
        });
    },

    toggleInspect(tplId) {
        const box = document.getElementById(`cleanupInspectBox_${tplId}`);
        const btn = document.getElementById(`cleanupInspectBtn_${tplId}`);
        if (!box) return;
        const isHidden = box.style.display === 'none';
        box.style.display = isHidden ? 'flex' : 'none';
        if (btn) {
            const countText = btn.dataset.totalOps ? ` (${btn.dataset.totalOps})` : '';
            btn.innerHTML = isHidden ? `🙈 Masquer le détail${countText}` : `👁️ Voir les opérations${countText}`;
        }
        if (isHidden) {
            // Smoothly scroll the newly unfolded inspection box into view
            setTimeout(() => {
                box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 60);
        }
    },

    _updateAbandonedCount() {
        const checked = document.querySelectorAll('.cleanup-abandoned-cb:checked').length;
        const btnText = document.getElementById('btnApplyAbandonedText');
        const btn = document.getElementById('btnApplyAbandoned');
        if (btnText) btnText.textContent = `Clôturer et purger la sélection (${checked})`;
        if (btn) btn.disabled = checked === 0;
    },

    async applyAbandonedFix() {
        const checkboxes = document.querySelectorAll('.cleanup-abandoned-cb:checked');
        const selectedIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        if (selectedIds.length === 0) {
            showToast("Veuillez sélectionner au moins un modèle à clôturer.", "info");
            return;
        }

        const unlinkMismatched = document.getElementById('cleanupUnlinkMismatched')?.checked ?? true;
        const btn = document.getElementById('btnApplyAbandoned');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Clôture & purge en cours...';
        }

        try {
            const res = await API.post('/api/maintenance/abandoned_recurrences/apply', {
                template_ids: selectedIds,
                purge_unreconciled: true,
                unlink_mismatched: unlinkMismatched
            });

            showToast(res.message || "Assainissement terminé avec succès !", "success", 4500);

            // Reactive Zero F5 dispatch
            window.dispatchEvent(new CustomEvent('recurrences-changed'));
            window.dispatchEvent(new CustomEvent('transactions-changed'));
            window.dispatchEvent(new CustomEvent('stats-changed'));
            window.dispatchEvent(new CustomEvent('app:data-changed'));
            if (window.app && window.app.refreshSidebar) window.app.refreshSidebar();

            // Re-run overview analysis automatically
            await this.runOverviewAnalysis();

        } catch (e) {
            console.error('[DataCleanupModal] Erreur applyAbandonedFix:', e);
            showToast("Erreur : " + e.message, "danger");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🗑️ Réessayer';
            }
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Tool: Orphan Recurrences
    // ──────────────────────────────────────────────────────────────────────────
    async _renderOrphanRecurrences(container) {
        const preview = await API.get('/api/maintenance/orphan_recurrences/preview');

        if (preview.count === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px;">
                    <div style="font-size:36px; margin-bottom:10px;">✨</div>
                    <h4 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:var(--text-main);">
                        Aucune opération orpheline détectée
                    </h4>
                    <p style="margin:0; font-size:13px; color:var(--text-muted); max-width:480px; margin:0 auto; line-height:1.5;">
                        Toutes vos opérations issues de récurrences correspondent à des modèles actifs et suivis.
                    </p>
                </div>
            `;
            return;
        }

        let groupsHtml = preview.groups.map(group => {
            const closedBadge = group.is_closed
                ? `<span style="background:rgba(239,68,68,0.15); color:#ef4444; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:700; margin-left:8px;">Clôturé</span>`
                : '';

            const txRows = group.transactions.map(tx => {
                const dateStr = tx.date_operation ? tx.date_operation.split('T')[0] : '-';
                return `
                    <label style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--border-color); cursor:pointer; font-size:12px;">
                        <input type="checkbox" class="cleanup-orphan-cb" value="${tx.id}" checked style="width:16px; height:16px; accent-color:var(--accent);">
                        <span style="color:var(--text-muted); min-width:80px;">${dateStr}</span>
                        <span style="font-weight:600; flex:1;">${tx.description}</span>
                        <span style="color:var(--text-muted);">${tx.category || ''}</span>
                        <span style="font-weight:700; min-width:80px; text-align:right;">${formatCurrency(tx.amount)}</span>
                    </label>
                `;
            }).join('');

            return `
                <div style="background:var(--bg-body); border:1px solid var(--border-color); border-radius:10px; overflow:hidden;">
                    <div style="padding:10px 14px; background:var(--bg-surface); border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:8px;">
                        <span>🔄</span>
                        <strong style="font-size:13px; color:var(--text-main);">${group.template_description}</strong>
                        ${closedBadge}
                        <span style="margin-left:auto; font-size:11px; color:var(--text-muted);">${group.transactions.length} op.</span>
                    </div>
                    <div>${txRows}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; flex-shrink:0;">
                <div style="display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
                    <div>
                        <h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                            <span>🧹</span> <span>Suppression des Échéances Orphelines</span>
                        </h4>
                        <p style="margin:0; font-size:12.5px; color:var(--text-muted); line-height:1.4;">
                            Ces opérations non pointées ont été générées automatiquement pour des modèles abandonnés ou sans transaction rapprochée la même année.
                        </p>
                    </div>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:600; color:var(--accent);">
                        <input type="checkbox" id="orphanSelectAll" checked onchange="document.querySelectorAll('.cleanup-orphan-cb').forEach(cb => { cb.checked = this.checked; window.DataCleanupModal._updateOrphanCount(); })">
                        <span>Tout sélectionner (${preview.count})</span>
                    </label>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; max-height:360px; overflow-y:auto; padding-right:4px;">
                    ${groupsHtml}
                </div>

                <div style="border-top:1px solid var(--border-color); padding-top:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                    <div style="font-size:12px; color:#ef4444;">
                        ⚠️ Les opérations rapprochées ne sont jamais supprimées.
                    </div>
                    <button class="btn btn-danger" id="btnApplyOrphans" onclick="window.DataCleanupModal.applyOrphanFix()" style="display:flex; align-items:center; gap:8px; padding:8px 18px; font-weight:700;">
                        <span>🗑️</span> <span id="btnApplyOrphansText">Supprimer la sélection (${preview.count})</span>
                    </button>
                </div>
            </div>
        `;

        document.querySelectorAll('.cleanup-orphan-cb').forEach(cb => {
            cb.addEventListener('change', () => this._updateOrphanCount());
        });
    },

    _updateOrphanCount() {
        const checked = document.querySelectorAll('.cleanup-orphan-cb:checked').length;
        const btnText = document.getElementById('btnApplyOrphansText');
        const btn = document.getElementById('btnApplyOrphans');
        if (btnText) btnText.textContent = `Supprimer la sélection (${checked})`;
        if (btn) btn.disabled = checked === 0;
    },

    async applyOrphanFix() {
        const selectedIds = Array.from(document.querySelectorAll('.cleanup-orphan-cb:checked')).map(cb => parseInt(cb.value));
        if (selectedIds.length === 0) {
            showToast("Aucune opération sélectionnée.", "info");
            return;
        }

        const btn = document.getElementById('btnApplyOrphans');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Suppression en cours...'; }

        try {
            const res = await API.post('/api/maintenance/orphan_recurrences/cleanup', selectedIds);
            showToast(`${res.deleted} opération(s) orpheline(s) supprimée(s).`, "success");

            window.dispatchEvent(new CustomEvent('transactions-changed'));
            window.dispatchEvent(new CustomEvent('stats-changed'));
            window.dispatchEvent(new CustomEvent('app:data-changed'));
            if (window.app && window.app.refreshSidebar) window.app.refreshSidebar();

            await this.runOverviewAnalysis();
        } catch (e) {
            console.error('[DataCleanupModal] Erreur applyOrphanFix:', e);
            showToast("Erreur : " + e.message, "danger");
            if (btn) { btn.disabled = false; btn.innerHTML = '🗑️ Réessayer'; }
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Tool: Misplaced Categories
    // ──────────────────────────────────────────────────────────────────────────
    async _renderMisplacedCategories(container) {
        const preview = await API.get('/api/maintenance/misplaced_categories/preview');

        if (preview.count === 0 && (!preview.total_tx_mismatches || preview.total_tx_mismatches === 0)) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px;">
                    <div style="font-size:36px; margin-bottom:10px;">✨</div>
                    <h4 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:var(--text-main);">
                        Catégories parfaitement alignées
                    </h4>
                    <p style="margin:0; font-size:13px; color:var(--text-muted); max-width:480px; margin:0 auto; line-height:1.5;">
                        Toutes vos catégories et leurs transactions associées correspondent fidèlement à la réalité de vos flux financiers.
                    </p>
                </div>
            `;
            return;
        }

        const typeLabels = {
            'expense_var': 'Dépense variable',
            'expense_fixed': 'Charge fixe',
            'income': 'Recette',
            'transfer': 'Virement interne'
        };

        const cardsHtml = (preview.categories || []).map((c, idx) => {
            const curLabel = typeLabels[c.current_type] || c.current_type;
            const sugLabel = typeLabels[c.suggested_type] || c.suggested_type;

            return `
                <div style="background:var(--bg-body); border:1px solid var(--border-color); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                        <strong style="font-size:14px; color:var(--text-main);">🏷️ ${c.name}</strong>
                        <span style="font-size:12px; color:var(--text-muted);">${c.total_txs} op. • ${c.templates_count} modèle(s)</span>
                    </div>

                    <div style="font-size:12px; color:#f59e0b; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:6px; padding:6px 10px;">
                        ⚠️ ${c.reason}
                    </div>

                    <div style="display:flex; align-items:center; gap:16px; margin-top:2px; font-size:12px;">
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:700; color:#10b981;">
                            <input type="radio" name="cleanup_misplaced_${idx}" value="${c.suggested_type}" checked data-cat="${c.name}">
                            <span>Reclasser en « ${sugLabel} » (recommandé)</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:var(--text-muted);">
                            <input type="radio" name="cleanup_misplaced_${idx}" value="${c.current_type}" data-cat="${c.name}">
                            <span>Garder actuel (${curLabel})</span>
                        </label>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; flex-shrink:0;">
                <div style="border-bottom:1px solid var(--border-color); padding-bottom:12px;">
                    <h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <span>🏷️</span> <span>Diagnostic & Reclassement des Catégories</span>
                    </h4>
                    <p style="margin:0; font-size:12.5px; color:var(--text-muted); line-height:1.4;">
                        ${preview.count} anomalie(s) détectée(s) : le type déclaré de la catégorie est en contradiction avec la direction réelle des flux.
                    </p>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; max-height:340px; overflow-y:auto; padding-right:4px;">
                    ${cardsHtml}
                </div>

                <div style="border-top:1px solid var(--border-color); padding-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12.5px;">
                        <input type="checkbox" id="cleanupMisplacedSyncTx" checked style="accent-color:var(--accent);">
                        <span>Harmoniser également les ${preview.total_tx_mismatches || 0} opération(s) isolées désynchronisées</span>
                    </label>

                    <button class="btn btn-primary" id="btnApplyMisplaced" onclick="window.DataCleanupModal.applyMisplacedFix(${preview.categories?.length || 0})" style="display:flex; align-items:center; gap:8px; padding:8px 18px; font-weight:700;">
                        <span>✨</span> <span>Appliquer les reclassements</span>
                    </button>
                </div>
            </div>
        `;
    },

    async applyMisplacedFix(totalCategories) {
        const fixes = [];
        for (let idx = 0; idx < totalCategories; idx++) {
            const radio = document.querySelector(`input[name="cleanup_misplaced_${idx}"]:checked`);
            if (radio) {
                fixes.push({
                    category: radio.dataset.cat,
                    new_type: radio.value
                });
            }
        }

        const syncAll = document.getElementById('cleanupMisplacedSyncTx')?.checked ?? true;
        const btn = document.getElementById('btnApplyMisplaced');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Reclassement en cours...'; }

        try {
            const res = await API.post('/api/maintenance/misplaced_categories/apply', {
                fixes: fixes,
                sync_all_tx_types: syncAll
            });

            showToast(res.message || "Reclassement des catégories appliqué avec succès !", "success");

            window.dispatchEvent(new CustomEvent('categories-changed'));
            window.dispatchEvent(new CustomEvent('transactions-changed'));
            window.dispatchEvent(new CustomEvent('stats-changed'));
            window.dispatchEvent(new CustomEvent('app:data-changed'));

            await this.runOverviewAnalysis();
        } catch (e) {
            console.error('[DataCleanupModal] Erreur applyMisplacedFix:', e);
            showToast("Erreur : " + e.message, "danger");
            if (btn) { btn.disabled = false; btn.innerHTML = '✨ Réessayer'; }
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Tool: Fix Type Mismatch
    // ──────────────────────────────────────────────────────────────────────────
    async _renderFixTypeMismatch(container) {
        const preview = await API.get('/api/maintenance/fix_type_mismatch/preview');

        if (preview.count === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px;">
                    <div style="font-size:36px; margin-bottom:10px;">✨</div>
                    <h4 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:var(--text-main);">
                        Aucun type incohérent
                    </h4>
                    <p style="margin:0; font-size:13px; color:var(--text-muted); max-width:480px; margin:0 auto; line-height:1.5;">
                        Toutes les dépenses associées à des récurrences sont bien typées en charges fixes.
                    </p>
                </div>
            `;
            return;
        }

        const catsList = (preview.affected_categories || []).map(c => `<li><strong>${c.name}</strong> (${c.shared ? 'partagée' : 'exclusive'})</li>`).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; flex-shrink:0;">
                <div style="border-bottom:1px solid var(--border-color); padding-bottom:12px;">
                    <h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <span>🔧</span> <span>Requalification des Dépenses Récurrentes en Charges Fixes</span>
                    </h4>
                    <p style="margin:0; font-size:12.5px; color:var(--text-muted); line-height:1.4;">
                        ${preview.count} opération(s) possèdent le type « dépense variable » alors qu'elles sont rattachées à un modèle récurrent.
                    </p>
                </div>

                <div style="background:var(--bg-body); border:1px solid var(--border-color); border-radius:10px; padding:14px;">
                    <strong style="font-size:13px; color:var(--text-main);">Catégories impactées :</strong>
                    <ul style="margin:8px 0 0 18px; font-size:12.5px; color:var(--text-muted); line-height:1.5;">
                        ${catsList}
                    </ul>
                </div>

                <div style="border-top:1px solid var(--border-color); padding-top:12px; display:flex; justify-content:flex-end;">
                    <button class="btn btn-primary" id="btnApplyTypeMismatch" onclick="window.DataCleanupModal.applyTypeMismatchFix()" style="display:flex; align-items:center; gap:8px; padding:8px 18px; font-weight:700;">
                        <span>🔧</span> <span>Corriger les ${preview.count} opérations</span>
                    </button>
                </div>
            </div>
        `;
    },

    async applyTypeMismatchFix() {
        const btn = document.getElementById('btnApplyTypeMismatch');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Correction en cours...'; }

        try {
            const res = await API.post('/api/maintenance/fix_type_mismatch/apply');
            showToast(res.message || "Types corrigés avec succès !", "success");

            window.dispatchEvent(new CustomEvent('transactions-changed'));
            window.dispatchEvent(new CustomEvent('categories-changed'));
            window.dispatchEvent(new CustomEvent('stats-changed'));
            window.dispatchEvent(new CustomEvent('app:data-changed'));

            await this.runOverviewAnalysis();
        } catch (e) {
            console.error('[DataCleanupModal] Erreur applyTypeMismatchFix:', e);
            showToast("Erreur : " + e.message, "danger");
            if (btn) { btn.disabled = false; btn.innerHTML = '🔧 Réessayer'; }
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Tool: Convert Zeroed to Skipped
    // ──────────────────────────────────────────────────────────────────────────
    async _renderConvertZeroed(container) {
        const preview = await API.get('/api/maintenance/convert_zeroed_to_skipped/preview');

        if (preview.count === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:36px 20px;">
                    <div style="font-size:36px; margin-bottom:10px;">✨</div>
                    <h4 style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:var(--text-main);">
                        Aucune récurrence bloquée à 0 €
                    </h4>
                    <p style="margin:0; font-size:13px; color:var(--text-muted); max-width:480px; margin:0 auto; line-height:1.5;">
                        Toutes vos récurrences actives disposent d'un montant valide pour la génération prévisionnelle.
                    </p>
                </div>
            `;
            return;
        }

        const groupsHtml = (preview.groups || []).map(g => {
            const fallbackStr = g.fallback_amount != null ? `→ Reprise à ${formatCurrency(g.fallback_amount)}` : '';
            const txItems = g.transactions.map(tx => `
                <label style="display:flex; align-items:center; gap:10px; padding:6px 12px; font-size:12px; cursor:pointer;">
                    <input type="checkbox" class="cleanup-zeroed-cb" value="${tx.id}" checked style="accent-color:var(--accent);">
                    <span style="color:var(--text-muted);">${tx.date_operation}</span>
                    <span style="font-weight:600; flex:1;">${tx.description}</span>
                    <span style="font-weight:700;">0,00 €</span>
                </label>
            `).join('');

            return `
                <div style="background:var(--bg-body); border:1px solid var(--border-color); border-radius:10px; overflow:hidden;">
                    <div style="padding:10px 14px; background:var(--bg-surface); border-bottom:1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between;">
                        <strong style="font-size:13px; color:var(--text-main);">🔄 ${g.template_description}</strong>
                        <span style="font-size:11.5px; color:#10b981; font-weight:700;">${fallbackStr}</span>
                    </div>
                    <div>${txItems}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; flex-shrink:0;">
                <div style="border-bottom:1px solid var(--border-color); padding-bottom:12px;">
                    <h4 style="margin:0 0 4px 0; font-size:15px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <span>🔄</span> <span>Conversion des Échéances à 0 € en Échéances « Ignorées »</span>
                    </h4>
                    <p style="margin:0; font-size:12.5px; color:var(--text-muted); line-height:1.4;">
                        Permet aux abonnements temporairement suspendus (ex. pause de 2 mois) de reprendre leur génération automatique avec leur montant réel.
                    </p>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; max-height:340px; overflow-y:auto; padding-right:4px;">
                    ${groupsHtml}
                </div>

                <div style="border-top:1px solid var(--border-color); padding-top:12px; display:flex; justify-content:flex-end;">
                    <button class="btn btn-primary" id="btnApplyZeroed" onclick="window.DataCleanupModal.applyZeroedFix()" style="display:flex; align-items:center; gap:8px; padding:8px 18px; font-weight:700;">
                        <span>🔄</span> <span>Convertir en échéances ignorées (${preview.count})</span>
                    </button>
                </div>
            </div>
        `;
    },

    async applyZeroedFix() {
        const selectedIds = Array.from(document.querySelectorAll('.cleanup-zeroed-cb:checked')).map(cb => parseInt(cb.value));
        if (selectedIds.length === 0) {
            showToast("Aucune opération sélectionnée.", "info");
            return;
        }

        const btn = document.getElementById('btnApplyZeroed');
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Conversion en cours...'; }

        try {
            const res = await API.post('/api/maintenance/convert_zeroed_to_skipped/apply', selectedIds);
            showToast(`${res.converted} transaction(s) convertie(s) en ignorées.`, "success");

            window.dispatchEvent(new CustomEvent('recurrences-changed'));
            window.dispatchEvent(new CustomEvent('transactions-changed'));
            window.dispatchEvent(new CustomEvent('app:data-changed'));

            await this.runOverviewAnalysis();
        } catch (e) {
            console.error('[DataCleanupModal] Erreur applyZeroedFix:', e);
            showToast("Erreur : " + e.message, "danger");
            if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Réessayer'; }
        }
    }
};
