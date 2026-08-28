// static/js/views/config/config_backups.js — Gestion des sauvegardes, exports CSV, restauration & maintenance
window.ConfigView = Object.assign(window.ConfigView || {}, {
    async exportCSV() {
        const columns = [
            { id: "Date de saisie", label: window.i18n.t('csv_col_entry_date') || "Date de saisie" },
            { id: "Date opération", label: window.i18n.t('csv_col_op_date') || "Date opération" },
            { id: "Description", label: window.i18n.t('th_description') || "Description" },
            { id: "Montant", label: window.i18n.t('th_amount') || "Montant" },
            { id: "Type", label: window.i18n.t('th_type') || "Type" },
            { id: "Catégorie", label: window.i18n.t('th_category') || "Catégorie" },
            { id: "Date de rapprochement", label: window.i18n.t('csv_col_reconciliation_date') || "Date de rapprochement" },
            { id: "Répétition mensuelle", label: window.i18n.t('csv_col_monthly_repeat') || "Répétition mensuelle" },
            { id: "Répétition annuelle", label: window.i18n.t('csv_col_yearly_repeat') || "Répétition annuelle" },
            { id: "Répétition bi-mensuelle", label: window.i18n.t('csv_col_bimonthly_repeat') || "Répétition bi-mensuelle" },
            { id: "Jour de récurrence 1", label: window.i18n.t('csv_col_recurrence_day_1') || "Jour de récurrence 1" },
            { id: "Jour de récurrence 2", label: window.i18n.t('csv_col_recurrence_day_2') || "Jour de récurrence 2" },
            { id: "Documents joints", label: window.i18n.t('csv_col_attachments') || "Documents joints" },
            { id: "Bordereau de chèque", label: window.i18n.t('csv_col_check_slip') || "Bordereau de chèque" },
            { id: "Depuis", label: window.i18n.t('csv_col_from') || "Depuis" },
            { id: "Vers", label: window.i18n.t('csv_col_to') || "Vers" },
            { id: "ID", label: "ID" }
        ];
        
        const container = document.getElementById('exportColumnsContainer');
        if (container) {
            container.innerHTML = columns.map(col => `
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" class="export-col-cb" value="${col.id}" checked>
                    ${col.label}
                </label>
            `).join('');
            document.getElementById('exportConfigModal').style.display = 'flex';
        } else {
            this._downloadCSV('/api/csv/export');
        }
    },
    
    confirmExportCSV() {
        const checkboxes = document.querySelectorAll('.export-col-cb:checked');
        const selectedCols = Array.from(checkboxes).map(cb => cb.value).join(',');
        
        if (!selectedCols) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_select_columns'));
            return;
        }
        
        document.getElementById('exportConfigModal').style.display = 'none';
        this._downloadCSV('/api/csv/export?cols=' + encodeURIComponent(selectedCols));
    },

    async _downloadCSV(endpoint) {
        const downloadUrl = `${window.location.origin}${endpoint}`;

        // In Tauri WebView, blob downloads don't work — open in system browser
        if (window.__TAURI_INTERNALS__) {
            showToast(window.i18n.t('msg_backup_browser') || 'Le téléchargement s\'ouvre dans votre navigateur...', 'info', 4000);
            try {
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Fallback for regular browser (dev mode)
        window.open(endpoint, '_blank');
    },

    async importRawCSV(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/csv/import', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }
            
            const data = await res.json();
            
            if (data.attachments_needed && data.attachments_needed.length > 0) {
                // Create a manual trigger modal to bypass browser async popup blockers
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh';
                overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
                overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '9999';
                
                const modal = document.createElement('div');
                modal.style.background = 'var(--bg-surface)';
                modal.style.padding = '20px';
                modal.style.borderRadius = '8px';
                modal.style.maxWidth = '500px';
                modal.style.textAlign = 'center';
                modal.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
                
                const title = document.createElement('h3');
                title.textContent = window.i18n.t('title_missing_attachments');
                title.style.marginTop = '0';
                
                const text = document.createElement('p');
                text.textContent = window.i18n.tp('msg_attachments_needed', {count: data.attachments_needed.length});
                
                const btnContainer = document.createElement('div');
                btnContainer.style.marginTop = '20px';
                btnContainer.style.display = 'flex';
                btnContainer.style.justifyContent = 'center';
                btnContainer.style.gap = '10px';
                
                const btnCancel = document.createElement('button');
                btnCancel.className = 'btn btn-secondary';
                btnCancel.textContent = window.i18n.t('btn_ignore');
                btnCancel.onclick = () => {
                    document.body.removeChild(overlay);
                    showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_no_attach', {count: data.imported}));
                    setTimeout(() => window.location.reload(), 2000);
                };
                
                const label = document.createElement('label');
                label.className = 'btn btn-primary';
                label.style.cursor = 'pointer';
                label.textContent = window.i18n.t('btn_select_folder');
                
                const input = document.createElement('input');
                input.type = 'file';
                input.webkitdirectory = true;
                input.style.display = 'none';
                
                label.appendChild(input);
                btnContainer.appendChild(btnCancel);
                btnContainer.appendChild(label);
                
                modal.appendChild(title);
                modal.appendChild(text);
                modal.appendChild(btnContainer);
                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                input.onchange = async (e) => {
                    label.textContent = window.i18n.t('label_loading');
                    label.style.pointerEvents = "none";
                    btnCancel.disabled = true;
                    
                    if (!e.target.files.length) {
                        document.body.removeChild(overlay);
                        showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_no_attach', {count: data.imported}));
                        setTimeout(() => window.location.reload(), 2000);
                        return;
                    }
                    
                    const files = Array.from(e.target.files);
                    const formDataUpload = new FormData();
                    const paths = [];
                    
                    for (const att of data.attachments_needed) {
                        const expectedName = att.replace(/\\/g, '/').split('/').pop();
                        const matchedFile = files.find(f => f.name === expectedName || f.webkitRelativePath.endsWith(expectedName));
                        if (matchedFile) {
                            formDataUpload.append("files", matchedFile);
                            paths.push(att);
                        }
                    }
                    
                    if (paths.length > 0) {
                        formDataUpload.append("relative_paths", JSON.stringify(paths));
                        try {
                            const upRes = await fetch('/api/csv/upload_attachments', {
                                method: 'POST',
                                body: formDataUpload
                            });
                            const upData = await upRes.json();
                            if (upData.saved) {
                                await fetch('/api/csv/update_imported_attachments', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ mapping: upData.saved })
                                });
                            }
                        } catch(err) {
                            console.error("Erreur upload attachments", err);
                        }
                    }
                    
                    document.body.removeChild(overlay);
                    showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_with_attach', {count: data.imported}));
                    setTimeout(() => window.location.reload(), 2000);
                };
            } else {
                showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_skipped', {count: data.imported, skipped: data.skipped}));
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_import_failed', {error: e.message}));
        } finally {
            event.target.value = '';
        }
    },

    async clearDB() {
        const i18nMsg = (window.i18n && window.i18n.t) ? window.i18n.t('alert_clear_db') : window.i18n.t('alert_clear_db');
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), i18nMsg)) {
            try {
                await API.del('/api/transactions/all/clear', null, { 'X-Confirm-Danger': 'clear' });
                showToast(window.i18n.t('msg_db_cleared'), 'success');
                // Trigger setup wizard instead of full reload
                if (window.SetupWizard) {
                    window.SetupWizard.show();
                } else {
                    window.location.reload();
                }
            } catch (e) {
                console.error(e);
                showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_db_clear_error'));
            }
        }
    },

    async restoreBackup(event) {
        const file = event.target.files[0];
        if (!file) return;

        const confirmMsg = (window.i18n && window.i18n.t) ? window.i18n.t('alert_restore_backup') : window.i18n.t('alert_restore_backup');
        if (!await showInlineConfirm(window.i18n.t('title_restore_critical'), confirmMsg)) {
            event.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/backup/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }

            showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_restore_success'));
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_restore_failed', {error: e.message}));
        } finally {
            event.target.value = '';
        }
    },

    async downloadBackup() {
        try {
            const downloadUrl = `${window.location.origin}/api/backup/download`;

            // In Tauri WebView, blob downloads don't work — open in system browser
            if (window.__TAURI_INTERNALS__) {
                showToast(window.i18n.t('msg_backup_browser') || 'Le téléchargement s\'ouvre dans votre navigateur...', 'info', 4000);
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
                return;
            }

            // Fallback for regular browser (dev mode)
            showToast(window.i18n.t('label_loading') || 'Préparation...', 'info', 5000);
            const resp = await fetch('/api/backup/download');
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const filename = resp.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]
                || `omnibank_backup_${new Date().toISOString().slice(0,10)}.zip`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_error_generic', {error: e.message || e}));
        }
    },

    async fixTypeMismatch() {
        const btn = document.getElementById('btnFixTypeMismatch');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse...'; }
        try {
            const preview = await API.get('/api/maintenance/fix_type_mismatch/preview');
            if (btn) { btn.disabled = false; btn.innerHTML = '🔧 ' + (window.i18n.t('maintenance_fix_types') || 'Fix inconsistent types'); }

            if (preview.count === 0) {
                showInlineMessage('✅', window.i18n.t('maintenance_no_fix_needed') || 'No inconsistencies detected. Everything is in order!');
                return;
            }

            // Build a clear, user-friendly preview
            const sharedCats = preview.affected_categories.filter(c => c.shared);
            const nonSharedCats = preview.affected_categories.filter(c => !c.shared);

            // Summary section
            let summaryHtml = `
                <div style="background:var(--bg-surface);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--border-color);">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:20px;">🔍</span>
                        <strong style="font-size:14px;">${window.i18n.t('maintenance_summary') || "Résumé de l'analyse"}</strong>
                    </div>
                    <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;">
                        <strong style="color:var(--text-main);">${preview.count}</strong>
                        ${window.i18n.t('maintenance_summary_desc') || "opération(s) récurrentes sont classées comme « Dépense variable » alors qu'elles devraient être en « Charge fixe ». Cette correction mettra à jour leur type automatiquement."}
                    </p>
                </div>`;

            // Sample transactions table
            let sampleHtml = '';
            if (preview.sample && preview.sample.length > 0) {
                const rows = preview.sample.slice(0, 5).map(tx => `
                    <tr>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.date_operation || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.description || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.category || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;text-align:right;">${formatCurrency(tx.amount)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--color-expense);">variable → <span style="color:#10b981;">fixe</span></td>
                    </tr>
                `).join('');

                sampleHtml = `
                <div style="margin-bottom:14px;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;">
                        ${window.i18n.t('maintenance_sample') || "Exemples d'opérations concernées"}
                        ${preview.count > 5 ? '<span style="font-weight:400;text-transform:none;"> (5 sur ' + preview.count + ')</span>' : ''}
                    </div>
                    <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border-color);">
                        <table style="width:100%;border-collapse:collapse;">
                            <thead><tr style="background:var(--bg-surface);">
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_date_op') || 'Date'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_description') || 'Description'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_category') || 'Category'}</th>
                                <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_amount') || 'Amount'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('maintenance_correction') || 'Correction'}</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
            }

            // Category choices (shared categories need user decision)
            let catChoicesHtml = '';
            if (sharedCats.length > 0) {
                catChoicesHtml = `
                <div style="padding:12px;background:rgba(245,158,11,0.06);border-radius:10px;border:1px solid rgba(245,158,11,0.25);margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                        <span style="font-size:16px;">⚠️</span>
                        <strong style="font-size:13px;color:#f59e0b;">${window.i18n.t('maintenance_cat_choice') || 'Shared categories'}</strong>
                    </div>
                    <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;line-height:1.4;">
                        ${window.i18n.t('maintenance_cat_choice_desc') || "Ces catégories sont utilisées par des opérations récurrentes ET des dépenses variables ponctuelles. Choisissez l'action pour chaque :"}
                    </p>
                    ${sharedCats.map(c => `
                        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:4px;background:var(--bg-surface);border-radius:8px;">
                            <span style="flex:1;font-weight:600;font-size:13px;">${c.name}</span>
                            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);">
                                <input type="radio" name="cat_${c.name}" value="move" checked> ${window.i18n.t('maintenance_cat_move') || 'Move to Fixed charges'}
                            </label>
                            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);">
                                <input type="radio" name="cat_${c.name}" value="keep"> ${window.i18n.t('maintenance_cat_keep') || 'Keep as Variable'}
                            </label>
                        </div>`).join('')}
                </div>`;
            }

            // Auto-moved categories (informational)
            let autoMovedHtml = '';
            if (nonSharedCats.length > 0) {
                autoMovedHtml = `
                <div style="padding:10px;background:rgba(16,185,129,0.06);border-radius:8px;border:1px solid rgba(16,185,129,0.25);">
                    <div style="font-size:12px;color:#10b981;margin-bottom:4px;font-weight:600;">✅ ${window.i18n.t('maintenance_auto_move') || 'Categories moved automatically'}</div>
                    <p style="font-size:11px;color:var(--text-muted);margin:0;">
                        ${nonSharedCats.map(c => '<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;margin-right:4px;font-weight:500;">' + c.name + '</span>').join('')}
                    </p>
                </div>`;
            }

            const msgHtml = '<div style="max-height:60vh;overflow-y:auto;">' + summaryHtml + sampleHtml + catChoicesHtml + autoMovedHtml + '</div>';

            const ok = await showInlineConfirm(
                window.i18n.t('maintenance_fix_preview') || 'Preview fix',
                msgHtml
            );
            if (!ok) return;

            // Gather cat_moves decisions
            const toMove = sharedCats
                .filter(c => {
                    const radio = document.querySelector(`input[name="cat_${c.name}"][value="move"]`);
                    return radio && radio.checked;
                })
                .map(c => c.name);
            const allMoves = [...nonSharedCats.map(c => c.name), ...toMove];

            const result = await API.post(`/api/maintenance/fix_type_mismatch/apply?cat_moves=${encodeURIComponent(allMoves.join(','))}`);
            showToast(
                (window.i18n.t('maintenance_fix_result') || 'Migration complete: {tx} transactions, {cat} categories corrected.')
                    .replace('{tx}', result.tx_fixed)
                    .replace('{cat}', result.cat_fixed),
                'success', 4000
            );
        } catch(e) {
            console.error(e);
            if (btn) { btn.disabled = false; }
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async cleanOrphanRecurrences() {
        const btn = document.getElementById('btnCleanOrphanRecurrences');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse...'; }
        try {
            const preview = await API.get('/api/maintenance/orphan_recurrences/preview');
            if (btn) { btn.disabled = false; btn.innerHTML = '🧹 ' + (window.i18n.t('maintenance_orphan_btn') || 'Clean up orphan recurrences'); }

            if (preview.count === 0) {
                showInlineMessage('✅', window.i18n.t('maintenance_orphan_none') || 'No orphan recurrences detected. Everything is in order!');
                return;
            }

            // Build per-transaction review modal with checkboxes
            let contentHtml = `
                <div style="max-height:60vh;overflow-y:auto;">
                    <div style="background:var(--bg-surface);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--border-color);">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                            <span style="font-size:20px;">🔍</span>
                            <strong style="font-size:14px;">${window.i18n.t('maintenance_orphan_summary') || "Résumé de l'analyse"}</strong>
                        </div>
                        <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;">
                            <strong style="color:var(--text-main);">${preview.count}</strong>
                            ${window.i18n.t('maintenance_orphan_summary_desc') || "opération(s) générées automatiquement pour des récurrences qui n'ont aucune transaction rapprochée la même année. Ces opérations ont probablement été créées par erreur."}
                        </p>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">
                            ${window.i18n.t('maintenance_orphan_select_label') || 'Select transactions to delete'}
                        </span>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--primary-color);">
                            <input type="checkbox" id="orphanSelectAll" checked onchange="document.querySelectorAll('.orphan-tx-cb').forEach(cb => { cb.checked = this.checked; })">
                            ${window.i18n.t('wizard_tooltip_select_all') || 'Select all'}
                        </label>
                    </div>`;

            preview.groups.forEach(group => {
                const closedBadge = group.is_closed
                    ? `<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;">${window.i18n.t('badge_closed') || 'Closed'}</span>`
                    : '';

                contentHtml += `
                    <div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;">
                        <div style="padding:10px 14px;background:var(--bg-surface);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;">
                            <span style="font-size:14px;">🔄</span>
                            <strong style="font-size:13px;">${group.template_description}</strong>
                            ${closedBadge}
                            <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${group.transactions.length} op.</span>
                        </div>
                        <div style="padding:0;">`;

                group.transactions.forEach(tx => {
                    const dateStr = tx.date_operation.split('T')[0];
                    contentHtml += `
                            <label style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-color);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(239,68,68,0.04)'" onmouseout="this.style.background=''">
                                <input type="checkbox" class="orphan-tx-cb" value="${tx.id}" checked style="width:16px;height:16px;flex-shrink:0;">
                                <span style="flex:1;font-size:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                                    <span style="color:var(--text-muted);min-width:85px;">${dateStr}</span>
                                    <span style="font-weight:500;flex:1;min-width:120px;">${tx.description}</span>
                                    <span style="color:var(--text-muted);font-size:11px;">${tx.category || ''}</span>
                                    <span style="font-weight:700;min-width:80px;text-align:right;">${formatCurrency(tx.amount)}</span>
                                </span>
                            </label>`;
                });

                contentHtml += `
                        </div>
                    </div>`;
            });

            contentHtml += `
                    <div style="padding:10px;background:rgba(239,68,68,0.06);border-radius:8px;border:1px solid rgba(239,68,68,0.2);margin-top:8px;">
                        <p style="font-size:12px;color:#ef4444;margin:0;font-weight:500;">
                            ⚠️ ${window.i18n.t('maintenance_orphan_warning') || 'Checked transactions will be permanently deleted. Reconciled transactions can never be deleted.'}
                        </p>
                    </div>
                </div>`;

            const ok = await showInlineConfirm(
                window.i18n.t('maintenance_orphan_preview_title') || 'Orphan recurrence cleanup',
                contentHtml
            );
            if (!ok) return;

            // Gather selected IDs
            const selectedIds = Array.from(document.querySelectorAll('.orphan-tx-cb:checked')).map(cb => parseInt(cb.value));

            if (selectedIds.length === 0) {
                showToast(window.i18n.t('maintenance_orphan_none_selected') || 'No transaction selected.', 'info');
                return;
            }

            const result = await API.post('/api/maintenance/orphan_recurrences/cleanup', selectedIds);
            showToast(
                (window.i18n.t('maintenance_orphan_result') || '{count} transaction(s) deleted.')
                    .replace('{count}', result.deleted),
                'success', 4000
            );

            // Refresh sidebar to update balances
            if (window.app && window.app.refreshSidebar) window.app.refreshSidebar();

        } catch(e) {
            console.error(e);
            if (btn) { btn.disabled = false; }
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async convertZeroedToSkipped() {
        const btn = document.getElementById('btnConvertZeroedToSkipped');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse...'; }
        try {
            const preview = await API.get('/api/maintenance/convert_zeroed_to_skipped/preview');
            if (btn) { btn.disabled = false; btn.innerHTML = '🔄 ' + (window.i18n.t('maintenance_convert_zeroed_btn') || 'Convert 0€ transactions to Skipped'); }

            if (preview.count === 0) {
                showInlineMessage('✅', window.i18n.t('maintenance_convert_zeroed_none') || 'No transactions to convert. Everything is in order!');
                return;
            }

            // Build per-transaction review modal with checkboxes
            const actionText = (window.i18n.t('maintenance_convert_zeroed_action_desc') || "En cochant ces transactions ({count} détectée(s)), elles seront converties en échéances proprement « Ignorées » (passées/suspendues). Cela permet à votre récurrence de rester active et de continuer à générer les mois suivants à leur montant normal.")
                .replace('{count}', preview.count);
            const opsSuffix = window.i18n.t('maintenance_convert_zeroed_ops') || 'op.';

            let contentHtml = `
                <div style="max-height:60vh;overflow-y:auto; text-align: left;">
                    <div style="background:var(--bg-surface);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--border-color);line-height:1.4;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                            <span style="font-size:20px;">💡</span>
                            <strong style="font-size:14px;color:var(--accent);">${window.i18n.t('maintenance_convert_zeroed_why') || 'Pourquoi cette action ?'}</strong>
                        </div>
                        <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-muted);">
                            ${window.i18n.t('maintenance_convert_zeroed_desc_1') || "Auparavant, pour suspendre temporairement un abonnement ou une récurrence (ex. Audible mis en pause pendant 3 mois), la seule solution consistait à mettre manuellement à 0,00 € le montant de l'échéance."}
                        </p>
                        <p style="margin:0 0 10px 0;font-size:13px;color:var(--text-muted);">
                            ${window.i18n.t('maintenance_convert_zeroed_desc_2') || "Cependant, ces montants à 0 € induisent en erreur les algorithmes de maintenance qui croient que la récurrence est définitivement fermée/abandonnée, provoquant des auto-clôtures ou de fausses détections d'orphelines."}
                        </p>
                        <p style="margin:0;font-size:13px;color:var(--text-muted);">
                            <strong>${window.i18n.t('maintenance_convert_zeroed_action_label') || 'Action de la conversion :'}</strong> ${actionText}
                        </p>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">
                            ${window.i18n.t('maintenance_convert_zeroed_select_label') || 'Sélectionnez les transactions à convertir'}
                        </span>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--primary-color);">
                            <input type="checkbox" id="convertSelectAll" checked onchange="document.querySelectorAll('.convert-tx-cb').forEach(cb => { cb.checked = this.checked; })">
                            ${window.i18n.t('maintenance_convert_zeroed_select_all') || 'Tout sélectionner'}
                        </label>
                    </div>`;

            preview.groups.forEach(group => {
                const fallbackHtml = group.fallback_amount != null
                    ? `<span style="margin-left:8px;font-size:11px;color:var(--success-color);font-weight:500;">→ ${formatCurrency(group.fallback_amount)}</span>`
                    : '';
                contentHtml += `
                    <div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;" id="wizard-group-${group.template_id}">
                        <div style="padding:10px 14px;background:var(--bg-surface);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;">
                            <span style="font-size:14px;">🔄</span>
                            <strong style="font-size:13px;">${group.template_description}</strong>
                            ${fallbackHtml}
                            <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${group.transactions.length} ${opsSuffix}</span>
                            <button type="button" class="wizard-close-tpl-btn" data-tpl-id="${group.template_id}" data-tpl-name="${group.template_description}" title="${window.i18n.t('maintenance_close_recurrence_tooltip') || 'Fermer définitivement cette récurrence. Elle ne générera plus de nouvelles échéances.'}" style="margin-left:8px;background:none;border:1px solid var(--danger-color);color:var(--danger-color);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;transition:all .15s;white-space:nowrap;" onmouseover="this.style.background='var(--danger-color)';this.style.color='#fff'" onmouseout="this.style.background='none';this.style.color='var(--danger-color)'"
                            >🚫 ${window.i18n.t('maintenance_close_recurrence') || 'Fermer'}</button>
                        </div>
                        <div style="padding:0;">`;

                group.transactions.forEach(tx => {
                    const dateStr = tx.date_operation.split('T')[0];
                    contentHtml += `
                            <label style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-color);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(99,102,241,0.04)'" onmouseout="this.style.background=''">
                                <input type="checkbox" class="convert-tx-cb" value="${tx.id}" checked style="width:16px;height:16px;flex-shrink:0;">
                                <span style="flex:1;font-size:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                                    <span style="color:var(--text-muted);min-width:85px;">${dateStr}</span>
                                    <span style="font-weight:500;flex:1;min-width:120px;">${tx.description}</span>
                                    <span style="color:var(--text-muted);font-size:11px;">${tx.category || ''}</span>
                                    <span style="font-weight:700;min-width:80px;text-align:right;">${formatCurrency(tx.amount)}</span>
                                </span>
                            </label>`;
                });

                contentHtml += `
                        </div>
                    </div>`;
            });

            contentHtml += `</div>`;

            // Attach close-recurrence button handlers via event delegation on the modal
            const _attachCloseHandlers = () => {
                document.querySelectorAll('.wizard-close-tpl-btn').forEach(btn => {
                    btn.onclick = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const tplId = btn.dataset.tplId;
                        const tplName = btn.dataset.tplName;
                        btn.disabled = true;
                        btn.textContent = '⏳...';
                        try {
                            await API.post(`/api/maintenance/close_template/${tplId}`);
                            const groupEl = document.getElementById(`wizard-group-${tplId}`);
                            if (groupEl) {
                                groupEl.style.transition = 'opacity 0.3s, max-height 0.3s';
                                groupEl.style.opacity = '0';
                                groupEl.style.maxHeight = '0';
                                groupEl.style.overflow = 'hidden';
                                groupEl.style.marginBottom = '0';
                                groupEl.style.borderWidth = '0';
                                setTimeout(() => groupEl.remove(), 350);
                                // Uncheck removed transactions from select-all logic
                                groupEl.querySelectorAll('.convert-tx-cb').forEach(cb => cb.checked = false);
                            }
                            showToast(
                                (window.i18n.t('maintenance_close_recurrence_confirm') || 'La récurrence « {name} » a été fermée.')
                                    .replace('{name}', tplName),
                                'success', 4000
                            );
                        } catch (err) {
                            console.error(err);
                            btn.disabled = false;
                            btn.textContent = '🚫 ' + (window.i18n.t('maintenance_close_recurrence') || 'Fermer');
                            showToast('Erreur', 'error');
                        }
                    };
                });
            };
            // Queue handler attachment after DOM render
            setTimeout(_attachCloseHandlers, 50);

            const ok = await showInlineConfirm(
                window.i18n.t('maintenance_convert_zeroed_title') || "Assainir les échéances suspendues à 0 €",
                contentHtml
            );
            if (!ok) return;

            const selectedIds = Array.from(document.querySelectorAll('.convert-tx-cb:checked')).map(cb => parseInt(cb.value));
            if (selectedIds.length === 0) {
                showToast('Aucune transaction sélectionnée.', 'info');
                return;
            }
            try {
                const result = await API.post('/api/maintenance/convert_zeroed_to_skipped/apply', selectedIds);
                showToast(
                    (window.i18n.t('maintenance_convert_zeroed_result') || '{count} transaction(s) converted.')
                        .replace('{count}', result.converted),
                    'success', 4000
                );
                if (window.app && window.app.refreshSidebar) window.app.refreshSidebar();
            } catch (e) {
                console.error(e);
                showToast("Erreur lors de la conversion", "error");
            }
        } catch(e) {
            console.error(e);
            if (btn) { btn.disabled = false; }
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },


    async _refreshAutoBackupStatus() {
        const panel = document.getElementById('autoBackupStatusPanel');
        if (!panel) return;

        try {
            const data = await API.get('/api/backup/auto/status');
            const status = data.status;
            const files = data.files || [];
            const dir = data.backups_dir || '';

            if (!status && files.length === 0) {
                panel.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; font-style: italic;" data-i18n="config_auto_backup_none_yet">${window.i18n.t('config_auto_backup_none_yet')}</p>`;
                return;
            }

            let html = '';

            // Last backup status
            if (status) {
                const dateStr = status.last_date ? new Date(status.last_date).toLocaleString() : '-';
                const sizeStr = status.last_size_bytes ? (status.last_size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '-';
                const statusIcon = status.success ? '✅' : '❌';
                const statusLabel = status.success
                    ? window.i18n.t('config_auto_backup_success')
                    : (window.i18n.t('config_auto_backup_failed') + (status.error ? ': ' + status.error : ''));

                html += `
                <div style="background: var(--bg-main); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid var(--border-color);">
                    <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px;">
                        <div>📅 <strong>${window.i18n.t('config_auto_backup_last')} :</strong> ${dateStr} — ${sizeStr}</div>
                        <div>${statusIcon} ${statusLabel}</div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
                        📂 <strong>${window.i18n.t('config_auto_backup_path')} :</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                        <input type="text" readonly value="${dir}" id="autoBackupPathInput" style="flex: 1; font-size: 11px; font-family: monospace; padding: 4px 8px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-main); cursor: text; min-width: 0;" onclick="this.select()">
                        <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 10px; white-space: nowrap;" onclick="navigator.clipboard.writeText(document.getElementById('autoBackupPathInput').value).then(()=>showToast(window.i18n.t('config_auto_backup_copied'),'success',2000))" title="${window.i18n.t('config_auto_backup_copy_path')}">📋 ${window.i18n.t('config_auto_backup_copy_path')}</button>
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 5px; font-style: italic;">
                        🔒 ${window.i18n.t('config_auto_backup_path_hint')}
                    </div>
                </div>`;
            }

            // List available backups
            if (files.length > 0) {
                html += `<div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;" data-i18n="config_auto_backup_available">${window.i18n.t('config_auto_backup_available')}</div>`;
                html += '<div style="display: flex; flex-direction: column; gap: 4px;">';
                for (const f of files) {
                    const fDate = new Date(f.created).toLocaleString();
                    const fSize = (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB';
                    html += `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--bg-main); border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px;">
                        <span>📦 ${f.filename} <span style="color: var(--text-muted);">(${fDate} — ${fSize})</span></span>
                        <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;" onclick="window.ConfigView.downloadAutoBackup('${f.filename}')">💾</button>
                    </div>`;
                }
                html += '</div>';
            }

            panel.innerHTML = html;
        } catch (e) {
            console.error('[AutoBackup] Erreur chargement statut', e);
            panel.innerHTML = '';
        }
    },

    async triggerAutoBackup() {
        const btn = document.getElementById('btnTriggerAutoBackup');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + window.i18n.t('config_auto_backup_triggered'); }

        try {
            const res = await fetch('/api/backup/auto/trigger', { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            showToast(window.i18n.t('config_auto_backup_trigger_ok'), 'success', 3000);
            await this._refreshAutoBackupStatus();
        } catch (e) {
            console.error('[AutoBackup] Trigger failed', e);
            showToast(window.i18n.t('config_auto_backup_trigger_fail').replace('{error}', e.message), 'error', 4000);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '▶️ <span data-i18n="config_auto_backup_trigger">' + window.i18n.t('config_auto_backup_trigger') + '</span>';
            }
        }
    },

    async downloadAutoBackup(filename) {
        try {
            const downloadUrl = `${window.location.origin}/api/backup/auto/download/${encodeURIComponent(filename)}`;

            // Tauri workaround: blob downloads don't work in WebView
            if (window.__TAURI_INTERNALS__) {
                showToast(window.i18n.t('msg_backup_browser') || 'Download opening in your browser...', 'info', 4000);
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
                return;
            }

            // Regular browser download
            const resp = await fetch(`/api/backup/auto/download/${encodeURIComponent(filename)}`);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[AutoBackup] Download failed', e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_error_generic', {error: e.message || e}));
        }
    },


    async downloadAllProfilesBackup() {
        try {
            const downloadUrl = `${window.location.origin}/api/backup/download-all`;

            // In Tauri WebView, blob downloads don't work — open in system browser
            if (window.__TAURI_INTERNALS__) {
                showToast(window.i18n.t('msg_backup_browser') || 'Le téléchargement s\'ouvre dans votre navigateur...', 'info', 4000);
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
                return;
            }

            // Fallback for regular browser (dev mode)
            showToast(window.i18n.t('label_loading') || 'Préparation...', 'info', 5000);
            const resp = await fetch('/api/backup/download-all');
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const filename = resp.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]
                || `omnibank_GLOBAL_backup_${new Date().toISOString().slice(0,10)}.zip`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_error_generic', {error: e.message || e}));
        }
    },

    async restoreAllProfilesBackup(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!await showInlineConfirm(window.i18n.t('title_restore_critical'), window.i18n.t('alert_restore_all_profiles'))) {
            e.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            showToast(window.i18n.t('msg_restore_all_progress'), "info");
            const res = await fetch('/api/backup/upload-all', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.detail || window.i18n.t('msg_restore_all_failed').replace('{error}', ''));
            }

            showToast(window.i18n.t('msg_restore_all_success'), "success");
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            console.error(err);
            showToast(window.i18n.t('msg_restore_all_failed').replace('{error}', err.message || ''), "error");
        } finally {
            e.target.value = '';
        }
    }
});

