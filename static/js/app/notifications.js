// static/js/app/notifications.js
// Centre de notifications, polling adaptatif, groupement, cartes d'action et approfondissement IA

window.AppModules = window.AppModules || {};

window.AppModules.notifications = {
    _initNotifications() {
        const bellBtn = document.getElementById('notifBellBtn');
        const notifMenu = document.getElementById('notifMenu');
        if (!bellBtn || !notifMenu) return;

        this._notifTab = 'active'; // 'active' | 'archived'
        this._notifGroupBy = 'date'; // 'date' | 'type'
        this._notifSearchQuery = '';
        this._collapsedNotifGroups = new Set();
        this._cachedActiveNotifs = [];
        this._cachedArchivedNotifs = [];
        this._cachedPendingTransfers = [];

        bellBtn.onclick = (e) => {
            e.stopPropagation();
            if (notifMenu.style.display === 'none') {
                this.loadNotifications();
                notifMenu.style.display = 'block';
            } else {
                notifMenu.style.display = 'none';
            }
        };

        document.addEventListener('click', (e) => {
            if (!bellBtn.contains(e.target) && !notifMenu.contains(e.target)) {
                notifMenu.style.display = 'none';
            }
        });

        // Load notifications initially
        this.loadNotifications();
        
        // Dynamic notification polling
        this._notifInterval = 60000; // Base: 60s
        this._notifTimer = null;
        this._startNotifPolling();
    },

    _startNotifPolling() {
        if (this._notifTimer) clearTimeout(this._notifTimer);
        
        const poll = async () => {
            await this.loadNotifications();
            this._notifTimer = setTimeout(poll, this._notifInterval);
        };
        this._notifTimer = setTimeout(poll, this._notifInterval);
    },

    setFastNotificationsPolling(active) {
        const newInterval = active ? 3000 : 60000;
        if (this._notifInterval !== newInterval) {
            this._notifInterval = newInterval;
            this._startNotifPolling();
        }
        // Auto-disable fast polling after a safety timeout (5 minutes) to avoid infinite polling if something goes wrong
        if (active) {
            if (this._fastPollingSafetyTimeout) clearTimeout(this._fastPollingSafetyTimeout);
            this._fastPollingSafetyTimeout = setTimeout(() => {
                this.setFastNotificationsPolling(false);
            }, 300000);
        } else {
            if (this._fastPollingSafetyTimeout) {
                clearTimeout(this._fastPollingSafetyTimeout);
                this._fastPollingSafetyTimeout = null;
            }
        }
    },

    switchNotifTab(tab) {
        this._notifTab = tab;
        const activeTabBtn = document.getElementById('notifTabActive');
        const archivedTabBtn = document.getElementById('notifTabArchived');
        const activeActions = document.getElementById('notifActiveActions');
        const archivedActions = document.getElementById('notifArchivedActions');

        if (activeTabBtn) activeTabBtn.classList.toggle('active', tab === 'active');
        if (archivedTabBtn) archivedTabBtn.classList.toggle('active', tab === 'archived');
        if (activeActions) activeActions.style.display = tab === 'active' ? 'flex' : 'none';
        if (archivedActions) archivedActions.style.display = tab === 'archived' ? 'flex' : 'none';

        this._renderNotificationList();
    },

    toggleNotifGroupBy() {
        this._notifGroupBy = this._notifGroupBy === 'date' ? 'type' : 'date';
        const icon = document.getElementById('notifGroupIcon');
        const label = document.getElementById('notifGroupLabel');
        if (icon) icon.textContent = this._notifGroupBy === 'date' ? '📅' : '🏷️';
        if (label && window.i18n) {
            label.textContent = this._notifGroupBy === 'date' 
                ? (window.i18n.t('notif_group_date') || 'Période') 
                : (window.i18n.t('notif_group_type') || 'Thème');
        }
        this._renderNotificationList();
    },

    onNotifSearchInput(query) {
        this._notifSearchQuery = (query || '').toLowerCase().trim();
        this._renderNotificationList();
    },

    toggleNotifGroup(groupKey) {
        if (this._collapsedNotifGroups.has(groupKey)) {
            this._collapsedNotifGroups.delete(groupKey);
        } else {
            this._collapsedNotifGroups.add(groupKey);
        }
        const container = document.getElementById(`notif-group-items-${groupKey}`);
        const chevron = document.getElementById(`notif-chevron-${groupKey}`);
        if (container && chevron) {
            const isCollapsed = this._collapsedNotifGroups.has(groupKey);
            container.style.display = isCollapsed ? 'none' : 'flex';
            chevron.classList.toggle('collapsed', isCollapsed);
        }
    },

    openNotificationsMenu() {
        const notifMenu = document.getElementById('notifMenu');
        if (notifMenu) {
            this.loadNotifications();
            notifMenu.style.display = 'block';
        }
    },

    async loadNotifications() {
        try {
            const [activeNotifs, archivedNotifs, pendingTransfers] = await Promise.all([
                API.get('/api/notifications?archived=false'),
                API.get('/api/notifications?archived=true'),
                API.get('/api/cross-profile/pending').catch(() => [])
            ]);

            this._cachedActiveNotifs = Array.isArray(activeNotifs) ? activeNotifs : [];
            this._cachedArchivedNotifs = Array.isArray(archivedNotifs) ? archivedNotifs : [];
            this._cachedPendingTransfers = Array.isArray(pendingTransfers) ? pendingTransfers : [];

            // Check for new unread notifications to display toast
            let hasBankSyncNotif = false;
            if (this._knownNotifIds) {
                let foundNew = false;
                const newUnread = [];
                this._cachedActiveNotifs.forEach(n => {
                    if (!n.is_read && !this._knownNotifIds.has(n.id)) {
                        this._knownNotifIds.add(n.id);
                        foundNew = true;
                        newUnread.push(n);
                        if (n.type === 'bank_sync' || n.type === 'file_import') {
                            hasBankSyncNotif = true;
                        }
                    }
                });
                if (foundNew) {
                    const errorNotif = newUnread.find(n => n.type === 'bank_sync_error' || (n.title && (n.title.includes('Échec') || n.title.includes('Sync failed'))));
                    const twofaNotif = newUnread.find(n => n.type === 'bank_sync_2fa' || (n.title && (n.title.includes('2FA') || n.title.includes('Validation'))));

                    if (errorNotif) {
                        let connLabel = '';
                        if (errorNotif.link_data) {
                            try {
                                const ld = typeof errorNotif.link_data === 'string' ? JSON.parse(errorNotif.link_data) : errorNotif.link_data;
                                connLabel = ld.conn_label || '';
                            } catch (_) {}
                        }
                        if (!connLabel && errorNotif.title) {
                            connLabel = errorNotif.title.replace(/^⚠️\s*(?:Échec relevé|Sync failed for|Sync failed)\s*/i, '').trim();
                        }
                        const msg = connLabel
                            ? (window.i18n ? window.i18n.tp('notif_toast_sync_failed_conn', { label: connLabel }) : `Échec du relevé ${connLabel} : nouvelle notification reçue.`)
                            : (window.i18n ? window.i18n.t('notif_toast_sync_failed') : "Échec de la synchronisation bancaire : nouvelle notification reçue.");
                        showToast(msg, 'error', 6000, {
                            action: {
                                text: window.i18n ? window.i18n.t('notif_toast_view') || 'Voir' : 'Voir',
                                callback: () => this.openNotificationsMenu()
                            }
                        });
                    } else if (twofaNotif) {
                        const msg = window.i18n ? window.i18n.t('notif_toast_2fa_required') || "Validation 2FA requise : nouvelle notification reçue." : "Validation 2FA requise : nouvelle notification reçue.";
                        showToast(msg, 'info', 5000, {
                            action: {
                                text: window.i18n ? window.i18n.t('notif_toast_view') || 'Voir' : 'Voir',
                                callback: () => this.openNotificationsMenu()
                            }
                        });
                    } else {
                        showToast(window.i18n ? window.i18n.t('notif_new_received') || "Nouvelle notification reçue" : "Nouvelle notification reçue", 'info');
                    }

                    if (hasBankSyncNotif) {
                        if (window.BankSyncView && typeof window.BankSyncView.refreshActiveViews === 'function') {
                            window.BankSyncView.refreshActiveViews();
                        } else if (window.BankSyncView && typeof window.BankSyncView.loadPendingSync === 'function') {
                            window.BankSyncView.loadPendingSync();
                        }
                    }
                    this.setFastNotificationsPolling(false);
                }
            } else {
                this._knownNotifIds = new Set(this._cachedActiveNotifs.map(n => n.id));
            }

            // Update Badge Counts
            const activeUnread = this._cachedActiveNotifs.filter(n => !n.is_read).length;
            const crossProfileUnread = this._cachedPendingTransfers.length;
            const totalUnreadBadge = activeUnread + crossProfileUnread;

            const bellBadge = document.getElementById('notifCountBadge');
            if (bellBadge) {
                bellBadge.innerText = totalUnreadBadge > 99 ? '99+' : totalUnreadBadge;
                if (totalUnreadBadge > 0) {
                    bellBadge.style.setProperty('display', 'inline-flex', 'important');
                } else {
                    bellBadge.style.setProperty('display', 'none', 'important');
                }
            }

            const activeTabBadge = document.getElementById('notifActiveUnreadBadge');
            if (activeTabBadge) {
                activeTabBadge.innerText = `${activeUnread + crossProfileUnread}`;
                activeTabBadge.style.display = (activeUnread + crossProfileUnread) > 0 ? 'inline-block' : 'none';
            }

            const archivedBadge = document.getElementById('notifArchivedBadge');
            if (archivedBadge) {
                archivedBadge.innerText = `${this._cachedArchivedNotifs.length}`;
                archivedBadge.style.display = this._cachedArchivedNotifs.length > 0 ? 'inline-block' : 'none';
            }

            const markAllBtn = document.getElementById('markAllNotifsReadBtn');
            const archiveAllBtn = document.getElementById('archiveAllNotifsBtn');
            const clearArchivesBtn = document.getElementById('clearArchivesBtn');

            if (markAllBtn) {
                markAllBtn.style.display = this._cachedActiveNotifs.some(n => !n.is_read) ? 'inline' : 'none';
            }
            if (archiveAllBtn) {
                archiveAllBtn.style.display = this._cachedActiveNotifs.length > 0 ? 'inline' : 'none';
            }
            if (clearArchivesBtn) {
                clearArchivesBtn.style.display = this._cachedArchivedNotifs.length > 0 ? 'inline' : 'none';
            }

            this._renderNotificationList();
        } catch (e) {
            console.error("Failed to load notifications", e);
        }
    },

    _translateNotification(n) {
        let title = n.title || '';
        let content = n.content || '';

        let linkMeta = {};
        if (n.link_data) {
            try {
                linkMeta = typeof n.link_data === 'string' ? JSON.parse(n.link_data) : n.link_data;
            } catch (_) {}
        }

        // 1. Notification de 2FA requis
        if (n.type === 'bank_sync_2fa' || title.includes('Validation 2FA requise') || title.includes('2FA validation required')) {
            const connLabel = linkMeta.conn_label || title.replace(/^🔐\s*(?:Validation 2FA requise\s*:|2FA validation required\s*:)\s*/i, '').trim();
            title = `🔐 ${window.i18n ? window.i18n.tp('notif_bank_sync_2fa_title', { label: connLabel }) : title}`;
            content = window.i18n ? window.i18n.tp('notif_bank_sync_2fa_content', { label: connLabel }) : content;
        }
        // 2. Notification d'échec de relevé bancaire
        else if (n.type === 'bank_sync_error' || title.includes('Échec relevé') || title.includes('Sync failed')) {
            const connLabel = linkMeta.conn_label || title.replace(/^⚠️\s*(?:Échec relevé|Sync failed for|Sync failed)\s*/i, '').trim();
            title = `⚠️ ${window.i18n ? window.i18n.tp('notif_bank_sync_failed_title', { label: connLabel }) : title}`;
            
            let err = linkMeta.error || '';
            if (!err && content.includes(':')) {
                err = content.substring(content.indexOf(':') + 1).trim();
            }
            content = window.i18n ? window.i18n.tp('notif_bank_sync_failed_content', { label: connLabel, error: err || content }) : content;
        }
        // 2. Notification de synchronisation réussie
        else if (n.type === 'bank_sync' && (title.includes('Synchronisation') || title.includes('Sync ') || title.includes('Sync:'))) {
            const connLabel = linkMeta.conn_label || title.replace(/^🏦\s*(?:Synchronisation|Sync)\s*/i, '').trim();
            title = `🏦 ${window.i18n ? window.i18n.tp('notif_bank_sync_success_title', { label: connLabel }) : title}`;
            
            let detailsList = [];
            const matchesCount = typeof linkMeta.matches === 'number' ? linkMeta.matches : 0;
            const comingCount = typeof linkMeta.coming === 'number' ? linkMeta.coming : 0;
            const newCount = typeof linkMeta.new_txs === 'number' ? linkMeta.new_txs : 0;

            if (matchesCount === 1) {
                detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_matches_1') : '1 opération à rapprocher');
            } else if (matchesCount > 1) {
                detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_matches_n', { count: matchesCount }) : `${matchesCount} opérations à rapprocher`);
            }

            if (comingCount === 1) {
                detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_coming_1') : '1 opération en attente');
            } else if (comingCount > 1) {
                detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_coming_n', { count: comingCount }) : `${comingCount} opérations en attente`);
            }

            if (newCount === 1) {
                detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_new_1') : '1 nouvelle opération');
            } else if (newCount > 1) {
                detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_new_n', { count: newCount }) : `${newCount} nouvelles opérations`);
            }

            if (detailsList.length === 0) {
                const matchMatches = content.match(/(\d+)\s+(?:opération[s]?\s+prête[s]?\s+à\s+pointer|opération[s]?\s+à\s+rapprocher|rapprochement)/i);
                const matchComing = content.match(/(\d+)\s+(?:en\s+attente|opération[s]?\s+en\s+attente)/i);
                const matchNew = content.match(/(\d+)\s+(?:nouvelle|opération[s]?\s+à\s+ajouter)/i);
                const mVal = matchMatches ? parseInt(matchMatches[1]) : 0;
                const cVal = matchComing ? parseInt(matchComing[1]) : 0;
                const nVal = matchNew ? parseInt(matchNew[1]) : 0;
                if (mVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_matches_1') : '1 opération à rapprocher');
                else if (mVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_matches_n', { count: mVal }) : `${mVal} opérations à rapprocher`);
                if (cVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_coming_1') : '1 opération en attente');
                else if (cVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_coming_n', { count: cVal }) : `${cVal} opérations en attente`);
                if (nVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_new_1') : '1 nouvelle opération');
                else if (nVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_new_n', { count: nVal }) : `${nVal} nouvelles opérations`);
            }

            if (detailsList.length > 0 && window.i18n) {
                content = window.i18n.tp('notif_bank_sync_success_content', { label: connLabel, details: detailsList.join(', ') });
            }
        }
        // 3. Notification relevé à jour (0 nouvelle opération)
        else if (n.type === 'bank_sync' && (title.includes('À jour') || title.includes('Up to date'))) {
            const connLabel = linkMeta.conn_label || title.replace(/^🏦\s*(?:Relevé|Sync)\s*/i, '').replace(/:\s*(?:À jour|Up to date)\s*$/i, '').trim();
            title = `🏦 ${window.i18n ? window.i18n.tp('notif_bank_sync_uptodate_title', { label: connLabel }) : title}`;
            content = window.i18n ? window.i18n.tp('notif_bank_sync_uptodate_content', { label: connLabel }) : content;
        }
        // 4. Notification d'import de fichier
        else if (n.type === 'file_import' || title.includes('Import Relevé') || title.includes('File Statement')) {
            const fname = linkMeta.filename || 'relevé.csv';
            title = `📊 ${window.i18n ? window.i18n.t('notif_file_import_title') : 'Import Relevé Fichier'}`;
            let detailsList = [];
            const matchesCount = typeof linkMeta.matches === 'number' ? linkMeta.matches : 0;
            const newCount = typeof linkMeta.new_txs === 'number' ? linkMeta.new_txs : 0;
            const impCount = typeof linkMeta.imported === 'number' ? linkMeta.imported : 0;

            if (matchesCount === 1) detailsList.push(window.i18n ? window.i18n.t('notif_file_import_details_reconciled_1') : '1 opération rapprochée');
            else if (matchesCount > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_file_import_details_reconciled_n', { count: matchesCount }) : `${matchesCount} opérations rapprochées`);

            if (newCount === 1) detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_new_1') : '1 nouvelle opération');
            else if (newCount > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_new_n', { count: newCount }) : `${newCount} nouvelles opérations`);

            if (impCount === 1) detailsList.push(window.i18n ? window.i18n.t('notif_file_import_details_imported_1') : '1 opération enregistrée');
            else if (impCount > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_file_import_details_imported_n', { count: impCount }) : `${impCount} opérations enregistrées`);

            if (detailsList.length === 0) {
                const matchMatches = content.match(/(\d+)\s+(?:opération[s]?\s+pointée[s]?|opération[s]?\s+rapprochée[s]?|opération[s]?\s+prête[s]?\s+à\s+pointer|opération[s]?\s+à\s+rapprocher|rapprochement)/i);
                const matchNew = content.match(/(\d+)\s+nouvelle/i);
                const matchImp = content.match(/(\d+)\s+opération[s]?\s+enregistrée/i);
                const mVal = matchMatches ? parseInt(matchMatches[1]) : 0;
                const nVal = matchNew ? parseInt(matchNew[1]) : 0;
                const iVal = matchImp ? parseInt(matchImp[1]) : 0;
                if (mVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_file_import_details_reconciled_1') : '1 opération rapprochée');
                else if (mVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_file_import_details_reconciled_n', { count: mVal }) : `${mVal} opérations rapprochées`);
                if (nVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_bank_sync_details_new_1') : '1 nouvelle opération');
                else if (nVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_bank_sync_details_new_n', { count: nVal }) : `${nVal} nouvelles opérations`);
                if (iVal === 1) detailsList.push(window.i18n ? window.i18n.t('notif_file_import_details_imported_1') : '1 opération enregistrée');
                else if (iVal > 1) detailsList.push(window.i18n ? window.i18n.tp('notif_file_import_details_imported_n', { count: iVal }) : `${iVal} opérations enregistrées`);
            }

            if (detailsList.length > 0 && window.i18n) {
                content = window.i18n.tp('notif_file_import_content', { filename: fname, details: detailsList.join(', ') });
            }
        }

        return { title, content };
    },

    _renderNotificationList() {
        const container = document.getElementById('notifListContainer');
        if (!container) return;

        const isArchivedTab = this._notifTab === 'archived';
        let rawNotifs = isArchivedTab ? [...this._cachedArchivedNotifs] : [...this._cachedActiveNotifs];
        const pendingTransfers = isArchivedTab ? [] : [...this._cachedPendingTransfers];

        this._notifDataMap = {};
        [...this._cachedActiveNotifs, ...this._cachedArchivedNotifs].forEach(n => {
            this._notifDataMap[n.id] = n;
        });

        // Search Filter
        const query = this._notifSearchQuery;
        if (query) {
            rawNotifs = rawNotifs.filter(n => {
                const translated = this._translateNotification(n);
                const fields = [
                    translated.title,
                    translated.content,
                    n.type,
                    n.title,
                    n.content
                ];
                return window.permissiveMatch(fields, query);
            });
        }

        if (rawNotifs.length === 0 && pendingTransfers.length === 0) {
            const emptyMsg = isArchivedTab
                ? (window.i18n ? window.i18n.t('notif_no_archived') || "Aucune notification archivée dans l'historique." : "Aucune notification archivée dans l'historique.")
                : (window.i18n ? window.i18n.t('notif_no_active') || "Aucune notification active. Tout est à jour !" : "Aucune notification active. Tout est à jour !");
            const emptyIcon = isArchivedTab ? '🗄️' : '📥';
            container.innerHTML = `
                <div style="padding: 30px 20px; text-align: center; color: var(--text-muted);">
                    <div style="font-size: 28px; margin-bottom: 8px; opacity: 0.7;">${emptyIcon}</div>
                    <div style="font-size: 12.5px; font-weight: 500;">${emptyMsg}</div>
                </div>`;
            return;
        }

        // Render Cross-profile pending transfers at top of active tab if no search query or matches query
        let crossProfileHtml = '';
        if (pendingTransfers.length > 0 && (!query || 'virement inter-profils transfer'.includes(query))) {
            const acceptTxt = window.i18n ? window.i18n.t('cross_profile_btn_accept') || 'Accepter' : 'Accepter';
            const rejectTxt = window.i18n ? window.i18n.t('cross_profile_btn_reject') || 'Refuser' : 'Refuser';
            const detailsTxt = window.i18n ? window.i18n.t('cross_profile_btn_details') || 'Détails' : 'Détails';

            crossProfileHtml = pendingTransfers.map(tx => {
                const dateStr = tx.date_operation || '';
                const fromAcc = tx.from_account_name || 'Autre compte';
                const toAcc = tx.to_account_name || 'Ce compte';
                const amt = Math.abs(tx.amount || 0);
                const fmtAmt = amt.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
                const origSub = tx.origin_subject ? `<div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px; font-style: italic;">« ${window.escapeHtml ? window.escapeHtml(tx.origin_subject) : tx.origin_subject} »</div>` : '';

                return `
                <div class="notif-card" style="border-left: 4px solid #10b981; background: rgba(16, 185, 129, 0.04);">
                    <div class="notif-card-header">
                        <span style="font-weight: 700; font-size: 13px; color: #10b981; display: inline-flex; align-items: center; gap: 4px;">
                            <span>🔀</span> <span>${window.i18n ? window.i18n.t('cross_profile_notif_title') || 'Virement inter-profils en attente' : 'Virement inter-profils en attente'}</span>
                        </span>
                        <span class="notif-card-date">${dateStr}</span>
                    </div>
                    <div style="font-size: 12.5px; margin-top: 6px; line-height: 1.4; color: var(--text-main);">
                        <div><strong>${window.escapeHtml ? window.escapeHtml(fromAcc) : fromAcc}</strong> ➔ <strong>${window.escapeHtml ? window.escapeHtml(toAcc) : toAcc}</strong></div>
                        <div style="font-size: 13.5px; font-weight: 800; color: #10b981; margin-top: 4px;">+${fmtAmt}</div>
                        ${origSub}
                    </div>
                    <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px;">
                        <button class="btn btn-secondary btn-sm" style="font-size:12px; padding:0 12px; border-radius:8px; height:32px;" onclick="event.stopPropagation(); window.FormView.openPendingModal()">${detailsTxt}</button>
                        <button class="btn btn-primary btn-sm" style="font-size:12px; padding:0 14px; border-radius:8px; height:32px; background:#10b981;" onclick="event.stopPropagation(); window.FormView.validatePendingTransfer('${tx.cross_profile_link_id}', 'accept')">${acceptTxt}</button>
                        <button class="btn btn-secondary btn-sm" style="font-size:12px; padding:0 12px; border-radius:8px; height:32px; color:#ef4444;" onclick="event.stopPropagation(); window.FormView.validatePendingTransfer('${tx.cross_profile_link_id}', 'reject')">${rejectTxt}</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Grouping Engine
        const groups = this._groupNotifications(rawNotifs, this._notifGroupBy);

        let html = crossProfileHtml;

        groups.forEach(group => {
            if (group.items.length === 0) return;
            const isCollapsed = this._collapsedNotifGroups ? this._collapsedNotifGroups.has(group.key) : false;
            const chevronClass = isCollapsed ? 'notif-group-chevron collapsed' : 'notif-group-chevron';
            const itemsDisplay = isCollapsed ? 'none' : 'flex';

            html += `
            <div style="display: flex; flex-direction: column;">
                <div class="notif-group-header" onclick="window.app.toggleNotifGroup('${group.key}')">
                    <div class="notif-group-title">
                        <span>${group.icon}</span>
                        <span>${group.title}</span>
                        <span class="notif-group-badge">${group.items.length}</span>
                    </div>
                    <span id="notif-chevron-${group.key}" class="${chevronClass}">▼</span>
                </div>
                <div id="notif-group-items-${group.key}" style="display: ${itemsDisplay}; flex-direction: column;">
                    ${group.items.map(n => this._renderSingleNotificationCard(n, isArchivedTab)).join('')}
                </div>
            </div>`;
        });

        container.innerHTML = html;
    },

    _parseNotifDate(dateVal) {
        if (!dateVal) return new Date();
        if (dateVal instanceof Date) return dateVal;
        if (typeof dateVal === 'string') {
            let clean = dateVal.trim();
            // If the datetime string has no timezone offset or Z suffix, treat it as UTC
            if (!clean.endsWith('Z') && !clean.includes('+') && !clean.match(/-\d{2}:\d{2}$/)) {
                clean = clean.replace(' ', 'T') + 'Z';
            }
            const parsed = new Date(clean);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date(dateVal);
    },

    _groupNotifications(notifs, groupBy) {
        if (groupBy === 'type') {
            const groupMap = {
                bank: {
                    key: 'bank',
                    icon: '🏦',
                    title: window.i18n ? window.i18n.t('notif_group_bank') || 'Banque & Imports' : 'Banque & Imports',
                    items: []
                },
                ai: {
                    key: 'ai',
                    icon: '🤖',
                    title: window.i18n ? window.i18n.t('notif_group_ai') || 'Analyses & Bilans IA' : 'Analyses & Bilans IA',
                    items: []
                },
                system: {
                    key: 'system',
                    icon: '⚙️',
                    title: window.i18n ? window.i18n.t('notif_group_system') || 'Système & Alertes' : 'Système & Alertes',
                    items: []
                }
            };

            notifs.forEach(n => {
                const t = n.type || '';
                if (t === 'bank_sync' || t === 'bank_sync_error' || t === 'file_import') {
                    groupMap.bank.items.push(n);
                } else if (t === 'ai_report' || t === 'ai_chat' || t.includes('ai') || t.includes('chat')) {
                    groupMap.ai.items.push(n);
                } else {
                    groupMap.system.items.push(n);
                }
            });

            return Object.values(groupMap).filter(g => g.items.length > 0);
        }

        // Default: Group by Date
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfYesterday = startOfToday - 86400000;
        const startOfThisWeek = startOfToday - ((now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000);
        const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        const dateGroups = {
            today: {
                key: 'today',
                icon: '📅',
                title: window.i18n ? window.i18n.t('notif_group_today') || "Aujourd'hui" : "Aujourd'hui",
                items: []
            },
            yesterday: {
                key: 'yesterday',
                icon: '📅',
                title: window.i18n ? window.i18n.t('notif_group_yesterday') || "Hier" : "Hier",
                items: []
            },
            this_week: {
                key: 'this_week',
                icon: '📅',
                title: window.i18n ? window.i18n.t('notif_group_this_week') || "Cette semaine" : "Cette semaine",
                items: []
            },
            this_month: {
                key: 'this_month',
                icon: '📅',
                title: window.i18n ? window.i18n.t('notif_group_this_month') || "Ce mois-ci" : "Ce mois-ci",
                items: []
            },
            older: {
                key: 'older',
                icon: '📦',
                title: window.i18n ? window.i18n.t('notif_group_older') || "Plus ancien" : "Plus ancien",
                items: []
            }
        };

        notifs.forEach(n => {
            const itemDate = this._parseNotifDate(n.created_at).getTime();
            if (itemDate >= startOfToday) {
                dateGroups.today.items.push(n);
            } else if (itemDate >= startOfYesterday) {
                dateGroups.yesterday.items.push(n);
            } else if (itemDate >= startOfThisWeek) {
                dateGroups.this_week.items.push(n);
            } else if (itemDate >= startOfThisMonth) {
                dateGroups.this_month.items.push(n);
            } else {
                dateGroups.older.items.push(n);
            }
        });

        return Object.values(dateGroups).filter(g => g.items.length > 0);
    },

    _renderSingleNotificationCard(n, isArchived) {
        const lang = (window.i18n && window.i18n.lang) || 'fr';
        const dateStr = this._parseNotifDate(n.created_at).toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const unreadClass = (!n.is_read && !isArchived) ? 'unread' : '';
        const isReport = n.type === 'ai_report';
        const clickCallback = (!n.is_read && !isArchived) 
            ? `onclick="window.app.handleNotifClick(${n.id})" title="${window.i18n ? window.i18n.t('notif_btn_mark_read_tooltip') || 'Cliquer pour marquer comme lu' : 'Cliquer pour marquer comme lu'}" style="cursor: pointer;"` 
            : '';

        const translated = this._translateNotification(n);
        let displayTitle = translated.title;
        let displayContent = translated.content || '';

        if (displayContent.includes('"summary"') || displayContent.trim().startsWith('{') || displayContent.trim().startsWith('```')) {
            try {
                const cleaned = displayContent.replace(/```(?:json)?/g, '').trim();
                const parsed = JSON.parse(cleaned);
                if (parsed.summary) displayContent = parsed.summary;
            } catch (e) {
                const match = displayContent.match(/"summary"\s*:\s*"([^"]+)"/);
                if (match && match[1]) displayContent = match[1];
            }
        }
        displayContent = displayContent.replace(/\\n/g, '\n').trim();

        // Context Action Button (e.g. Deepen AI report, Examine pending, Unlock vault, View accounts, Open Chat)
        let contextActionBtn = '';
        if (isReport) {
            const lblDeepen = window.i18n ? window.i18n.t('notif_btn_deepen') || "Approfondir avec l'IA" : "Approfondir avec l'IA";
            contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">🤖 ${lblDeepen}</button>`;
        } else if (n.link_data) {
            try {
                const linkObj = typeof n.link_data === 'string' ? JSON.parse(n.link_data) : n.link_data;
                const errStr = String(linkObj.error || n.content || '').toLowerCase();
                const isVaultOrPasswordIssue = linkObj.action === 'unlock_vault' || 
                    (n.type === 'bank_sync_error' && (
                        errStr.includes('mot de passe') || 
                        errStr.includes('password') || 
                        errStr.includes('coffre') || 
                        errStr.includes('vault') || 
                        errStr.includes('verrouill') ||
                        errStr.includes('identifiant')
                    ));

                const is2FA = n.type === 'bank_sync_2fa' || linkObj.action === 'bank_sync_2fa';
                if (linkObj.session_id) {
                    const lblChat = window.i18n ? window.i18n.t('notif_btn_open_chat') || 'Ouvrir la discussion' : 'Ouvrir la discussion';
                    contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">💬 ${lblChat}</button>`;
                } else if (is2FA) {
                    const lbl2FA = window.i18n ? window.i18n.t('bank_sync_btn_validate_2fa') || 'Valider sur smartphone' : 'Valider sur smartphone';
                    contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: #fff; font-weight: 600;" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">📱 ${lbl2FA}</button>`;
                } else if (isVaultOrPasswordIssue) {
                    const lblVault = window.i18n ? window.i18n.t('notif_btn_unlock_vault') || 'Déverrouiller le coffre' : 'Déverrouiller le coffre';
                    contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">🔐 ${lblVault}</button>`;
                } else if (linkObj.action === 'open_pending' || (linkObj.matches > 0 || linkObj.new_txs > 0)) {
                    const lblExamine = window.i18n ? window.i18n.t('notif_btn_examine') || 'Examiner' : 'Examiner';
                    contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">🔍 ${lblExamine}</button>`;
                } else if (linkObj.view === 'accounts' || linkObj.view === 'accounts_manager' || linkObj.action === 'bank_sync' || n.type === 'bank_sync_error') {
                    const lblAcc = (n.type === 'bank_sync_error') 
                        ? (window.i18n ? window.i18n.t('notif_btn_manage_connections') || 'Gérer les connexions' : 'Gérer les connexions')
                        : (window.i18n ? window.i18n.t('notif_btn_view_accounts') || 'Voir les comptes' : 'Voir les comptes');
                    const icon = (n.type === 'bank_sync_error') ? '⚙️' : '🏦';
                    contextActionBtn = `<button class="btn-notif-action-main notif-action-btn" onclick="event.stopPropagation(); window.app.handleNotifAction(${n.id})">${icon} ${lblAcc}</button>`;
                }
            } catch (e) {
                console.error("Error parsing link_data for notif action button", e);
            }
        }

        // Archive / Unarchive / Delete buttons
        let managementBtns = '';
        let archivedMeta = '';

        if (isArchived) {
            const unarchiveLabel = window.i18n ? window.i18n.t('notif_btn_unarchive') || 'Désarchiver' : 'Désarchiver';
            const deleteLabel = window.i18n ? window.i18n.t('notif_btn_delete_perm') || 'Supprimer' : 'Supprimer';
            
            if (n.archived_at) {
                const archDateStr = this._parseNotifDate(n.archived_at).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
                archivedMeta = `<span class="notif-card-archived-meta">${window.i18n ? window.i18n.tp('notif_archived_on', { date: archDateStr }) : `Archivé le ${archDateStr}`}</span>`;
            }

            managementBtns = `
                <button class="btn-notif-unarchive notif-action-btn" onclick="event.stopPropagation(); window.app.unarchiveNotif(${n.id})" title="${unarchiveLabel}">${unarchiveLabel}</button>
                <button id="delete-notif-btn-${n.id}" class="btn-notif-del-perm notif-action-btn" onclick="event.stopPropagation(); window.app.deleteNotif(${n.id}, event)" title="${deleteLabel}">🗑️</button>`;
        } else {
            const archiveLabel = window.i18n ? window.i18n.t('notif_btn_archive') || 'Archiver' : 'Archiver';
            managementBtns = `
                <button class="btn-notif-archive notif-action-btn" onclick="event.stopPropagation(); window.app.archiveNotif(${n.id})" title="${archiveLabel}">${archiveLabel}</button>`;
        }

        return `
        <div class="notif-card ${unreadClass} ${isArchived ? 'archived' : ''}" ${clickCallback}>
            <div class="notif-card-header">
                <span class="notif-card-title" style="color: ${(!n.is_read && !isArchived) ? 'var(--accent)' : 'var(--text-main)'};">${displayTitle}</span>
                <span class="notif-card-date">${dateStr}</span>
            </div>
            <div class="notif-card-content">${displayContent}</div>
            <div class="notif-card-footer">
                ${archivedMeta}
                <div class="notif-card-actions">
                    ${contextActionBtn}
                    ${managementBtns}
                </div>
            </div>
        </div>`;
    },

    async handleNotifClick(id) {
        // Clicking the notification card only marks it as read
        await this.markNotifRead(id);
    },

    async handleNotifAction(id) {
        const n = this._notifDataMap && this._notifDataMap[id];
        if (!n) return;

        // 1. Mark as read
        if (!n.is_read) {
            await this.markNotifRead(id);
        }

        // 2. Perform the action
        if (n.type === 'ai_report') {
            await this.deepenAIReportById(id);
            return;
        }

        if (n.link_data) {
            try {
                const linkObj = typeof n.link_data === 'string' ? JSON.parse(n.link_data) : n.link_data;
                const notifMenu = document.getElementById('notifMenu');

                const errStr = String(linkObj.error || n.content || '').toLowerCase();
                const isVaultOrPasswordIssue = linkObj.action === 'unlock_vault' || 
                    (n.type === 'bank_sync_error' && (
                        errStr.includes('mot de passe') || 
                        errStr.includes('password') || 
                        errStr.includes('coffre') || 
                        errStr.includes('vault') || 
                        errStr.includes('verrouill') ||
                        errStr.includes('identifiant')
                    ));

                const is2FA = n.type === 'bank_sync_2fa' || linkObj.action === 'bank_sync_2fa';
                if (linkObj.session_id) {
                    sessionStorage.setItem('chatActiveSessionId', linkObj.session_id);
                    if (window.ChatView) {
                        window.ChatView.activeSessionId = linkObj.session_id;
                    }
                    if (notifMenu) notifMenu.style.display = 'none';
                    this.loadView('chat');
                } else if (is2FA) {
                    if (notifMenu) notifMenu.style.display = 'none';
                    if (this.currentView !== 'accounts') {
                        await this.loadView('accounts');
                    }
                    if (linkObj.conn_id && window.BankSyncView && typeof window.BankSyncView.promptAndSync === 'function') {
                        window.BankSyncView.promptAndSync(linkObj.conn_id);
                    }
                } else if (isVaultOrPasswordIssue) {
                    if (notifMenu) notifMenu.style.display = 'none';
                    if (window.BankSyncView && typeof window.BankSyncView.unlockVaultManually === 'function') {
                        window.BankSyncView.unlockVaultManually();
                    }
                } else if (linkObj.action === 'open_pending' || (linkObj.matches > 0 || linkObj.new_txs > 0)) {
                    if (notifMenu) notifMenu.style.display = 'none';
                    if (window.BankSyncView && window.BankSyncView.openPendingReviewModal) {
                        window.BankSyncView.openPendingReviewModal();
                    }
                } else if (linkObj.view === 'accounts' || linkObj.view === 'accounts_manager' || linkObj.action === 'bank_sync' || n.type === 'bank_sync_error') {
                    if (notifMenu) notifMenu.style.display = 'none';
                    if (this.currentView !== 'accounts') {
                        this.loadView('accounts');
                    }
                }
            } catch (e) {
                console.error("Failed to execute notif action", e);
            }
        }
    },

    async markNotifRead(id) {
        try {
            await API.put(`/api/notifications/${id}/read`);
            await this.loadNotifications();
        } catch (e) {
            console.error(e);
        }
    },

    async markAllNotifsRead() {
        try {
            await API.put('/api/notifications/read-all');
            await this.loadNotifications();
        } catch (e) {
            console.error(e);
        }
    },

    async archiveNotif(id) {
        try {
            await API.put(`/api/notifications/${id}/archive`);
            await this.loadNotifications();
            if (typeof showToast === 'function') {
                const toastMsg = window.i18n ? window.i18n.t('notif_archived_toast') || 'Notification archivée' : 'Notification archivée';
                showToast(toastMsg, 'success', 2500);
            }
        } catch (e) {
            console.error("Failed to archive notification", e);
        }
    },

    async unarchiveNotif(id) {
        try {
            await API.put(`/api/notifications/${id}/unarchive`);
            await this.loadNotifications();
            if (typeof showToast === 'function') {
                const toastMsg = window.i18n ? window.i18n.t('notif_unarchived_toast') || 'Notification restaurée' : 'Notification restaurée';
                showToast(toastMsg, 'success', 2500);
            }
        } catch (e) {
            console.error("Failed to unarchive notification", e);
        }
    },

    async archiveAllNotifs(event) {
        try {
            await API.put('/api/notifications/archive-all');
            await this.loadNotifications();
            if (typeof showToast === 'function') {
                const toastMsg = window.i18n ? window.i18n.t('notif_all_archived_toast') || 'Toutes les notifications ont été archivées' : 'Toutes les notifications ont été archivées';
                showToast(toastMsg, 'success', 3000);
            }
        } catch (e) {
            console.error("Failed to archive all notifications", e);
        }
    },

    async clearArchives(event) {
        const btn = event ? event.currentTarget : document.getElementById('clearArchivesBtn');
        if (!btn) return;

        // 2-step confirmation per Rule G-08
        if (btn.dataset.confirmState === "true") {
            try {
                await API.del('/api/notifications/archives/clear');
                await this.loadNotifications();
                if (typeof showToast === 'function') {
                    const toastMsg = window.i18n ? window.i18n.t('notif_archives_cleared_toast') || 'Archives vidées avec succès' : 'Archives vidées avec succès';
                    showToast(toastMsg, 'success', 3000);
                }
            } catch (e) {
                console.error("Failed to clear archives", e);
            }
        } else {
            btn.dataset.confirmState = "true";
            const originalText = btn.textContent;
            const confirmTxt = (window.i18n && window.i18n.t('notif_btn_clear_archives_confirm')) || (window.i18n && window.i18n.lang === 'en' ? "Confirm purge?" : "Confirmer la purge ?");
            btn.textContent = confirmTxt;
            btn.style.color = "#ef4444";
            btn.style.fontWeight = "700";

            const resetBtn = () => {
                if (btn && btn.dataset.confirmState === "true") {
                    btn.dataset.confirmState = "false";
                    btn.textContent = originalText;
                    btn.style.color = "#ff5630";
                    btn.style.fontWeight = "600";
                }
            };
            if (btn._resetTimeout) clearTimeout(btn._resetTimeout);
            btn._resetTimeout = setTimeout(resetBtn, 3500);
        }
    },

    async deleteNotif(id, event) {
        const btn = event ? event.currentTarget : document.getElementById(`delete-notif-btn-${id}`);
        if (!btn) return;

        // 2-step confirmation per Rule G-08
        if (btn.dataset.confirmState === "true") {
            try {
                await API.del(`/api/notifications/${id}`);
                await this.loadNotifications();
            } catch (e) {
                console.error(e);
            }
        } else {
            btn.dataset.confirmState = "true";
            const originalText = btn.textContent;
            btn.textContent = window.i18n && window.i18n.lang === 'en' ? "Confirm?" : "Confirmer ?";
            btn.style.background = "#ff5630";
            btn.style.color = "white";
            btn.style.border = "1px solid #ff5630";

            const resetBtn = () => {
                if (btn && btn.dataset.confirmState === "true") {
                    btn.dataset.confirmState = "false";
                    btn.textContent = originalText;
                    btn.style.background = "rgba(239,68,68,0.05)";
                    btn.style.color = "#ef4444";
                    btn.style.border = "1px solid rgba(239,68,68,0.2)";
                }
            };
            btn._resetTimeout = setTimeout(resetBtn, 3000);
        }
    },

    deepenAIReportById(notifId) {
        const n = this._notifDataMap && this._notifDataMap[notifId];
        if (!n) {
            console.error("Notification data not found for id", notifId);
            return;
        }
        this.deepenAIReport(n.content || '', n.detailed_content || '');
    },

    async deepenAIReport(content, detailedContent) {
        try {
            // Close popover
            const notifMenu = document.getElementById('notifMenu');
            if (notifMenu) notifMenu.style.display = 'none';

            const isEn = window.i18n.lang === 'en';
            const sessionTitle = isEn ? "AI Financial Report Deepening" : "Approfondissement Bilan IA";

            // Helper to extract clean Markdown text from raw/escaped JSON
            const extractCleanText = (text) => {
                if (!text) return '';
                let cleaned = text.trim();
                if (cleaned.includes('"detailed_analysis"') || cleaned.includes('"summary"') || cleaned.startsWith('{') || cleaned.startsWith('```')) {
                    try {
                        const jsonCandidate = cleaned.replace(/```(?:json)?/g, '').trim();
                        const parsed = JSON.parse(jsonCandidate);
                        if (parsed.detailed_analysis) return parsed.detailed_analysis.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        if (parsed.summary) return parsed.summary.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                    } catch (e) {
                        const detMatch = cleaned.match(/"detailed_analysis"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                        if (detMatch && detMatch[1]) {
                            return detMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        }
                        const sumMatch = cleaned.match(/"summary"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                        if (sumMatch && sumMatch[1]) {
                            return sumMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        }
                    }
                }
                return cleaned.replace(/\\n/g, '\n').trim();
            };

            // Create a new session
            const newSession = await API.post('/api/chat/sessions', {
                title: sessionTitle,
                role: "advisor"
            });
            
            const sessionId = newSession.id;

            // 1. Insert the detailed report as an ASSISTANT message (will render with full markdown)
            const cleanDetailed = extractCleanText(detailedContent);
            const cleanSummary = extractCleanText(content);
            const textReport = cleanDetailed || cleanSummary;
            const reportIntro = isEn
                ? `## 📊 Financial Health Report\n\n${textReport}`
                : `## 📊 Bilan de Santé Financière\n\n${textReport}`;

            await API.post(`/api/chat/sessions/${sessionId}/system-message`, {
                content: reportIntro,
                role: "assistant"
            });

            // 2. Save active session and navigate to chat
            sessionStorage.setItem('chatActiveSessionId', sessionId);
            if (window.ChatView) {
                window.ChatView.activeSessionId = sessionId;
            }

            this.loadView('chat');

            // 3. Pre-fill the suggested question into the chat input so user can send or customize
            setTimeout(() => {
                const textarea = document.getElementById('chatInput');
                if (textarea) {
                    const userPrompt = isEn 
                        ? "Could you analyze my financial situation in detail based on this report? What are the key risks and what concrete actions do you recommend?"
                        : "Pouvez-vous analyser ma situation financière en détail à partir de ce bilan ? Quels sont les principaux risques et quelles actions concrètes me recommandez-vous ?";
                    textarea.value = userPrompt;
                    textarea.focus();
                }
            }, 300);

        } catch (e) {
            console.error("Failed to deepen AI report", e);
            const errToast = window.i18n.lang === 'en' ? "Failed to start conversation." : "Échec du lancement de la discussion.";
            showToast(errToast, 'error', 3000);
        }
    }
};

// Auto-attachement immédiat si App existe déjà
if (window.App) {
    Object.assign(window.App.prototype, window.AppModules.notifications);
}
