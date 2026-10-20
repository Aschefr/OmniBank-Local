// static/js/views/chat/chat_renderer.js — Moteur de rendu des messages (Markdown, KaTeX, Bulles & Historique)
window.ChatView = Object.assign(window.ChatView || {}, {
    formatMessageContent(msg) {
        const isUser = msg.role === 'user';
        let displayContent = msg.content;
        let suggestions = [];
        
        if (!isUser && window.marked && window.DOMPurify) {
            let rawContent = msg.content || '';
            let actions = [];

            // Automatically clean and unwrap legacy or raw AI report JSON blocks into pure Markdown
            if (rawContent.includes('"detailed_analysis"') || (rawContent.includes('"summary"') && rawContent.includes('{'))) {
                const detMatch = rawContent.match(/"detailed_analysis"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                const sumMatch = rawContent.match(/"summary"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                let extractedMd = '';
                if (detMatch && detMatch[1]) {
                    extractedMd = detMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                } else if (sumMatch && sumMatch[1]) {
                    extractedMd = sumMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                }
                if (extractedMd) {
                    // Dedent lines so leading spaces don't trigger Markdown indented code blocks (<pre>)
                    extractedMd = extractedMd.split('\n').map(line => line.trimStart()).join('\n');
                    // Replace the full codeblock or the JSON object with the extracted clean Markdown
                    rawContent = rawContent.replace(/```(?:json)?[\s\S]*?(?:```|$)/g, extractedMd);
                    rawContent = rawContent.replace(/\{[\s\S]*"summary"[\s\S]*\}/g, extractedMd);
                }
            }

            // Strip literal \n if present in raw string
            rawContent = rawContent.replace(/\\n/g, '\n');

            // Strip TOOLS_USED comment (badges are rendered in renderHistory meta-row)
            rawContent = rawContent.replace(/<!--\s*TOOLS_USED:\s*[^>]+?\s*-->\n?/, '');

            // Extract suggestions from ```suggestions ... ``` or ```suggest ... ``` blocks
            rawContent = rawContent.replace(/```(?:suggestions?|questions?|suggest)\s*([\s\S]*?)\s*```/g, (match, block) => {
                const trimmed = block.trim();
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed)) {
                            for (const item of parsed) {
                                if (typeof item === 'string' && item.trim().length > 2) {
                                    suggestions.push(item.trim());
                                }
                            }
                            return '';
                        }
                    } catch(e) {}
                }
                const lines = trimmed.split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 0)
                    .map(l => l.replace(/^[-*•\d.]+\s*/, '').replace(/^["']|["']$/g, '').trim())
                    .filter(l => l.length > 2);
                suggestions.push(...lines);
                return '';
            });

            // Robust multi-pass action extractor (supports code-fenced blocks and balanced inline JSON with nested objects)
            // 1. First, extract actions from ```action ... ``` or ```json ... ``` blocks
            rawContent = rawContent.replace(/```(?:action|json)?\s*([\s\S]*?)\s*```/g, (match, code) => {
                const trimmed = code.trim();
                if (trimmed.startsWith('{') && (trimmed.includes('"action"') || trimmed.includes('"id"'))) {
                    try {
                        let sanitized = trimmed.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, strVal) => {
                            return '"' + strVal.replace(/\r?\n/g, ' ').trim() + '"';
                        });
                        const parsed = JSON.parse(sanitized);
                        if (parsed && (parsed.action || parsed.id !== undefined)) {
                            actions.push(parsed);
                            return '';
                        }
                    } catch(e) {}
                }
                return match;
            });

            // Clean up any stray backtick wrappers
            rawContent = rawContent.replace(/```(?:action|json)?\s*\n?/g, '').replace(/\n?\s*```/g, '');

            // 2. Scan for inline JSON objects starting with {"action" or {"id" with balanced braces
            let scanIdx = 0;
            while (scanIdx < rawContent.length) {
                const matchPos = rawContent.slice(scanIdx).search(/\{\s*"(?:action|id)"\s*:/);
                if (matchPos === -1) break;

                const startIdx = scanIdx + matchPos;
                let depth = 0;
                let inStr = false;
                let escape = false;
                let endIdx = -1;

                for (let j = startIdx; j < rawContent.length; j++) {
                    const ch = rawContent[j];
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (ch === '\\') {
                        escape = true;
                        continue;
                    }
                    if (ch === '"') {
                        inStr = !inStr;
                        continue;
                    }
                    if (!inStr) {
                        if (ch === '{') depth++;
                        else if (ch === '}') {
                            depth--;
                            if (depth === 0) {
                                endIdx = j;
                                break;
                            }
                        }
                    }
                }

                if (endIdx !== -1) {
                    const candidate = rawContent.slice(startIdx, endIdx + 1);
                    try {
                        let sanitized = candidate.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m, strVal) => {
                            return '"' + strVal.replace(/\r?\n/g, ' ').trim() + '"';
                        });
                        const parsed = JSON.parse(sanitized);
                        if (parsed && (parsed.action || parsed.id !== undefined)) {
                            actions.push(parsed);
                            rawContent = rawContent.slice(0, startIdx) + rawContent.slice(endIdx + 1);
                            scanIdx = startIdx;
                            continue;
                        }
                    } catch (e) {}
                }
                scanIdx = startIdx + 1;
            }

            // Normalize actions list (delete_transaction vs apply_transaction_correction)
            for (let k = 0; k < actions.length; k++) {
                let act = actions[k];
                if (act.id !== undefined && !act.action) {
                    if (!act.updates || Object.keys(act.updates).length === 0) {
                        actions[k] = {
                            action: 'delete_transaction',
                            params: { transaction_id: act.id }
                        };
                    } else {
                        actions[k] = {
                            action: 'apply_transaction_correction',
                            params: { transaction_id: act.id, ...act.updates }
                        };
                    }
                } else if (act.action === 'apply_transaction_correction' && act.params) {
                    const p = act.params;
                    if (p.updates && typeof p.updates === 'object') {
                        if (p.updates.category && !p.category) p.category = p.updates.category;
                        if (p.updates.description && !p.description) p.description = p.updates.description;
                        if (p.updates.amount !== undefined && p.amount === undefined) p.amount = p.updates.amount;
                        if (p.updates.type && !p.type) p.type = p.updates.type;
                    }
                    if (p.category && typeof p.category === 'string') {
                        p.category = p.category.replace(/[\r\n]+/g, ' ').trim();
                    }
                    if (p.description && typeof p.description === 'string') {
                        p.description = p.description.replace(/[\r\n]+/g, ' ').trim();
                    }
                }
            }

            // Normalize legacy or raw placeholders if any
            rawContent = rawContent
                .replace(/___THINK_START___/g, '<think>')
                .replace(/___THINK_END(?:_ACTIVE)?___/g, '</think>');

            let thinkHtml = '';
            if (rawContent.includes('<think>')) {
                const thinkMatch = rawContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
                if (thinkMatch) {
                    const thinkContent = thinkMatch[1].trim();
                    const isOpenThink = !rawContent.includes('</think>');
                    const defaultInProgress = '🧠 Réflexion en cours...';
                    const defaultPhase = '🧠 Phase de réflexion';
                    const thinkTitle = isOpenThink 
                        ? (window.i18n ? (window.i18n.t('chat_thinking_in_progress') || defaultInProgress) : defaultInProgress)
                        : (window.i18n ? (window.i18n.t('chat_thinking_phase') || defaultPhase) : defaultPhase);
                    const openAttr = isOpenThink ? "open" : "";
                    
                    if (thinkContent) {
                        const parsedThinkContent = DOMPurify.sanitize(marked.parse(thinkContent));
                        thinkHtml = `<details class="ai-think-details" ${openAttr}><summary class="ai-think-summary"><span>${thinkTitle}</span></summary><div class="ai-think-content">${parsedThinkContent}</div></details>`;
                    }
                    rawContent = rawContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trimStart();
                }
            }

            // Check if this content is a standard connection or stream error
            if (rawContent.includes('**Erreur:**') || (rawContent.startsWith('*') && rawContent.endsWith('*') && rawContent.includes('Erreur')) || rawContent.startsWith('⚠️')) {
                let cleanErr = rawContent.replace(/\*\*Erreur:\*\*/g, '').replace(/^\*/, '').replace(/\*$/, '').replace(/⚠️/g, '').trim();
                const failedTitle = window.i18n ? window.i18n.t('chat_request_failed') : 'Échec de la requête';
                displayContent = `
                    <div class="ai-error-box" style="padding: 12px 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: #ef4444; display: flex; align-items: start; gap: 10px;">
                        <span style="font-size: 18px; line-height: 1;">⚠️</span>
                        <div style="flex: 1;">
                           <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;" data-i18n="chat_request_failed">${failedTitle}</div>
                           <div style="font-size: 12px; opacity: 0.9;">${cleanErr}</div>
                        </div>
                    </div>
                `;
            } else {
                displayContent = DOMPurify.sanitize(marked.parse(rawContent));
                
                // Wrap markdown tables for responsive scrolling & beautiful styling
                displayContent = displayContent.replace(/<table>([\s\S]*?)<\/table>/g, '<div class="chat-table-wrapper"><table class="chat-markdown-table">$1</table></div>');

                // Smart fallback: extract closing questions ending with '?' if no explicit suggestions block
                if (suggestions.length === 0) {
                    const textWithoutCode = rawContent
                        .replace(/```[\s\S]*?```/g, '')
                        .trim();
                    const paragraphs = textWithoutCode.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
                    if (paragraphs.length > 0) {
                        const trailingText = paragraphs.slice(-2).join('\n\n');
                        const questionRegex = /(?:(?:Souhaitez|Voulez|Préférez)-vous|Est-ce que vous souhaitez|Désirez-vous|Do you want(?: me)? to|Would you like(?: me)? to)\s+([^?]+)\?/gi;
                        let qMatch;
                        while ((qMatch = questionRegex.exec(trailingText)) !== null) {
                            const fullQ = qMatch[0].trim();
                            let cleanAction = fullQ.replace(/\*\*/g, '').trim();
                            if (/^souhaitez-vous que nous\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^souhaitez-vous que nous\s+/i, 'Oui, regardons ');
                            } else if (/^souhaitez-vous que je\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^souhaitez-vous que je\s+/i, 'Oui, faites ');
                            } else if (/^souhaitez-vous qu'on\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^souhaitez-vous qu'on\s+/i, 'Oui, regardons ');
                            } else if (/^souhaitez-vous\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^souhaitez-vous\s+/i, 'Oui, ');
                            } else if (/^voulez-vous que (?:nous|on)\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^voulez-vous que (?:nous|on)\s+/i, 'Oui, regardons ');
                            } else if (/^voulez-vous que je\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^voulez-vous que je\s+/i, 'Oui, faites ');
                            } else if (/^voulez-vous\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^voulez-vous\s+/i, 'Oui, ');
                            } else if (/^désirez-vous\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^désirez-vous\s+/i, 'Oui, ');
                            } else if (/^do you want(?: me)? to\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^do you want(?: me)? to\s+/i, 'Yes, please ');
                            } else if (/^would you like(?: me)? to\s+/i.test(cleanAction)) {
                                cleanAction = cleanAction.replace(/^would you like(?: me)? to\s+/i, 'Yes, please ');
                            }
                            cleanAction = cleanAction.replace(/\s*\?$/, '').trim();
                            suggestions.push({
                                label: cleanAction,
                                prompt: cleanAction
                            });
                        }
                    }
                }

                if (thinkHtml) {
                    displayContent = thinkHtml + displayContent;
                }

                for (let actionIdx = 0; actionIdx < actions.length; actionIdx++) {
                    const actionObj = actions[actionIdx];
                    const msgKey = (msg && msg.id) ? `msg_${msg.id}` : 'temp';
                    const actionId = `act_${msgKey}_${actionIdx}`;
                    actionObj._actionId = actionId;
                    actionObj._messageId = (msg && msg.id) ? msg.id : null;
                    this.pendingActions[actionId] = actionObj;

                    const isApplied = !!(msg && Array.isArray(msg.applied_actions) && msg.applied_actions.includes(actionId));

                    if (actionObj.id !== undefined) {
                        this.pendingActions[actionObj.id] = actionObj;
                        if (isApplied) {
                            displayContent += `
                                <div class="ai-action-box ai-action-box-applied" style="margin-top: 15px; padding: 15px; background: rgba(40, 167, 69, 0.08); border: 1px solid rgba(40, 167, 69, 0.4); border-radius: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <div style="font-weight: 600; color: var(--success, #28a745);">${window.i18n.t('chat_ai_recommendation')}</div>
                                        <span style="font-size: 11px; font-weight: 600; color: var(--success, #28a745); background: rgba(40, 167, 69, 0.15); padding: 2px 8px; border-radius: 4px;">✓ ${window.i18n.t('chat_action_already_applied') || 'Appliquée'}</span>
                                    </div>
                                    <div style="font-size: 12px; margin-bottom: 4px; color: var(--text-muted);">${window.i18n.t('chat_ai_propose_modify')} #${actionObj.id}.</div>
                                    <div style="font-size: 11px; color: var(--success, #28a745); font-weight: 500;">✓ ${window.i18n.t('chat_action_applied_feedback') || 'Cette action a déjà été exécutée et enregistrée en base.'}</div>
                                </div>
                            `;
                        } else {
                            displayContent += `
                                <div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                                    <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                                    <div style="font-size: 12px; margin-bottom: 12px;">${window.i18n.t('chat_ai_propose_modify')} #${actionObj.id}.</div>
                                    <button class="btn btn-primary" data-action-id="${actionId}" style="padding: 6px 12px; font-size: 12px;">${window.i18n.t('chat_btn_review')}</button>
                                </div>
                            `;
                        }
                    } else if (actionObj.action !== undefined) {
                        let desc = window.i18n.tp('chat_action_generic_propose', { action: actionObj.action });
                        if (actionObj.action === 'create_budget_envelope') {
                            desc = window.i18n.tp('chat_action_propose_create_budget', { name: actionObj.params.name, amount: actionObj.params.monthly_amount });
                        } else if (actionObj.action === 'update_budget_envelope') {
                            desc = window.i18n.tp('chat_action_propose_update_budget', { name: actionObj.params.name || actionObj.params.budget_id });
                        } else if (actionObj.action === 'delete_budget_envelope') {
                            desc = window.i18n.tp('chat_action_propose_delete_budget', { id: actionObj.params.budget_id });
                        } else if (actionObj.action === 'allocate_savings_funds') {
                            const actKey = actionObj.params.amount >= 0 ? 'chat_action_propose_allocate_savings_action_deposit' : 'chat_action_propose_allocate_savings_action_withdraw';
                            const actName = window.i18n.t(actKey);
                            desc = window.i18n.tp('chat_action_propose_allocate_savings', { action: actName, amount: Math.abs(actionObj.params.amount), id: actionObj.params.budget_id });
                        } else if (actionObj.action === 'create_recurrence_template') {
                            desc = window.i18n.tp('chat_action_propose_create_recurrence', { desc: actionObj.params.description, amount: actionObj.params.amount });
                        } else if (actionObj.action === 'update_recurrence_template') {
                            const recName = actionObj.params.description ? `"${actionObj.params.description}"` : ('#' + (actionObj.params.template_id || ''));
                            if (actionObj.params.is_active === true) {
                                desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_reactivate_recurrence', { desc: recName }) : `Réactivation de la charge récurrente ${recName}`;
                            } else if (actionObj.params.is_active === false) {
                                desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_deactivate_recurrence', { desc: recName }) : `Désactivation de la charge récurrente ${recName}`;
                            } else {
                                desc = window.i18n.tp('chat_action_propose_update_recurrence', { desc: recName });
                            }
                        } else if (actionObj.action === 'close_recurrence_template') {
                            const recName = actionObj.params.description ? `"${actionObj.params.description}"` : ('#' + (actionObj.params.template_id || ''));
                            desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_close_recurrence', { desc: recName }) : `Clôture de la charge récurrente ${recName} : arrêt des échéances futures et conservation de l'historique`;
                        } else if (actionObj.action === 'delete_recurrence_template') {
                            const recName = actionObj.params.description ? `"${actionObj.params.description}"` : ('#' + (actionObj.params.template_id || ''));
                            desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_delete_recurrence_def', { desc: recName }) : `Suppression définitive de la charge récurrente ${recName}`;
                        } else if (actionObj.action === 'create_category') {
                            desc = window.i18n.tp('chat_action_propose_create_category', { name: actionObj.params.name });
                        } else if (actionObj.action === 'delete_category') {
                            desc = window.i18n.tp('chat_action_propose_delete_category', { name: actionObj.params.name });
                        } else if (actionObj.action === 'set_predicted_paycheck') {
                            desc = window.i18n.tp('chat_action_propose_set_paycheck', { amount: actionObj.params.amount, day: actionObj.params.day_of_month });
                        } else if (actionObj.action === 'delete_transaction') {
                            desc = window.i18n.tp('chat_action_propose_delete_transaction', { id: actionObj.params.transaction_id });
                        } else if (actionObj.action === 'apply_transaction_correction') {
                            const txId = actionObj.params.transaction_id || actionObj.params.id;
                            const parts = [];
                            if (actionObj.params.category) parts.push(`${window.i18n.t('field_label_category') || 'Catégorie'} : ${actionObj.params.category}`);
                            if (actionObj.params.description) parts.push(`${window.i18n.t('field_label_description') || 'Libellé'} : ${actionObj.params.description}`);
                            if (actionObj.params.amount !== undefined) parts.push(`${window.i18n.t('field_label_amount') || 'Montant'} : ${actionObj.params.amount} €`);
                            const fieldsStr = parts.join(', ');
                            desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_apply_correction', { id: txId, fields: fieldsStr }) : `Correction de l'opération #${txId} (${fieldsStr})`;
                        } else if (actionObj.action === 'create_planned_transfer') {
                            const fromA = actionObj.params.from_account || 'Compte source';
                            const toA = actionObj.params.to_account || 'Compte destination';
                            const amt = actionObj.params.amount !== undefined ? `${actionObj.params.amount} €` : '';
                            desc = window.i18n.tp ? window.i18n.tp('chat_action_propose_create_transfer', { amount: amt, from: fromA, to: toA }) : `Enregistrement d'un virement prévisionnel de ${amt} (${fromA} ➔ ${toA})`;
                        } else if (actionObj.action === 'trigger_bank_sync') {
                            desc = window.i18n.t('chat_action_propose_sync_bank') || `Lancement d'une synchronisation et d'un relevé bancaire en ligne (rapprochement Auto-Pilote)`;
                        }

                        let btnIcon = '';
                        let btnLabel = window.i18n.t('chat_btn_review_generic');
                        if (actionObj.action === 'trigger_bank_sync') {
                            btnIcon = '<span style="margin-right: 4px;">🏦</span>';
                            btnLabel = window.i18n.t('chat_btn_sync_now') || 'Synchroniser maintenant';
                        }

                        if (isApplied) {
                            displayContent += `
                                <div class="ai-action-box ai-action-box-applied" style="margin-top: 15px; padding: 15px; background: rgba(40, 167, 69, 0.08); border: 1px solid rgba(40, 167, 69, 0.4); border-radius: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <div style="font-weight: 600; color: var(--success, #28a745);">${window.i18n.t('chat_ai_recommendation')}</div>
                                        <span style="font-size: 11px; font-weight: 600; color: var(--success, #28a745); background: rgba(40, 167, 69, 0.15); padding: 2px 8px; border-radius: 4px;">✓ ${window.i18n.t('chat_action_already_applied') || 'Appliquée'}</span>
                                    </div>
                                    <div style="font-size: 12px; margin-bottom: 4px; color: var(--text-muted);">${desc}.</div>
                                    <div style="font-size: 11px; color: var(--success, #28a745); font-weight: 500;">✓ ${window.i18n.t('chat_action_applied_feedback') || 'Cette action a déjà été exécutée et enregistrée en base.'}</div>
                                </div>
                            `;
                        } else {
                            displayContent += `
                                <div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                                    <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                                    <div style="font-size: 12px; margin-bottom: 12px;">${desc}.</div>
                                    <button class="btn btn-primary" data-action-id="${actionId}" style="padding: 6px 12px; font-size: 12px;">${btnIcon}${btnLabel}</button>
                                </div>
                            `;
                        }
                    }
                }

                // Check if assistant promised an action in text but no action card was emitted
                // IMPORTANT: Never display the recovery button while streaming or on unpersisted messages.
                // The AI often outputs the action block at the end of its response, or the backend auto-recovers it upon completion.
                const isStreamingMsg = !!(this.isStreaming || this._streamReader || window.ChatView?.isStreaming || window.ChatView?._streamReader || (msg && msg._streaming));
                const hasValidPersistedId = !!(msg && msg.id && typeof msg.id === 'number' && msg.id > 0);
                const wasStoppedByUser = rawContent.includes('🛑');

                if (!isStreamingMsg && hasValidPersistedId && !wasStoppedByUser && actions.length === 0 && this._hasPromisedAction(rawContent)) {
                    const msgId = msg.id;
                    const recTitle = window.i18n ? window.i18n.t('chat_missing_action_title') : "Action proposée non générée";
                    const recDesc = window.i18n ? window.i18n.t('chat_missing_action_desc') : "L'assistant a mentionné préparer une opération mais la carte d'action ne s'est pas affichée.";
                    const recBtn = window.i18n ? window.i18n.t('chat_btn_recover_action') : "Générer les cartes d'actions";
                    displayContent += `
                        <div class="ai-missing-action-box" id="missing-action-${msgId}">
                            <div class="ai-missing-action-info">
                                <span class="ai-missing-action-icon">💡</span>
                                <div class="ai-missing-action-text">
                                    <strong>${recTitle}</strong><br>
                                    <span>${recDesc}</span>
                                </div>
                            </div>
                            <button class="ai-btn-recover-action" onclick="window.ChatView.recoverActionsForMessage(${msgId}, this)">
                                <span>🪄</span>
                                <span>${recBtn}</span>
                            </button>
                        </div>
                    `;
                }
            }
        } else if (isUser) {
            displayContent = window.escapeHtml(displayContent);
        }

        if (!isUser) {
            displayContent = this.enrichWithEntityBadges(displayContent, msg.entity_snapshots);

            // Render 1-click follow-up suggestions chips if present and not streaming
            const isStreamingMsg = !!(this.isStreaming || this._streamReader || window.ChatView?.isStreaming || window.ChatView?._streamReader || (msg && msg._streaming));
            if (suggestions && suggestions.length > 0 && !isStreamingMsg) {
                const suggestionsTitle = window.i18n ? window.i18n.t('chat_suggestions_title') : 'Suggestions de suite :';
                let chipsHtml = '';
                for (const item of suggestions) {
                    const label = typeof item === 'string' ? item : (item.label || item.prompt || '');
                    const prompt = typeof item === 'string' ? item : (item.prompt || item.label || '');
                    if (!label.trim()) continue;
                    chipsHtml += `
                        <button type="button" class="chat-suggestion-chip" data-prompt="${window.escapeHtml(prompt)}" onclick="window.ChatView.sendQuickSuggestion(this.getAttribute('data-prompt'))">
                            <span class="chat-suggestion-chip-icon">👉</span>
                            <span class="chat-suggestion-chip-text">${window.escapeHtml(label)}</span>
                        </button>
                    `;
                }
                if (chipsHtml) {
                    displayContent += `
                        <div class="chat-suggestions-container">
                            <div class="chat-suggestions-header">
                                <span class="chat-suggestions-icon">✨</span>
                                <span class="chat-suggestions-title" data-i18n="chat_suggestions_title">${suggestionsTitle}</span>
                            </div>
                            <div class="chat-suggestions-list">
                                ${chipsHtml}
                            </div>
                        </div>
                    `;
                }
            }
        }

        // Append status indicator if present AFTER entity enrichment to prevent badges inside status text
        if (!isUser && msg.status) {
            displayContent = `
                <div class="ai-status-indicator" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--accent); padding: 4px 8px; background: rgba(51, 102, 255, 0.1); border-radius: 12px; margin-bottom: 8px;">
                    <span class="spinner-border-sm" style="width:10px; height:10px; border:2px solid; border-right-color:transparent; border-radius:50%; animation: spin 0.75s linear infinite; display: inline-block; box-sizing: border-box;"></span>
                    <span>${window.escapeHtml(msg.status)}</span>
                </div>
                <div style="margin-top: 4px;">${displayContent}</div>
            `;
        }
        
        return displayContent;
    },

    renderHistory(isRestore = false) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        let html = '';

        // Build context bubble HTML for each historical stack entry + the current context
        // Parse stack entries (prior compressions)
        let stackEntries = [];
        if (this.compressionStack) {
            try { stackEntries = JSON.parse(this.compressionStack); } catch (e) {}
        }

        // Collect all bubbles with their anchor position
        let bubbles = [];

        // Stack entries are read-only (historical)
        stackEntries.forEach((entry, idx) => {
            const tokenEstimate = Math.ceil((entry.context || '').length / 4);
            bubbles.push({
                after_id: entry.after_id,
                html: `
                    <div class="context-bubble context-bubble-stack" id="context-bubble-stack-${idx}">
                        <div class="context-bubble-header" onclick="event.stopPropagation();">
                            <div class="context-bubble-title">
                                <span>▶ 🗜️ ${window.i18n.t('chat_context_collapsed')} (${tokenEstimate} tokens)</span>
                            </div>
                        </div>
                        <div class="context-bubble-body open">
                            <div class="context-bubble-text">${window.escapeHtml(entry.context)}</div>
                        </div>
                    </div>
                `
            });
        });

        // Current context (latest, editable)
        if (this.compressedContext !== null && this.compressedContext !== undefined) {
            const tokenEstimate = Math.ceil(this.compressedContext.length / 4);
            const bubbleOpen = this.contextBubbleOpen || this.editingContext;
            const anchorId = this.bubbleAfterMsgId || this.lastCompressedMessageId;
            bubbles.push({
                after_id: anchorId,
                isCurrent: true,
                html: `
                    <div class="context-bubble" id="context-bubble">
                        <div class="context-bubble-header" onclick="event.stopPropagation(); window.ChatView.contextBubbleOpen = !window.ChatView.contextBubbleOpen; window.ChatView.renderHistory();">
                            <div class="context-bubble-title">
                                <span>${bubbleOpen ? '▼' : '▶'} 🗜️ ${window.i18n.t('chat_context_collapsed')} (${tokenEstimate} tokens)</span>
                            </div>
                            <div class="context-bubble-actions">
                                ${!this.confirmDeleteContext ? `
                                    <button class="context-action-btn" onclick="event.stopPropagation(); window.ChatView.editingContext = true; window.ChatView.renderHistory();" title="${window.i18n.t('chat_context_btn_edit')}">✏️</button>
                                    <button class="context-action-btn danger" onclick="event.stopPropagation(); window.ChatView.confirmDeleteContext = true; window.ChatView.renderHistory();" title="${window.i18n.t('chat_context_btn_delete')}">🗑️</button>
                                    <button class="context-action-btn" onclick="event.stopPropagation(); window.ChatView.showRegenerateModal()" title="${window.i18n.t('chat_context_btn_regenerate')}">🔄</button>
                                ` : `
                                    <span class="context-delete-confirm">${window.i18n.t('chat_context_delete_confirm')}</span>
                                    <button class="context-action-btn danger" onclick="event.stopPropagation(); window.ChatView.deleteCompressedContext()">${window.i18n.t('btn_confirm')}</button>
                                    <button class="context-action-btn" onclick="event.stopPropagation(); window.ChatView.confirmDeleteContext = false; window.ChatView.renderHistory();">${window.i18n.t('btn_cancel')}</button>
                                `}
                            </div>
                        </div>
                        <div class="context-bubble-body ${bubbleOpen ? 'open' : ''}">
                            ${this.editingContext ? `
                                <textarea id="editContextTextarea" class="edit-textarea" style="min-height:80px;">${window.escapeHtml(this.compressedContext)}</textarea>
                                <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px;">
                                    <button class="btn btn-primary btn-sm" onclick="window.ChatView.saveContextEdit()" style="font-size:12px; padding:2px 8px;">✓</button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.ChatView.editingContext = false; window.ChatView.renderHistory();" style="font-size:12px; padding:2px 8px;">✕</button>
                                </div>
                            ` : `
                                <div class="context-bubble-text">${window.escapeHtml(this.compressedContext)}</div>
                            `}
                        </div>
                    </div>
                `
            });
        }

        // Compute insertion index for each bubble
        let insertions = {};  // index -> [html strings]
        bubbles.forEach(bubble => {
            let insertIdx = -1;
            if (bubble.after_id) {
                for (let i = 0; i < this.messages.length; i++) {
                    if (this.messages[i].id === bubble.after_id) {
                        insertIdx = i + 1;
                        break;
                    }
                }
            }
            if (insertIdx < 0) {
                for (let i = this.messages.length - 1; i >= 0; i--) {
                    if (this.messages[i].role === 'user') {
                        insertIdx = i + 1;
                        break;
                    }
                }
            }
            if (insertIdx < 0) insertIdx = 0;
            if (!insertions[insertIdx]) insertions[insertIdx] = [];
            insertions[insertIdx].push(bubble.html);
        });

        // Render conversation timeline with bubbles interleaved at correct positions
        html = '';
        for (let i = 0; i < this.messages.length; i++) {
            // Insert any bubbles that belong before this message
            if (insertions[i]) {
                html += insertions[i].join('');
            }
            const msg = this.messages[i];
            const isUser = msg.role === 'user';
            const formattedTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(window.i18n.lang || 'fr', { hour: '2-digit', minute: '2-digit' }) : '';
            const isLastMsg = i === this.messages.length - 1;

            // Extract tool badges for assistant messages
            let toolsBadges = '';
            if (!isUser && msg.content) {
                const match = msg.content.match(/<!--\s*TOOLS_USED:\s*([^>]+?)\s*-->/);
                if (match && match[1]) {
                    const tools = match[1].split(',').map(t => t.trim()).filter(Boolean);
                    toolsBadges = tools.map(t => {
                        const emoji = this._toolEmojiMap?.[t] || (window.ChatView?._toolEmojiMap?.[t]) || '⚙️';
                        const key = `tool_${t}`;
                        const translated = window.i18n ? window.i18n.t(key) : null;
                        const label = (translated && translated !== key) ? translated : this._formatToolFallback(t);
                        const descKey = `tool_${t}_desc`;
                        const translatedDesc = window.i18n ? window.i18n.t(descKey) : null;
                        const tooltipDesc = (translatedDesc && translatedDesc !== descKey) ? translatedDesc : label;
                        return `<span class="tool-badge" title="${tooltipDesc.replace(/"/g, '&quot;')}">${emoji} ${label}</span>`;
                    }).join(' ');
                }
            }

            html += `
                <div class="chat-message-row ${msg.role}" id="msg-row-${msg.id || i}">
                    <div class="chat-message-meta" style="display:flex; justify-content:space-between; width:100%; align-items:center; gap:10px;">
                        <div>
                            <span>${isUser ? window.i18n.t('chat_label_you') : 'Ollama OmniBank'}</span>
                            ${toolsBadges ? `<span style="margin-left: 8px; display:inline-flex; gap:4px; flex-wrap:wrap;">${toolsBadges}</span>` : ''}
                        </div>
                        <span style="font-size:9px; opacity:0.7;">${formattedTime}</span>
                    </div>
                    <div class="chat-bubble ${isUser ? 'user' : 'ai'}${msg._pending ? ' pending' : ''}" id="msg-${i}">
                        ${msg._pending ? `<div style="display:flex; align-items:center; gap:6px;"><span style="flex:1; opacity:0.5;">${window.escapeHtml(msg.content)}</span><span class="pending-badge" data-i18n="chat_message_pending">${window.i18n.t('chat_message_pending')}</span></div>` : ''}
                        ${!msg._pending && this.editingMsgId === msg.id ? `
                            <div class="chat-bubble-edit-container">
                                <textarea id="editMsgTextarea-${msg.id}" class="edit-textarea">${window.escapeHtml(msg.content)}</textarea>
                                <div style="display:flex; gap:6px; justify-content:flex-end;">
                                    <button class="btn btn-primary btn-sm" onclick="window.ChatView.saveEditedMessage(${msg.id})" style="font-size:12px; padding:2px 8px;">✓</button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.ChatView.editingMsgId = null; window.ChatView.renderHistory();" style="font-size:12px; padding:2px 8px;">✕</button>
                                </div>
                            </div>
                        ` : (!msg._pending ? this.formatMessageContent(msg) : '')}
                    </div>
                    
                    <!-- Inline actions (hidden for pending messages) -->
                    <div class="chat-message-actions${this.confirmDeleteMsgId === msg.id ? ' confirm-active' : ''}" ${msg._pending ? 'style="display:none;"' : ''}>
                        ${this.confirmDeleteMsgId === msg.id ? `
                            <span class="chat-delete-confirm-text">${window.i18n.t('chat_delete_msg_confirm')}</span>
                            <button class="chat-message-action-btn chat-delete-confirm-btn" onclick="window.ChatView.executeDeleteMessage(${msg.id})">${window.i18n.t('btn_confirm')}</button>
                            <button class="chat-message-action-btn" onclick="window.ChatView.cancelDeleteMessage()">${window.i18n.t('btn_cancel')}</button>
                        ` : `
                            ${isUser ? `
                                <button class="chat-message-action-btn" onclick="window.ChatView.startEditMessage(${msg.id})" title="${window.i18n.t('chat_edit_msg')}">✏️</button>
                            ` : ''}
                            ${(!isUser && isLastMsg) ? `
                                <button class="chat-message-action-btn" onclick="window.ChatView.regenerateAiResponse()" title="${window.i18n.t('chat_regenerate')}">🔄</button>
                            ` : ''}
                            <button class="chat-message-action-btn" onclick="window.ChatView.deleteMessage(${msg.id})" title="${window.i18n.t('chat_delete_msg')}">🗑️</button>
                        `}
                    </div>
                </div>
            `;
        }

        // Insert any bubbles that belong after the last message
        if (insertions[this.messages.length]) {
            html += insertions[this.messages.length].join('');
        }

        // Snapshot scroll position before re-rendering
        const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;

        container.innerHTML = html;
        this._updateCompressionUI();
        this.updateTokenUsageIndicator();
        this.renderMath();
        this.initEntityPopover();

        if (isRestore) {
            const savedScroll = window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem(`chatScrollPos_${this.activeSessionId}`) : sessionStorage.getItem(`chatScrollPos_${this.activeSessionId}`);
            if (savedScroll !== null) {
                container.scrollTop = parseInt(savedScroll);
            } else {
                this.scrollToBottom();
            }
        } else {
            // Only auto-scroll if user hasn't manually scrolled up
            if (!this.userHasScrolledUp && wasAtBottom) {
                this.scrollToBottom();
            }
        }

        // Attach scroll & input listeners to save position & detect manual scroll-up instantly
        if (!container.dataset.hasScrollListener) {
            // 1. Classical scroll listener to save history position & detect scroll direction
            let lastScrollTop = container.scrollTop;
            container.addEventListener('scroll', () => {
                if (this.activeSessionId) {
                    if (window.ProfileSessionStorage) window.ProfileSessionStorage.setItem(`chatScrollPos_${this.activeSessionId}`, container.scrollTop);
                    else sessionStorage.setItem(`chatScrollPos_${this.activeSessionId}`, container.scrollTop);
                }
                const currentScrollTop = container.scrollTop;
                const scrollingUp = currentScrollTop < lastScrollTop;
                lastScrollTop = currentScrollTop;

                if (scrollingUp) {
                    // Instantly lock autoscroll when user scrolls up
                    this.userHasScrolledUp = true;
                } else {
                    // Re-engage autoscroll only if scrolling down and hitting the bottom within 30px
                    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 30;
                    if (atBottom) {
                        this.userHasScrolledUp = false;
                    }
                }
            });

            // 2. Wheel listener to detect instant scroll-up intent
            container.addEventListener('wheel', (e) => {
                if (e.deltaY < 0) {
                    this.userHasScrolledUp = true;
                }
            }, { passive: true });

            // 3. Touch move listener to detect instant swipe-down (which scrolls up) intent on mobile
            let touchStartY = 0;
            container.addEventListener('touchstart', (e) => {
                if (e.touches.length > 0) {
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });
            container.addEventListener('touchmove', (e) => {
                if (e.touches.length > 0) {
                    const touchY = e.touches[0].clientY;
                    if (touchY > touchStartY) { // Swipe down -> scrolls up
                        this.userHasScrolledUp = true;
                    }
                }
            }, { passive: true });

            container.dataset.hasScrollListener = "true";
        }
    },

    startEditMessage(msgId) {
        // Find bubble element and record its width to lock it
        const bubbleIndex = this.messages.findIndex(m => m.id === msgId);
        const bubbleEl = document.getElementById(`msg-${bubbleIndex}`);
        let recordedWidth = null;
        if (bubbleEl) {
            recordedWidth = bubbleEl.offsetWidth;
        }

        this.editingMsgId = msgId;
        this.renderHistory();

        if (recordedWidth && bubbleEl) {
            // Re-fetch bubble element now that it's re-rendered in edit mode
            const editBubbleEl = document.getElementById(`msg-${bubbleIndex}`);
            if (editBubbleEl) {
                editBubbleEl.style.width = recordedWidth + 'px';
            }
        }

        const textarea = document.getElementById(`editMsgTextarea-${msgId}`);
        textarea?.focus();
    },

    async saveEditedMessage(msgId) {
        const textarea = document.getElementById(`editMsgTextarea-${msgId}`);
        if (!textarea) return;

        const newContent = textarea.value.trim();
        if (!newContent) return;

        this.editingMsgId = null;
        
        // Truncate messages starting from the edited message index to match backend logic
        const msgIndex = this.messages.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) {
            this.messages = this.messages.slice(0, msgIndex);
        }
        
        this.messages.push({ role: 'user', content: newContent });
        this.messages.push({ role: 'assistant', content: '<div class="typing-indicator"><span></span><span></span><span></span></div>' });
        const aiMsgIndex = this.messages.length - 1;
        this.renderHistory();

        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');
        if (sendBtn) {
            sendBtn.classList.add('btn-stop');
            sendBtn.textContent = window.i18n.t('chat_btn_stop');
            sendBtn.onclick = () => this.stopGeneration();
            sendBtn.disabled = false;
        }
        if (input) input.disabled = true;

        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(true);
        }
        try {
            this._activeAbortController = new AbortController();
            const response = await fetch(`/api/chat/messages/${msgId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newContent }),
                signal: this._activeAbortController.signal
            });
            await this.handleStreamingResponse(response, aiMsgIndex);
            this._activeAbortController = null;
        } catch (e) {
            this._activeAbortController = null;
            if (this._stopRequested || e.name === 'AbortError' || (e.message && (e.message.includes('aborted') || e.message.includes('cancel')))) {
                console.log('[Chat] Edit response aborted by user');
                return;
            }
            console.error(e);
            this.messages[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection') || "Erreur de connexion"}: ${e.message}*`;
            this.messages[aiMsgIndex]._isError = true;
            this.renderHistory();
        } finally {
            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(false);
            }
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.classList.remove('btn-stop');
                sendBtn.textContent = window.i18n.t('chat_btn_send');
                sendBtn.onclick = () => this.sendMessage();
            }
            if (input) {
                input.disabled = false;
                input.focus();
            }
            if (this._stopRequested) {
                if (aiMsgIndex >= 0 && this.messages && this.messages[aiMsgIndex]) {
                    const stopMsg = window.i18n.t('chat_generation_stopped') || 'Generation stopped';
                    const cur = this.messages[aiMsgIndex].content || '';
                    this.messages[aiMsgIndex].content = (cur.includes('typing-indicator') || !cur.trim() ? '' : cur + '\n\n') + '🛑 _' + stopMsg + '_';
                    this.messages[aiMsgIndex].status = null;
                    delete this.messages[aiMsgIndex]._isError;
                    this._stopRequested = false;
                    this.renderHistory();

                    try {
                        await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                            content: this.messages[aiMsgIndex].content,
                            role: "assistant",
                            update_last_assistant: true
                        });
                    } catch (e) { console.error("Failed to persist cancel:", e); }
                    await this.loadMessages();
                }
            } else {
                const hasError = !!this.messages[aiMsgIndex]._isError;
                if (hasError) {
                    // Persist error message to DB so it survives F5
                    try {
                        await API.post(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                            content: this.messages[aiMsgIndex].content,
                            role: "assistant"
                        });
                    } catch (e) { console.error("Failed to persist error:", e); }
                }
                await this.loadMessages();
            }
        }
    },

    deleteMessage(msgId) {
        this.confirmDeleteMsgId = msgId;
        this.renderHistory();
    },

    async executeDeleteMessage(msgId) {
        this.confirmDeleteMsgId = null;
        try {
            const resp = await fetch(`/api/chat/messages/${msgId}`, {
                method: 'DELETE'
            });
            if (resp.ok) {
                await this.loadMessages();
            }
        } catch (e) {
            console.error("Error deleting message:", e);
        }
    },

    cancelDeleteMessage() {
        this.confirmDeleteMsgId = null;
        this.renderHistory();
    },


    renderMath() {
        if (window.renderMathInElement) {
            renderMathInElement(document.getElementById('chatMessages'), {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "\\[", right: "\\]", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false}
                ]
            });
        }
    },

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    },

    askDefaultQuestion() {
        const session = this.sessions.find(s => s.id === this.activeSessionId);
        const role = session ? session.role : 'advisor';
        const input = document.getElementById('chatInput');
        if (!input) return;
        
        if (role === 'advisor') {
            input.value = window.i18n.t('chat_report_advisor');
        } else if (role === 'simulator') {
            input.value = window.i18n.t('chat_report_simulator');
        } else if (role === 'alerts') {
            input.value = window.i18n.t('chat_report_alerts');
        } else if (role === 'optimizer') {
            input.value = window.i18n.t('chat_report_optimizer');
        } else if (role === 'budget_planner') {
            input.value = window.i18n.t('chat_report_budget_planner');
        } else if (role === 'forecaster') {
            input.value = window.i18n.t('chat_report_forecaster');
        } else if (role === 'auditor') {
            input.value = window.i18n.t('chat_report_auditor');
        }
        
        this.sendMessage();
    },

    // ─── Smart Entity Badges & Interactive Popover Engine ───
    _entityCache: null,
    _entityLoadingPromise: null,
    _popoverInitialized: false,

    async loadEntityCache(force = false) {
        if (this._entityCache && !force && this._entityCache.recurrences && this._entityCache.transactions) return this._entityCache;
        if (this._entityLoadingPromise && !force) return this._entityLoadingPromise;
        
        this._entityLoadingPromise = (async () => {
            try {
                const [bRes, aRes, cRes, rRes, tRes] = await Promise.all([
                    API.get('/api/budgets/status').catch(() => null),
                    API.get('/api/accounts/').catch(() => null),
                    API.get('/api/categories/').catch(() => null),
                    API.get('/api/recurrences/').catch(() => null),
                    API.get('/api/transactions/?limit=100').catch(() => null)
                ]);
                this._entityCache = {
                    budgets: (bRes?.budgets || []).filter(b => b.name && b.name.trim().length >= 3),
                    accounts: (aRes || []).filter(a => a.name && a.name.trim().length >= 3),
                    categories: (cRes || []).filter(c => (c.name || c).trim().length >= 3),
                    recurrences: (rRes || []).filter(r => r.description && r.description.trim().length >= 3),
                    transactions: (tRes || []).filter(t => t.description && t.description.trim().length >= 3)
                };
                // If messages are already displayed without full badges, trigger a re-render
                if (this.messages && this.messages.length > 0 && !this._activeAbortController) {
                    this.renderHistory();
                }
                return this._entityCache;
            } catch (e) {
                console.warn('[Chat] Failed to load entity cache:', e);
            } finally {
                this._entityLoadingPromise = null;
            }
        })();
        return this._entityLoadingPromise;
    },

    enrichWithEntityBadges(html, entitySnapshots = null) {
        if (!html || typeof html !== 'string') return html;

        // Build list of entities sorted by length descending to match longest phrases first
        const entities = [];

        // 1. If message has historical snapshots attached, extract all snapshot entities directly!
        if (entitySnapshots && typeof entitySnapshots === 'object') {
            for (const [snapKey, snapData] of Object.entries(entitySnapshots)) {
                if (!snapData) continue;
                let type = 'category';
                let name = snapKey;
                let id = snapData.id || 0;
                if (snapKey.startsWith('budget:')) {
                    type = 'budget';
                    name = snapKey.substring(7);
                } else if (snapKey.startsWith('account:')) {
                    type = 'account';
                    name = snapKey.substring(8);
                } else if (snapKey.startsWith('category:')) {
                    type = 'category';
                    name = snapKey.substring(9);
                } else if (snapKey.startsWith('recurrence:')) {
                    type = 'recurrence';
                    name = snapKey.substring(11);
                } else if (snapKey.startsWith('transaction:')) {
                    type = 'transaction';
                    name = snapKey.substring(12);
                }
                if (name && name.length >= 3 && !entities.some(e => e.name.toLowerCase() === name.toLowerCase())) {
                    let icon = '🏷️';
                    if (type === 'budget') icon = snapData.envelope_type === 'savings' ? '🎯' : '🏷️';
                    else if (type === 'account') icon = '🏦';
                    else if (type === 'category') icon = '🛒';
                    else if (type === 'recurrence') icon = '🔄';
                    else if (type === 'transaction') icon = '💳';
                    entities.push({
                        type,
                        id,
                        name,
                        icon,
                        data: snapData
                    });
                }
            }
        }

        // 2. Supplement with global cache or live globals
        if (!this._entityCache || !this._entityCache.recurrences) {
            this.loadEntityCache();
        }
        let budgets = this._entityCache?.budgets;
        if (!budgets && window.BudgetsView?.statusData?.budgets) {
            budgets = window.BudgetsView.statusData.budgets;
        }
        let accounts = this._entityCache?.accounts;
        if (!accounts && window.accounts) {
            accounts = window.accounts;
        }
        let categories = this._entityCache?.categories;
        if (!categories && window.categories) {
            categories = window.categories;
        }
        let recurrences = this._entityCache?.recurrences;
        let transactions = this._entityCache?.transactions;

        if (!budgets && !accounts && !categories && !recurrences && !transactions && entities.length === 0) {
            return html;
        }

        if (budgets) {
            for (const b of budgets) {
                if (b.name && b.name.length >= 3 && !entities.some(e => e.type === 'budget' && e.name.toLowerCase() === b.name.toLowerCase())) {
                    entities.push({
                        type: 'budget',
                        id: b.id,
                        name: b.name,
                        icon: b.envelope_type === 'savings' ? '🎯' : '🏷️',
                        data: b
                    });
                }
            }
        }
        if (accounts) {
            for (const a of accounts) {
                if (a.name && a.name.length >= 3 && !entities.some(e => e.type === 'account' && e.name.toLowerCase() === a.name.toLowerCase())) {
                    entities.push({
                        type: 'account',
                        id: a.id,
                        name: a.name,
                        icon: '🏦',
                        data: a
                    });
                }
            }
        }
        if (categories) {
            for (const c of categories) {
                const cname = typeof c === 'string' ? c : c.name;
                if (cname && cname.length >= 3 && !entities.some(e => e.name.toLowerCase() === cname.toLowerCase())) {
                    entities.push({
                        type: 'category',
                        id: c.id || 0,
                        name: cname,
                        icon: '🛒',
                        data: c
                    });
                }
            }
        }
        if (recurrences) {
            for (const r of recurrences) {
                if (r.description && r.description.length >= 3 && !entities.some(e => e.name.toLowerCase() === r.description.toLowerCase())) {
                    entities.push({
                        type: 'recurrence',
                        id: r.id,
                        name: r.description,
                        icon: '🔄',
                        data: r
                    });
                }
            }
        }
        if (transactions) {
            for (const t of transactions) {
                if (t.description && t.description.length >= 3 && !entities.some(e => e.name.toLowerCase() === t.description.toLowerCase())) {
                    entities.push({
                        type: 'transaction',
                        id: t.id,
                        name: t.description,
                        icon: '💳',
                        data: t
                    });
                }
            }
        }

        if (entities.length === 0) return html;
        entities.sort((a, b) => b.name.length - a.name.length);

        // Safe DOM parsing & text replacement
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
            const container = doc.body.firstElementChild;

            const walkTextNodes = (node) => {
                if (!node) return;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toLowerCase();
                    if (tag === 'pre' || tag === 'code' || tag === 'a' || tag === 'button' || tag === 'summary' ||
                        node.classList.contains('ai-entity-badge') || 
                        node.classList.contains('ai-action-box') || 
                        node.classList.contains('ai-status-indicator') || 
                        node.classList.contains('tool-badge') || 
                        node.classList.contains('ai-think-details') ||
                        node.classList.contains('ai-think-summary')) {
                        return;
                    }
                    Array.from(node.childNodes).forEach(walkTextNodes);
                } else if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    if (!text || !text.trim()) return;

                    for (const ent of entities) {
                        const escapedName = ent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`(?<![\\wÀ-ÿ])(${escapedName})(?![\\wÀ-ÿ])`, 'i');
                        const match = text.match(regex);
                        if (match) {
                            const matchIndex = match.index;
                            const matchStr = match[0];

                            const beforeText = text.substring(0, matchIndex);
                            const afterText = text.substring(matchIndex + matchStr.length);

                            const badgeSpan = doc.createElement('span');
                            badgeSpan.className = `ai-entity-badge type-${ent.type}`;
                            badgeSpan.setAttribute('data-entity-type', ent.type);
                            badgeSpan.setAttribute('data-entity-id', ent.id);
                            badgeSpan.setAttribute('data-entity-name', ent.name);
                            badgeSpan.setAttribute('tabindex', '0');
                            badgeSpan.setAttribute('role', 'button');

                            // Attach historical snapshot data if available for this entity
                            if (entitySnapshots) {
                                const key = `${ent.type}:${ent.name}`;
                                const snap = entitySnapshots[key] || 
                                    Object.entries(entitySnapshots).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
                                if (snap) {
                                    badgeSpan.setAttribute('data-entity-snapshot', JSON.stringify(snap));
                                }
                            }

                            badgeSpan.innerHTML = `<span class="ai-entity-icon">${ent.icon}</span><span class="ai-entity-label">${matchStr}</span>`;

                            const parent = node.parentNode;
                            if (beforeText) parent.insertBefore(doc.createTextNode(beforeText), node);
                            parent.insertBefore(badgeSpan, node);
                            if (afterText) {
                                const remainingNode = doc.createTextNode(afterText);
                                parent.insertBefore(remainingNode, node);
                                walkTextNodes(remainingNode);
                            }
                            parent.removeChild(node);
                            return;
                        }
                    }
                }
            };

            walkTextNodes(container);
            return container.innerHTML;
        } catch (e) {
            console.warn('[Chat] enrichWithEntityBadges error:', e);
            return html;
        }
    },

    initEntityPopover() {
        let popover = document.getElementById('aiEntityPopover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 'aiEntityPopover';
            document.body.appendChild(popover);
        }

        if (this._popoverInitialized) return;
        this._popoverInitialized = true;

        let _hideTimeout = null;

        const showPopoverForBadge = async (badge) => {
            clearTimeout(_hideTimeout);

            const entType = badge.getAttribute('data-entity-type');
            const entId = parseInt(badge.getAttribute('data-entity-id') || 0);
            const entName = badge.getAttribute('data-entity-name');
            const snapshotRaw = badge.getAttribute('data-entity-snapshot');
            let snapshot = null;
            if (snapshotRaw) {
                try { snapshot = JSON.parse(snapshotRaw); } catch(e) {}
            }

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span>${entType === 'budget' ? '🏷️' : entType === 'account' ? '🏦' : entType === 'recurrence' ? '🔄' : entType === 'transaction' ? '💳' : '🛒'}</span>
                        <span title="${window.escapeHtml(entName)}">${window.escapeHtml(entName)}</span>
                    </div>
                    <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(99,102,241,0.15); color:var(--accent); text-transform:uppercase; font-weight:600;">
                        ${entType}
                    </span>
                </div>
                <div style="text-align:center; padding:15px 0; font-size:12px; color:var(--text-muted);">
                    <span class="spinner-border-sm" style="display:inline-block; width:14px; height:14px; border:2px solid; border-right-color:transparent; border-radius:50%; animation:spin 0.7s linear infinite;"></span>
                    <span style="margin-left:6px;">${window.i18n.t('budget_loading') || 'Chargement...'}</span>
                </div>
            `;

            popover.style.display = 'block';
            popover.classList.add('visible');

            const adjustPosition = () => {
                if (window.innerWidth <= 600) {
                    popover.style.top = '';
                    popover.style.left = '';
                    return;
                }
                const rect = badge.getBoundingClientRect();
                const popWidth = 320;
                let left = rect.left + (rect.width / 2) - (popWidth / 2);
                left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, left));

                const popHeight = popover.offsetHeight || 280;
                let top = rect.bottom + 8;
                // If displaying below overflows the bottom of the screen:
                if (top + popHeight > window.innerHeight - 10) {
                    // Display ABOVE the badge if space allows
                    if (rect.top - popHeight - 8 > 10) {
                        top = rect.top - popHeight - 8;
                    } else {
                        // Clamp inside viewport
                        top = Math.max(10, window.innerHeight - popHeight - 12);
                    }
                }
                popover.style.top = `${top}px`;
                popover.style.left = `${left}px`;
            };

            adjustPosition();

            if (entType === 'budget') {
                await this._renderBudgetPopoverContent(popover, entId, entName, snapshot);
            } else if (entType === 'account') {
                await this._renderAccountPopoverContent(popover, entId, entName, snapshot);
            } else if (entType === 'recurrence') {
                await this._renderRecurrencePopoverContent(popover, entId, entName, snapshot);
            } else if (entType === 'transaction') {
                await this._renderTransactionPopoverContent(popover, entId, entName, snapshot);
            } else {
                await this._renderCategoryPopoverContent(popover, entName, snapshot);
            }

            // Re-adjust position with final rendered height
            requestAnimationFrame(() => adjustPosition());
        };

        const scheduleHide = () => {
            _hideTimeout = setTimeout(() => {
                popover.classList.remove('visible');
                setTimeout(() => {
                    if (!popover.classList.contains('visible')) {
                        popover.style.display = 'none';
                    }
                }, 180);
            }, 250);
        };

        // Event delegation
        document.addEventListener('mouseover', (e) => {
            const badge = e.target.closest('.ai-entity-badge');
            if (badge) {
                showPopoverForBadge(badge);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const badge = e.target.closest('.ai-entity-badge');
            if (badge) {
                scheduleHide();
            }
        });

        popover.addEventListener('mouseenter', () => {
            clearTimeout(_hideTimeout);
        });

        popover.addEventListener('mouseleave', () => {
            scheduleHide();
        });

        document.addEventListener('click', (e) => {
            const badge = e.target.closest('.ai-entity-badge');
            if (badge) {
                e.preventDefault();
                e.stopPropagation();
                showPopoverForBadge(badge);
            } else if (!e.target.closest('#aiEntityPopover')) {
                popover.classList.remove('visible');
                popover.style.display = 'none';
            }
        });
    },

    async _renderBudgetPopoverContent(popover, budgetId, budgetName, snapshot = null) {
        const now = new Date();
        const y = snapshot?.snapshot_year || now.getFullYear();
        const m = snapshot?.snapshot_month || (now.getMonth() + 1);
        const fmt = window.formatCurrency || ((v) => `${Number(v).toFixed(2)} €`);

        try {
            let spent = 0.0, limit = 0.0, pct = 0.0, remaining = 0.0, recent3 = [];
            let isHistorical = false;

            if (snapshot) {
                isHistorical = true;
                spent = snapshot.spent || 0.0;
                limit = snapshot.limit || 0.0;
                pct = snapshot.percent !== undefined ? snapshot.percent : (limit > 0 ? (spent / limit * 100) : 0);
                remaining = snapshot.balance !== undefined ? snapshot.balance : (limit - spent);
                recent3 = snapshot.recent_txs || [];
            } else {
                // Live fallback (Option A)
                let budget = (this._entityCache?.budgets || []).find(b => b.id === budgetId || b.name === budgetName);
                if (!budget) {
                    const statusRes = await API.get('/api/budgets/status');
                    budget = (statusRes?.budgets || []).find(b => b.id === budgetId || b.name === budgetName);
                }

                spent = budget?.expenses || 0.0;
                limit = budget?.budget_amount || 0.0;
                pct = budget?.percent || (limit > 0 ? (spent / limit * 100) : 0);
                remaining = budget?.balance !== undefined ? budget.balance : (limit - spent);

                try {
                    const txs = await API.get(`/api/budgets/${budgetId || budget?.id}/transactions?year=${y}&month=${m}`);
                    if (txs && txs.length > 0) {
                        recent3 = txs.slice(0, 3);
                    }
                } catch (e) {}
            }

            const isFuture = snapshot?.is_future || (y > now.getFullYear() || (y === now.getFullYear() && m > (now.getMonth() + 1)));

            let barColor = '#10b981';
            if (pct >= 100) barColor = '#ef4444';
            else if (pct >= 80) barColor = '#f59e0b';

            let txHtml = '';
            if (recent3.length > 0) {
                txHtml = `
                    <div style="margin-top:10px; border-top:1px solid var(--border-color); padding-top:8px;">
                        <div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">
                            ${window.i18n.t('chat_entity_recent_txs') || 'Dernières opérations'} :
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            ${recent3.map(t => `
                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;" title="${window.escapeHtml(t.description)}">${window.escapeHtml(t.description)}</span>
                                    <span style="font-weight:600; color:${t.is_income ? '#10b981' : '#ef4444'};">${t.is_income ? '+' : '-'}${fmt(Math.abs(t.amount))}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            const snapshotBadge = isHistorical ? `
                <span title="${isFuture ? 'Projection prévisionnelle pour cette période future' : 'Données enregistrées lors de cette réponse'}" style="font-size:10px; padding:2px 6px; border-radius:4px; background:${isFuture ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.08)'}; color:${isFuture ? '#c084fc' : 'var(--text-muted)'}; font-weight:600; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex-shrink:0; border:1px solid ${isFuture ? 'rgba(192,132,252,0.3)' : 'transparent'};">
                    <span>${isFuture ? '🔮' : '📸'}</span><span>${m}/${y}${isFuture ? ' (Prévu)' : ''}</span>
                </span>
            ` : '';

            const snapshotContextJson = isHistorical ? JSON.stringify({ snapshot_year: y, snapshot_month: m }).replace(/"/g, '&quot;') : 'null';
            const spentLabel = isFuture ? (window.i18n.t('chat_entity_committed_planned') || 'Engagé (Prévu)') : (window.i18n.t('chat_entity_spent') || 'Dépensé');

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); min-width:0; flex:1; overflow:hidden;">
                        <span style="flex-shrink:0;">🏷️</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHtml(budgetName)}">${window.escapeHtml(budgetName)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${snapshotBadge}
                        <span style="font-size:11px; font-weight:700; color:${barColor}; white-space:nowrap;">
                            ${pct.toFixed(1)}%
                        </span>
                        <button onclick="document.getElementById('aiEntityPopover').classList.remove('visible'); document.getElementById('aiEntityPopover').style.display='none';" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:15px; padding:0 4px; line-height:1; display:flex; align-items:center;" title="Fermer">✕</button>
                    </div>
                </div>

                <div style="background:rgba(128,128,128,0.2); border-radius:999px; height:8px; overflow:hidden; margin-bottom:8px;">
                    <div style="background:${barColor}; width:${Math.min(100, pct)}%; height:100%; border-radius:999px; transition:width 0.3s ease;"></div>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; background:rgba(0,0,0,0.15); padding:8px; border-radius:8px; margin-bottom:8px;">
                    <div>
                        <span style="color:var(--text-muted);">${spentLabel} :</span>
                        <div style="font-weight:600; color:var(--text-main);">${fmt(spent)}</div>
                    </div>
                    <div>
                        <span style="color:var(--text-muted);">${window.i18n.t('chat_entity_limit') || 'Plafond'} :</span>
                        <div style="font-weight:600; color:var(--text-main);">${fmt(limit)}</div>
                    </div>
                </div>

                ${txHtml}

                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button class="btn btn-primary" style="flex:1; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToBudget(${budgetId || snapshot?.id || 0}, '${window.escapeHtml(budgetName)}', ${y}, ${m})">
                        📊 ${window.i18n.t('chat_entity_open_budget') || 'Ouvrir dans Budgets'}
                    </button>
                    <button class="btn btn-secondary" style="flex:1; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToHistory('${window.escapeHtml(budgetName)}', ${snapshotContextJson})">
                        🔍 ${window.i18n.t('chat_entity_filter_ops') || 'Voir opérations'}
                    </button>
                </div>
            `;
        } catch (e) {
            popover.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:10px;">🏷️ ${window.escapeHtml(budgetName)}</div>`;
        }
    },

    async _renderAccountPopoverContent(popover, accountId, accountName, snapshot = null) {
        const fmt = window.formatCurrency || ((v) => `${Number(v).toFixed(2)} €`);
        try {
            let balanceReconciled = 0, balanceProjected = 0, accountType = 'Compte', isHistorical = false;
            let snapshotDate = '';

            if (snapshot) {
                isHistorical = true;
                balanceReconciled = snapshot.balance_reconciled || 0;
                balanceProjected = snapshot.balance_projected || 0;
                accountType = snapshot.account_type || 'Compte';
                snapshotDate = snapshot.snapshot_date || '';
            } else {
                const accounts = this._entityCache?.accounts || (await API.get('/api/accounts/').catch(() => []));
                const acc = accounts.find(a => a.id === accountId || a.name === accountName);
                accountType = acc?.type || 'Compte';
                balanceReconciled = acc?.initial_balance || 0;
            }

            const snapshotBadge = isHistorical ? `
                <span title="Données enregistrées lors de cette réponse" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:var(--text-muted); font-weight:500; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex-shrink:0;">
                    <span>📸</span><span>${snapshotDate}</span>
                </span>
            ` : '';

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); min-width:0; flex:1; overflow:hidden;">
                        <span style="flex-shrink:0;">🏦</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHtml(accountName)}">${window.escapeHtml(accountName)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${snapshotBadge}
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(59,130,246,0.15); color:#3b82f6; text-transform:uppercase; font-weight:600; white-space:nowrap;">
                            ${accountType}
                        </span>
                        <button onclick="document.getElementById('aiEntityPopover').classList.remove('visible'); document.getElementById('aiEntityPopover').style.display='none';" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:15px; padding:0 4px; line-height:1; display:flex; align-items:center;" title="Fermer">✕</button>
                    </div>
                </div>

                <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                        <span style="color:var(--text-muted);">${window.i18n.t('chat_entity_reconciled_bal') || 'Solde rapproché'} :</span>
                        <span style="font-weight:700; color:var(--text-main);">${fmt(balanceReconciled)}</span>
                    </div>
                    ${balanceProjected ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Solde projeté :</span>
                        <span style="font-weight:700; color:var(--text-main);">${fmt(balanceProjected)}</span>
                    </div>` : ''}
                </div>

                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary" style="width:100%; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.app.loadView('accounts'); document.getElementById('aiEntityPopover').style.display='none';">
                        🏦 ${window.i18n.t('chat_entity_open_account') || 'Ouvrir dans Comptes'}
                    </button>
                </div>
            `;
        } catch (e) {
            popover.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:10px;">🏦 ${window.escapeHtml(accountName)}</div>`;
        }
    },

    async _renderCategoryPopoverContent(popover, categoryName, snapshot = null) {
        const fmt = window.formatCurrency || ((v) => `${Number(v).toFixed(2)} €`);
        try {
            let matchingTxs = [], isHistorical = false, snapshotDate = '';

            if (snapshot) {
                isHistorical = true;
                matchingTxs = snapshot.recent_txs || [];
                snapshotDate = snapshot.snapshot_date || '';
            } else {
                const txs = await API.get(`/api/transactions/?search=${encodeURIComponent(categoryName)}&limit=15`);
                matchingTxs = (txs || []).filter(t => 
                    (t.category && t.category.toLowerCase() === categoryName.toLowerCase()) ||
                    (t.description && t.description.toLowerCase().includes(categoryName.toLowerCase()))
                );
            }

            let txListHtml = '';
            if (matchingTxs.length > 0) {
                const recent4 = matchingTxs.slice(0, 4);
                txListHtml = `
                    <div style="margin-top:10px; border-top:1px solid var(--border-color); padding-top:8px;">
                        <div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-bottom:6px;">
                            ${window.i18n.t('chat_entity_recent_txs') || 'Dernières opérations'} :
                        </div>
                        <div style="display:flex; flex-direction:column; gap:5px;">
                            ${recent4.map(t => `
                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; padding:2px 0;">
                                    <div style="display:flex; flex-direction:column; max-width:180px; overflow:hidden;">
                                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:500;" title="${window.escapeHtml(t.description)}">${window.escapeHtml(t.description)}</span>
                                        <span style="font-size:9px; color:var(--text-muted);">${t.date_operation || t.date || ''}</span>
                                    </div>
                                    <span style="font-weight:600; color:${t.is_income ? '#10b981' : '#ef4444'}; white-space:nowrap;">
                                        ${t.is_income ? '+' : '-'}${fmt(Math.abs(t.amount))}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                txListHtml = `
                    <div style="font-size:11px; color:var(--text-muted); margin:10px 0; font-style:italic;">
                        ${window.i18n.t('chat_entity_no_txs') || 'Aucune opération trouvée'}
                    </div>
                `;
            }

            const snapshotBadge = isHistorical ? `
                <span title="Données enregistrées lors de cette réponse" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:var(--text-muted); font-weight:500; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex-shrink:0;">
                    <span>📸</span><span>${snapshotDate}</span>
                </span>
            ` : '';

            const snapshotContextJson = isHistorical && snapshotDate ? JSON.stringify({ snapshot_date: snapshotDate }).replace(/"/g, '&quot;') : 'null';

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); min-width:0; flex:1; overflow:hidden;">
                        <span style="flex-shrink:0;">🛒</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHtml(categoryName)}">${window.escapeHtml(categoryName)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${snapshotBadge}
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(245,158,11,0.15); color:#f59e0b; font-weight:600; white-space:nowrap;">
                            Catégorie
                        </span>
                        <button onclick="document.getElementById('aiEntityPopover').classList.remove('visible'); document.getElementById('aiEntityPopover').style.display='none';" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:15px; padding:0 4px; line-height:1; display:flex; align-items:center;" title="Fermer">✕</button>
                    </div>
                </div>

                ${txListHtml}

                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button class="btn btn-primary" style="width:100%; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToHistory('${window.escapeHtml(categoryName)}', ${snapshotContextJson})">
                        🔍 ${window.i18n.t('chat_entity_filter_ops') || 'Voir toutes les opérations'}
                    </button>
                </div>
            `;
        } catch (e) {
            popover.innerHTML = `
                <div style="font-weight:700; font-size:13px; margin-bottom:8px;">🛒 ${window.escapeHtml(categoryName)}</div>
                <button class="btn btn-primary" style="width:100%; font-size:11px;" onclick="window.ChatView.navigateToHistory('${window.escapeHtml(categoryName)}')">
                    🔍 ${window.i18n.t('chat_entity_filter_ops') || 'Voir les opérations'}
                </button>
            `;
        }
    },

    async _renderRecurrencePopoverContent(popover, recId, recName, snapshot = null) {
        const fmt = window.formatCurrency || ((v) => `${Number(v).toFixed(2)} €`);
        try {
            let desc = recName, amount = 0, frequency = 'monthly', day = 1, category = '', fromAcc = '', toAcc = '', isHistorical = false;
            let snapshotDate = '';

            if (snapshot) {
                isHistorical = true;
                desc = snapshot.description || recName;
                amount = snapshot.amount || 0;
                frequency = snapshot.frequency || 'monthly';
                day = snapshot.day_of_month || 1;
                category = snapshot.category || '';
                fromAcc = snapshot.from_account || '';
                toAcc = snapshot.to_account || '';
                snapshotDate = snapshot.snapshot_date || '';
            } else {
                const recs = this._entityCache?.recurrences || (await API.get('/api/recurrences/').catch(() => []));
                const rec = recs.find(r => r.id === recId || (r.description && r.description.toLowerCase() === recName.toLowerCase()));
                if (rec) {
                    desc = rec.description || recName;
                    amount = rec.amount || 0;
                    frequency = rec.frequency || 'monthly';
                    day = rec.day_of_month || 1;
                    category = rec.category || '';
                    fromAcc = rec.from_account_name || '';
                    toAcc = rec.to_account_name || '';
                }
            }

            const freqMap = {
                'monthly': 'Mensuel',
                'weekly': 'Hebdomadaire',
                'quarterly': 'Trimestriel',
                'yearly': 'Annuel'
            };
            const freqLabel = freqMap[(frequency || 'monthly').toLowerCase()] || frequency;

            const snapshotBadge = isHistorical ? `
                <span title="Données enregistrées lors de cette réponse" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:var(--text-muted); font-weight:500; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex-shrink:0;">
                    <span>📸</span><span>${snapshotDate}</span>
                </span>
            ` : '';

            let accountsStr = '';
            if (fromAcc && toAcc) {
                accountsStr = `${window.escapeHtml(fromAcc)} ➔ ${window.escapeHtml(toAcc)}`;
            } else if (fromAcc || toAcc) {
                accountsStr = window.escapeHtml(fromAcc || toAcc);
            }

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); min-width:0; flex:1; overflow:hidden;">
                        <span style="flex-shrink:0;">🔄</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHtml(desc)}">${window.escapeHtml(desc)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${snapshotBadge}
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(168,85,247,0.15); color:#a855f7; text-transform:uppercase; font-weight:600; white-space:nowrap;">
                            Récurrence
                        </span>
                        <button onclick="document.getElementById('aiEntityPopover').classList.remove('visible'); document.getElementById('aiEntityPopover').style.display='none';" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:15px; padding:0 4px; line-height:1; display:flex; align-items:center;" title="Fermer">✕</button>
                    </div>
                </div>

                <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; margin-bottom:12px; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Montant :</span>
                        <span style="font-weight:700; color:var(--text-main);">${fmt(amount)} / ${freqLabel.toLowerCase()}</span>
                    </div>
                    ${category ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Catégorie :</span>
                        <span style="font-weight:600; color:var(--text-main);">${window.escapeHtml(category)}</span>
                    </div>` : ''}
                    ${accountsStr ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Compte :</span>
                        <span style="font-weight:500; color:var(--text-main);">${accountsStr}</span>
                    </div>` : ''}
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Jour d'échéance :</span>
                        <span style="font-weight:500; color:var(--text-muted);">Le ${day} du mois</span>
                    </div>
                </div>

                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary" style="flex:1; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToRecurrences(${recId || snapshot?.id || 0}, '${window.escapeHtml(desc)}')">
                        🔄 Gérer dans Récurrences
                    </button>
                    <button class="btn btn-secondary" style="flex:1; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToHistory('${window.escapeHtml(desc)}')">
                        🔍 Voir opérations
                    </button>
                </div>
            `;
        } catch (e) {
            popover.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:10px;">🔄 ${window.escapeHtml(recName)}</div>`;
        }
    },

    async _renderTransactionPopoverContent(popover, txId, txDescription, snapshot = null) {
        const fmt = window.formatCurrency || ((v) => `${Number(v).toFixed(2)} €`);
        try {
            let desc = txDescription, amount = 0, dateOp = '', category = '', fromAcc = '', toAcc = '', isReconciled = false, isHistorical = false;
            let snapshotDate = '';

            if (snapshot) {
                isHistorical = true;
                desc = snapshot.description || txDescription;
                amount = snapshot.amount || 0;
                dateOp = snapshot.date_operation || '';
                category = snapshot.category || '';
                fromAcc = snapshot.from_account || '';
                toAcc = snapshot.to_account || '';
                isReconciled = !!snapshot.is_reconciled;
                snapshotDate = snapshot.snapshot_date || '';
            } else {
                const txs = this._entityCache?.transactions || (await API.get(`/api/transactions/?search=${encodeURIComponent(txDescription)}&limit=10`).catch(() => []));
                const tx = txs.find(t => t.id === txId || (t.description && t.description.toLowerCase() === txDescription.toLowerCase()));
                if (tx) {
                    desc = tx.description || txDescription;
                    amount = tx.amount || 0;
                    dateOp = tx.date_operation ? tx.date_operation.split('T')[0] : '';
                    category = tx.category || '';
                    fromAcc = tx.from_account_name || '';
                    toAcc = tx.to_account_name || '';
                    isReconciled = !!tx.reconciliation_date;
                }
            }

            const snapshotBadge = isHistorical ? `
                <span title="Données enregistrées lors de cette réponse" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08); color:var(--text-muted); font-weight:500; display:inline-flex; align-items:center; gap:3px; white-space:nowrap; flex-shrink:0;">
                    <span>📸</span><span>${snapshotDate}</span>
                </span>
            ` : '';

            let accountsStr = '';
            if (fromAcc && toAcc) {
                accountsStr = `${window.escapeHtml(fromAcc)} ➔ ${window.escapeHtml(toAcc)}`;
            } else if (fromAcc || toAcc) {
                accountsStr = window.escapeHtml(fromAcc || toAcc);
            }

            const isIncome = amount > 0;
            const amtColor = isIncome ? '#10b981' : '#ef4444';

            popover.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:var(--text-main); min-width:0; flex:1; overflow:hidden;">
                        <span style="flex-shrink:0;">💳</span>
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHtml(desc)}">${window.escapeHtml(desc)}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        ${snapshotBadge}
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(6,182,212,0.15); color:#06b6d4; text-transform:uppercase; font-weight:600; white-space:nowrap;">
                            Opération
                        </span>
                        <button onclick="document.getElementById('aiEntityPopover').classList.remove('visible'); document.getElementById('aiEntityPopover').style.display='none';" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:15px; padding:0 4px; line-height:1; display:flex; align-items:center;" title="Fermer">✕</button>
                    </div>
                </div>

                <div style="background:rgba(0,0,0,0.15); padding:10px; border-radius:8px; margin-bottom:12px; display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Montant :</span>
                        <span style="font-weight:700; color:${amtColor};">${isIncome ? '+' : '-'}${fmt(Math.abs(amount))}</span>
                    </div>
                    ${dateOp ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Date opération :</span>
                        <span style="font-weight:600; color:var(--text-main);">${dateOp}</span>
                    </div>` : ''}
                    ${category ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Catégorie :</span>
                        <span style="font-weight:600; color:var(--text-main);">${window.escapeHtml(category)}</span>
                    </div>` : ''}
                    ${accountsStr ? `
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">Compte :</span>
                        <span style="font-weight:500; color:var(--text-main);">${accountsStr}</span>
                    </div>` : ''}
                    <div style="display:flex; justify-content:space-between; font-size:11px;">
                        <span style="color:var(--text-muted);">État :</span>
                        <span style="font-weight:500; color:${isReconciled ? '#10b981' : '#f59e0b'};">${isReconciled ? '✓ Rapprochée' : '⏳ Non pointée'}</span>
                    </div>
                </div>

                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary" style="flex:1; padding:6px 8px; font-size:11px; border-radius:6px;" onclick="window.ChatView.navigateToTransaction(${txId || snapshot?.id || 0}, '${window.escapeHtml(desc)}', '${dateOp}')">
                        🔍 Voir dans l'historique
                    </button>
                </div>
            `;
        } catch (e) {
            popover.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:10px;">💳 ${window.escapeHtml(txDescription)}</div>`;
        }
    },

    navigateToRecurrences(recId, recName) {
        const popover = document.getElementById('aiEntityPopover');
        if (popover) { popover.style.display = 'none'; popover.classList.remove('visible'); }
        if (window.app) {
            if (window.RecurrenceView) {
                if (recId) window.RecurrenceView._pendingHighlightTemplateId = recId;
                if (recName) window.RecurrenceView.searchQuery = recName;
            }
            window.app.loadView('recurrences');
        }
    },

    navigateToTransaction(txId, txDescription, dateOperation = null) {
        const popover = document.getElementById('aiEntityPopover');
        if (popover) { popover.style.display = 'none'; popover.classList.remove('visible'); }
        if (window.app) {
            if (window.AllOperationsView) {
                const pending = { search: txDescription || '', backToView: 'chat' };
                if (dateOperation) {
                    pending.monthKey = dateOperation.substring(0, 7);
                }
                window.AllOperationsView.pendingFilter = pending;
            }
            window.app.loadView('all_operations');
        }
    },

    _hasPromisedAction(rawContent) {
        if (!rawContent || typeof rawContent !== 'string') return false;
        if (rawContent.includes('🛑')) return false;
        const lower = rawContent.toLowerCase();
        return (
            lower.includes("j'ai préparé l'enregistrement") ||
            lower.includes("j’ai préparé l’enregistrement") ||
            lower.includes("j'ai préparé l'opération") ||
            lower.includes("j’ai préparé l’opération") ||
            lower.includes("j'ai préparé un virement") ||
            lower.includes("j’ai préparé un virement") ||
            lower.includes("veuillez l'examiner et le valider") ||
            lower.includes("veuillez l’examiner et le valider") ||
            lower.includes("veuillez examiner et valider") ||
            lower.includes("valider ci-dessous") ||
            lower.includes("valider ces deux transferts") ||
            lower.includes("propose d'enregistrer ce virement") ||
            lower.includes("propose d’enregistrer ce virement")
        );
    },

    async recoverActionsForMessage(msgId, btnElement = null) {
        if (!msgId) return;
        if (btnElement) {
            btnElement.disabled = true;
            btnElement.innerHTML = `<span class="spinner-border-sm" style="width:12px; height:12px; border:2px solid; border-right-color:transparent; border-radius:50%; animation:spin 0.7s linear infinite; display:inline-block;"></span> <span>${window.i18n.t('budget_loading') || 'Extraction...'}</span>`;
        }

        try {
            const res = await API.post(`/api/chat/messages/${msgId}/recover-actions`);
            if (res && res.ok && res.actions && res.actions.length > 0) {
                // Update message in memory
                const msg = (this.messages || []).find(m => m.id === msgId);
                if (msg) {
                    msg.content = res.new_content;
                }
                const succMsg = window.i18n ? window.i18n.tp('chat_action_recovery_success', { count: res.actions.length }) : `${res.actions.length} action(s) générée(s) avec succès`;
                if (window.showToast) window.showToast(succMsg, 'success');
                // Re-render history reactively (Zero F5)
                this.renderHistory();
            } else {
                const emptyMsg = window.i18n ? window.i18n.t('chat_action_recovery_empty') : "Aucune action spécifique n'a pu être extraite du message.";
                if (window.showToast) window.showToast(emptyMsg, 'warning');
                if (btnElement) {
                    btnElement.disabled = false;
                    btnElement.innerHTML = `<span>🪄</span> <span>${window.i18n ? window.i18n.t('chat_btn_recover_action') : "Générer les cartes d'actions"}</span>`;
                }
            }
        } catch (e) {
            console.error('[Chat] Error recovering actions:', e);
            if (window.showToast) window.showToast("Erreur lors de la récupération des actions", "error");
            if (btnElement) {
                btnElement.disabled = false;
                btnElement.innerHTML = `<span>🪄</span> <span>${window.i18n ? window.i18n.t('chat_btn_recover_action') : "Générer les cartes d'actions"}</span>`;
            }
        }
    },

    navigateToBudget(budgetId, budgetName, year, month) {
        const popover = document.getElementById('aiEntityPopover');
        if (popover) { popover.style.display = 'none'; popover.classList.remove('visible'); }
        if (window.app) {
            if (window.BudgetsView) {
                window.BudgetsView.backToView = 'chat';
                if (year && month) {
                    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
                    window.BudgetsView.monthlyMonth = targetMonth;
                    if (window.ProfileStorage) {
                        ProfileStorage.set('budget_monthly_month', targetMonth);
                    }
                }
            }
            window.app.loadView('budgets');
            setTimeout(() => {
                const backBtn = document.getElementById('btnBudgetsBackToSource');
                if (backBtn) {
                    backBtn.classList.add('visible');
                    backBtn.style.display = 'inline-flex';
                }
                if (window.BudgetsView && typeof window.BudgetsView.showDetail === 'function') {
                    window.BudgetsView.showDetail(budgetId, budgetName, year, month);
                }
            }, 250);
        }
    },

    navigateToHistory(searchTerm, snapshotContext = null) {
        const popover = document.getElementById('aiEntityPopover');
        if (popover) { popover.style.display = 'none'; popover.classList.remove('visible'); }
        if (window.app) {
            if (window.AllOperationsView) {
                const isBudget = this._entityCache?.budgets?.some(b => b.name.toLowerCase() === searchTerm.toLowerCase());
                const pending = isBudget
                    ? { budgetEnvelopeName: searchTerm, backToView: 'chat' }
                    : { search: searchTerm, category: searchTerm, backToView: 'chat' };

                if (snapshotContext?.snapshot_year && snapshotContext?.snapshot_month) {
                    const y = snapshotContext.snapshot_year;
                    const m = String(snapshotContext.snapshot_month).padStart(2, '0');
                    pending.monthKey = `${y}-${m}`;
                } else if (snapshotContext?.snapshot_date) {
                    pending.monthKey = snapshotContext.snapshot_date.substring(0, 7);
                }

                window.AllOperationsView.pendingFilter = pending;
            }
            window.app.loadView('all_operations');
        }
    },

    _formatToolFallback(t) {
        if (!t) return 'Outil';
        let clean = t.startsWith('tool_') ? t.substring(5) : t;
        return clean.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    },

    sendQuickSuggestion(promptText) {
        if (!promptText) return;
        if (this.isStreaming || this._streamReader || window.ChatView?.isStreaming || window.ChatView?._streamReader) return;
        const input = document.getElementById('chatInput');
        if (!input) return;
        input.value = promptText;
        if (typeof this.sendMessage === 'function') {
            this.sendMessage();
        } else if (window.ChatView && typeof window.ChatView.sendMessage === 'function') {
            window.ChatView.sendMessage();
        }
    }
});


