window.ImportWizard = {
    selectedFile: null,
    fileBalance: null,
    descriptions: {},

    async loadDescriptions() {
        try {
            this.descriptions = await API.get('/api/transactions/descriptions');
            const dataList = document.getElementById('importDescList');
            if (dataList) {
                dataList.innerHTML = Object.keys(this.descriptions).map(d => `<option value="${d}">`).join('');
            }
        } catch (e) {
            console.error('Failed to load descriptions', e);
        }
    },

    onDescriptionInput(input) {
        const desc = input.value;
        if (this.descriptions && this.descriptions[desc]) {
            const data = this.descriptions[desc];
            if (data.category) {
                const tr = input.closest('tr');
                if (tr) {
                    const catSelect = tr.querySelector('.import-cat');
                    if (catSelect) {
                        catSelect.value = data.category;
                    }
                }
            }
        }
    },

    open() {
        document.getElementById('globalCsvFileInput').click();
    },

    onFileSelected(event) {
        this.selectedFile = event.target.files[0];
        if (!this.selectedFile) return;
        
        document.getElementById('importDataDesc').textContent = `Fichier sélectionné: ${this.selectedFile.name}. Choisissez l'analyse.`;
        document.getElementById('importDataTable').style.display = 'none';
        document.getElementById('importDataBody').innerHTML = '';
        this.fileBalance = null;
        document.getElementById('balanceVerificationBox').style.display = 'none';
        
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) summaryDiv.style.display = 'none';
        
        document.getElementById('btnSaveImport').style.display = 'none';
        
        const btnCatAll = document.getElementById('btnCategorizeAllAI');
        if (btnCatAll) btnCatAll.style.display = 'none';
        
        const aiBtn = document.getElementById('btnAnalyzeAI');
        if (aiBtn) {
            aiBtn.style.display = (window.app && window.app.config && window.app.config.enable_ai === 'true') ? 'inline-block' : 'none';
        }
        
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'flex';
        const saveBtns = document.getElementById('importSaveButtons');
        if (saveBtns) saveBtns.style.display = 'none';
        
        this.loadDescriptions();
        
        const accSelect = document.getElementById('importAccountSelect');
        if (accSelect) {
            accSelect.innerHTML = '<option value="">-- Aucun compte sélectionné --</option>';
            if (window.app && window.app.accounts) {
                window.app.accounts.filter(a => !a.is_closed).forEach(acc => {
                    const opt = document.createElement('option');
                    opt.value = acc.id;
                    opt.textContent = acc.name;
                    accSelect.appendChild(opt);
                });
            }
        }
        
        document.getElementById('importDataModal').style.display = 'flex';
        event.target.value = ''; // reset
    },

    async analyzeHeuristic() {
        if (!this.selectedFile) return;
        
        const formData = new FormData();
        formData.append("file", this.selectedFile);
        
        document.getElementById('importDataDesc').textContent = "Analyse en cours...";
        
        try {
            const res = await fetch('/api/csv/analyze_heuristic', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (res.ok) {
                this.fileBalance = result.file_balance || null;
                await this.renderImportTable(result.transactions || []);
            } else {
                document.getElementById('importDataDesc').textContent = "Erreur: " + result.detail;
            }
        } catch (e) {
            console.error(e);
            document.getElementById('importDataDesc').textContent = "Erreur réseau.";
        }
    },
    
    async analyzeAI() {
        if (!this.selectedFile) return;
        
        const formData = new FormData();
        formData.append("file", this.selectedFile);
        
        document.getElementById('importDataDesc').textContent = "Analyse IA en cours (cela peut prendre du temps)...";
        
        try {
            const res = await fetch('/api/ai/import_csv', { 
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (res.ok) {
                this.fileBalance = result.file_balance || null;
                await this.renderImportTable(result.transactions || []);
            } else {
                document.getElementById('importDataDesc').textContent = "Erreur IA: " + result.detail;
            }
        } catch (e) {
            console.error(e);
            document.getElementById('importDataDesc').textContent = "Erreur réseau IA.";
        }
    },

    async renderImportTable(txs) {
        if (!window.app.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (e) {
                console.error("Failed to load categories", e);
                window.app.categoriesList = [];
            }
        }
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) {
            summaryDiv.style.display = 'block';
            summaryDiv.textContent = `Analyse terminée : ${txs.length} opération(s) trouvée(s). Vous pouvez modifier les valeurs avant validation.`;
        }
        document.getElementById('importDataDesc').style.display = 'none';
        document.getElementById('importDataTable').style.display = 'table';
        document.getElementById('btnSaveImport').style.display = 'inline-block';
        
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'none';
        const saveBtns = document.getElementById('importSaveButtons');
        if (saveBtns) saveBtns.style.display = 'flex';
        
        const btnCatAll = document.getElementById('btnCategorizeAllAI');
        if (btnCatAll) {
            if (window.app.config && window.app.config.enable_ai === 'true') {
                btnCatAll.style.display = 'flex';
            } else {
                btnCatAll.style.display = 'none';
            }
        }
        
        const cfg = window.app && window.app.config ? window.app.config : {};
        const enableAttach = cfg.enable_attachments === 'true';
        let hasAttachments = enableAttach && txs.some(tx => tx.attachments);
        let attachmentsCheckHtml = '';
        if (hasAttachments) {
            attachmentsCheckHtml = `
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
                    <input type="checkbox" id="importAttachmentsCheck" checked style="cursor: pointer;">
                    <label for="importAttachmentsCheck" style="cursor: pointer; color: var(--text-color);">Importer les pièces jointes (colonnes Fichier / Documents joints)</label>
                </div>
            `;
        }
        
        if (summaryDiv) {
            summaryDiv.style.display = 'block';
            summaryDiv.innerHTML = `Analyse terminée : ${txs.length} opération(s) trouvée(s). Vous pouvez modifier les valeurs avant validation.${attachmentsCheckHtml}`;
        }
        
        const tbody = document.getElementById('importDataBody');
        tbody.innerHTML = '';
        
        // Reset scroll to top so the first row is always visible
        const tableContainer = document.getElementById('importTableContainer');
        if (tableContainer) tableContainer.scrollTop = 0;
        
        console.log(`[ImportWizard] Rendering ${txs.length} transactions. First:`, txs[0]);
        
        txs.forEach((tx, i) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;
            
            let statusHtml = '';
            let actionText = '';
            let actionColor = '';
            
            if (isRec && alreadyRec) {
                statusHtml = `<span class="badge" style="background:var(--bg-surface);color:var(--text-muted);border:1px solid var(--border-color);">Déjà rapproché</span>`;
                actionText = `Ignorée<br>(déjà traitée)`;
                actionColor = `color: var(--text-muted);`;
            } else if (isRec && !alreadyRec) {
                statusHtml = `<span class="badge" style="background:var(--color-income);color:white;">À rapprocher</span>`;
                actionText = `Sera rapprochée<br>(pas de doublon)`;
                actionColor = `color: var(--color-income);`;
            } else {
                statusHtml = `<span class="badge" style="background:var(--color-expense);color:white;">Nouveau</span>`;
                actionText = `Sera ajoutée`;
                actionColor = `color: var(--color-expense);`;
            }
            
            const dbDescValue = (tx.db_description || '').replace(/"/g, '&quot;');
            const mappedDescValue = (tx.description || tx.db_description || '').replace(/"/g, '&quot;');
            
            const rawDescHtml = dbDescValue ? `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px; white-space: pre-wrap; line-height: 1.2;">${dbDescValue}</div>` : '';
            
            const descInputStr = isRec ? 
                `${rawDescHtml}<input type="text" class="import-desc inline-input" value="${mappedDescValue}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 5px; color: var(--text-muted);" readonly title="Existant en DB">` : 
                `${rawDescHtml}<input type="text" class="import-desc inline-input" value="${mappedDescValue}" list="importDescList" oninput="window.ImportWizard.onDescriptionInput(this)" style="width: 100%; border: 1px solid var(--border-color); padding: 5px;">`;
                
            let catInputStr = '';
            if (!isRec) {
                let options = `<option value="">-- Catégorie --</option>`;
                (window.app.categoriesList || []).forEach(cat => {
                    if (!cat.is_closed) {
                        options += `<option value="${cat.name.replace(/"/g, '&quot;')}">${cat.name}</option>`;
                    }
                });
                
                const aiBtnHtml = (window.app.config && window.app.config.enable_ai === 'true') ? 
                    `<button class="btn btn-secondary" onclick="window.ImportWizard.categorizeRow(this)" style="padding: 4px; border: none; background: transparent; cursor: pointer;" title="Catégoriser avec l'IA">🧠</button>` : '';
                    
                catInputStr = `
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <select class="import-cat inline-input" style="width: 100%; border: 1px solid var(--border-color); padding: 5px;">
                            ${options}
                        </select>
                        ${aiBtnHtml}
                    </div>
                `;
            } else {
                catInputStr = `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">Déjà en base</span><input type="hidden" class="import-cat" value="">`;
            }
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border-bottom: 1px solid var(--border-color);">
                    <input type="date" class="import-date inline-input" value="${tx.date_operation || tx.date}" style="width: 130px; border: 1px solid var(--border-color); padding: 5px;">
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    ${descInputStr}
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    ${catInputStr}
                </td>
                <td style="border-bottom: 1px solid var(--border-color); text-align: right;">
                    <input type="number" step="0.01" class="import-amt inline-input" value="${tx.amount || 0}" style="width: 80px; text-align:right; border: 1px solid var(--border-color); padding: 5px;">
                </td>
                <td style="border-bottom: 1px solid var(--border-color); text-align: center;">
                    ${statusHtml}
                    <input type="hidden" class="import-reconciled" value="${isRec ? 'true' : 'false'}">
                    <input type="hidden" class="import-already-rec" value="${alreadyRec ? 'true' : 'false'}">
                    <input type="hidden" class="import-matched-id" value="${tx.matched_db_id || ''}">
                    <input type="hidden" class="import-attachments" value="${tx.attachments ? tx.attachments.replace(/"/g, '&quot;') : ''}">
                    <input type="hidden" class="import-check" value="${tx.check_slip_number ? tx.check_slip_number.replace(/"/g, '&quot;') : ''}">
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 12px;">
                        <div style="font-size: 11px; text-align: right; line-height: 1.2; ${actionColor}">
                            ${actionText}
                        </div>
                        <button class="btn btn-danger" style="padding: 6px 10px; font-size: 14px; font-weight: bold; color: white;" onclick="this.closest('tr').remove(); window.ImportWizard.updateImportSummary();" title="Ignorer cette ligne">✕</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        this.updateImportSummary();
    },
    
    updateImportSummary() {
        const rows = document.querySelectorAll('#importDataBody tr');
        let newCount = 0;
        let recCount = 0;
        let ignoredCount = 0;
        
        rows.forEach(tr => {
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const alreadyRec = tr.querySelector('.import-already-rec').value === 'true';
            
            if (isRec && alreadyRec) {
                ignoredCount++;
            } else if (isRec) {
                recCount++;
            } else {
                newCount++;
            }
        });
        
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) {
            summaryDiv.style.display = rows.length > 0 ? 'block' : 'none';
            let summaryHtml = `<strong style="font-size: 14px; margin-bottom: 8px; display: block;">Si vous validez cet import :</strong><ul style="margin: 0 0 0 20px; padding: 0; line-height: 1.6;">`;
            
            if (newCount > 0) {
                summaryHtml += `<li><span style="color: var(--color-expense); font-weight: bold;">${newCount} opération(s)</span> seront ajoutées comme <strong>nouvelles</strong>.</li>`;
            } else {
                summaryHtml += `<li><span style="color: var(--text-muted);">Aucune nouvelle opération ne sera ajoutée.</span></li>`;
            }
            
            if (recCount > 0) {
                summaryHtml += `<li><span style="color: var(--color-income); font-weight: bold;">${recCount} opération(s)</span> seront <strong>rapprochées</strong> (marquées comme validées). <em>Aucun doublon.</em></li>`;
            }
            
            if (ignoredCount > 0) {
                summaryHtml += `<li><span style="color: var(--text-muted); font-weight: bold;">${ignoredCount} opération(s)</span> seront <strong>ignorées</strong> (déjà rapprochées).</li>`;
            }
            
            summaryHtml += `</ul>`;
            summaryDiv.innerHTML = summaryHtml;
        }
        
        this.updateBalanceVerification();
    },
    
    updateBalanceVerification() {
        const box = document.getElementById('balanceVerificationBox');
        if (!box) return;
        
        const accountId = document.getElementById('importAccountSelect')?.value;
        if (!accountId) {
            box.style.display = 'none';
            return;
        }
        
        const account = window.app.accounts.find(a => a.id == accountId);
        if (!account) return;
        
        const rows = document.querySelectorAll('#importDataBody tr');
        let newAmountSum = 0;
        
        rows.forEach(tr => {
            const alreadyRec = tr.querySelector('.import-already-rec').value === 'true';
            
            // The `account.balance` only includes transactions that are ALREADY reconciled in the DB.
            // If the user hits Save, any transaction in this list that is NOT `alreadyRec` 
            // (meaning it's either a NEW transaction, or a PENDING transaction being reconciled)
            // will now be part of the reconciled balance.
            if (!alreadyRec) {
                const amt = parseFloat(tr.querySelector('.import-amt').value) || 0;
                newAmountSum += amt;
            }
        });
        
        const finalDbBalance = account.balance + newAmountSum;
        
        box.style.display = 'block';
        if (this.fileBalance === null) {
            box.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            box.style.borderColor = 'var(--border-color)';
            box.innerHTML = `<strong>ℹ️ Information de solde</strong><br>Le fichier ne contient pas de solde pour vérification.<br>Solde calculé après import : <strong>${formatCurrency(finalDbBalance)}</strong>`;
        } else {
            const diff = Math.abs(finalDbBalance - this.fileBalance);
            if (diff < 0.05) {
                box.style.backgroundColor = 'rgba(46, 204, 113, 0.1)';
                box.style.borderColor = 'rgba(46, 204, 113, 0.5)';
                box.innerHTML = `<strong style="color: #2ecc71;">✅ Le solde correspond</strong><br>Solde trouvé dans le fichier : <strong>${formatCurrency(this.fileBalance)}</strong><br>Le compte sera bien à jour après import.`;
            } else {
                box.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                box.style.borderColor = 'rgba(231, 76, 60, 0.5)';
                box.innerHTML = `<strong style="color: #e74c3c;">⚠️ Écart de solde détecté</strong><br>Solde du fichier : <strong>${formatCurrency(this.fileBalance)}</strong><br>Solde calculé après import : <strong>${formatCurrency(finalDbBalance)}</strong><br>Écart : <strong>${formatCurrency(diff)}</strong>`;
            }
        }
    },
    
    async categorizeRow(btn) {
        const tr = btn.closest('tr');
        const desc = tr.querySelector('.import-desc').value;
        const select = tr.querySelector('.import-cat');
        
        if (!desc) return;
        
        btn.innerHTML = '⏳';
        btn.disabled = true;
        
        try {
            const res = await API.post('/api/ai/categorize', { description: desc });
            if (res.category) {
                select.value = res.category;
            }
        } catch (e) {
            console.error("Erreur IA", e);
        } finally {
            btn.innerHTML = '🧠';
            btn.disabled = false;
        }
    },
    
    async categorizeAllNew() {
        const rows = Array.from(document.querySelectorAll('#importDataBody tr')).filter(tr => {
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const catSelect = tr.querySelector('.import-cat');
            return !isRec && catSelect && !catSelect.value;
        });
        
        if (rows.length === 0) {
            showInlineMessage("Info", "Toutes les nouvelles opérations sont déjà catégorisées.");
            return;
        }
        
        const btnAll = document.getElementById('btnCategorizeAllAI');
        const originalHtml = btnAll.innerHTML;
        btnAll.innerHTML = '<span style="font-size: 14px;">⏳</span> Traitement...';
        btnAll.disabled = true;
        
        const descriptions = rows.map(tr => tr.querySelector('.import-desc').value);
        
        try {
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res.categories) {
                rows.forEach(tr => {
                    const desc = tr.querySelector('.import-desc').value;
                    const cat = res.categories[desc];
                    if (cat) {
                        const sel = tr.querySelector('.import-cat');
                        if (sel) sel.value = cat;
                    }
                });
            }
        } catch (e) {
            console.error("Erreur IA Batch", e);
            showInlineMessage("Erreur", "L'IA a échoué.");
        } finally {
            btnAll.innerHTML = originalHtml;
            btnAll.disabled = false;
        }
    },

    async saveImport() {
        const rows = document.querySelectorAll('#importDataBody tr');
        const txs = [];
        rows.forEach(tr => {
            const date = tr.querySelector('.import-date').value;
            const desc = tr.querySelector('.import-desc').value;
            const amt = parseFloat(tr.querySelector('.import-amt').value);
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const matchId = tr.querySelector('.import-matched-id').value;
            const attachments = tr.querySelector('.import-attachments').value;
            const check = tr.querySelector('.import-check').value;
            const catSelect = tr.querySelector('.import-cat');
            const cat = catSelect ? catSelect.value : null;
            
            if (date && !isNaN(amt)) {
                txs.push({
                    date_operation: date,
                    description: desc,
                    category: cat || null,
                    amount: amt,
                    is_reconciled: isRec,
                    matched_db_id: matchId,
                    attachments: attachments || null,
                    check_slip_number: check || null
                });
            }
        });
        
        if (txs.length === 0) {
            showInlineMessage("Info", "Aucune transaction à importer.");
            return;
        }
        
        const accountId = document.getElementById('importAccountSelect')?.value || null;
        if (!accountId) {
            showInlineMessage("Erreur", "Veuillez sélectionner un compte bancaire avant de valider l'import.");
            return;
        }
        
        const importAttachments = document.getElementById('importAttachmentsCheck')?.checked;
        const txsWithAttachments = txs.filter(t => t.attachments);
        
        if (importAttachments && txsWithAttachments.length > 0) {
            showInlineMessage("Info", "Veuillez sélectionner le dossier contenant les pièces jointes.");
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.onchange = async (e) => {
                if (!e.target.files.length) {
                    this.finalizeSave(txs, accountId);
                    return;
                }
                const files = Array.from(e.target.files);
                const formData = new FormData();
                const paths = [];
                
                for (const tx of txsWithAttachments) {
                    const expectedName = tx.attachments.replace(/\\/g, '/').split('/').pop();
                    const matchedFile = files.find(f => f.name === expectedName || f.webkitRelativePath.endsWith(expectedName));
                    if (matchedFile) {
                        formData.append("files", matchedFile);
                        paths.push(tx.attachments);
                    }
                }
                
                if (paths.length > 0) {
                    formData.append("relative_paths", JSON.stringify(paths));
                    try {
                        document.getElementById('importDataDesc').textContent = "Upload des pièces jointes...";
                        document.getElementById('importDataDesc').style.display = 'block';
                        const res = await fetch('/api/csv/upload_attachments', {
                            method: 'POST',
                            body: formData
                        });
                        const data = await res.json();
                        if (data.saved) {
                            txs.forEach(t => {
                                if (t.attachments && data.saved[t.attachments]) {
                                    t.attachments = data.saved[t.attachments];
                                } else if (t.attachments) {
                                    t.attachments = null;
                                }
                            });
                        }
                    } catch(err) {
                        console.error("Erreur upload", err);
                    }
                }
                this.finalizeSave(txs, accountId);
            };
            input.click();
            return;
        }
        
        this.finalizeSave(txs, accountId);
    },
    
    async finalizeSave(txs, accountId) {
        try {
            const res = await API.post('/api/csv/save_batch', { transactions: txs, account_id: accountId });
            showInlineMessage("Info", `Import réussi ! ${res.imported} opérations traitées.`);
            document.getElementById('importDataModal').style.display = 'none';
            window.location.reload();
        } catch (e) {
            console.error(e);
            showInlineMessage("Info", "Erreur lors de la sauvegarde.");
        }
    }
};
