window.ChatView = {
    history: [],

    render() {
        return `
            <div class="view-header" style="display:flex; justify-content:space-between; margin-bottom:15px; align-items:center;">
                <h2>💬 <span data-i18n="nav_chat">Chat IA (Ollama RAG)</span></h2>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <select id="chatRoleSelect" class="inline-input" style="padding: 6px 12px; border-radius: 6px; font-weight: 500;">
                        <option value="advisor" data-i18n="chat_role_advisor">${window.i18n.t('chat_role_advisor')}</option>
                        <option value="simulator" data-i18n="chat_role_simulator">${window.i18n.t('chat_role_simulator')}</option>
                        <option value="alerts" data-i18n="chat_role_alerts">${window.i18n.t('chat_role_alerts')}</option>
                    </select>
                    <button class="btn btn-secondary" onclick="window.ChatView.askDefaultQuestion()" data-i18n-title="tooltip_auto_report" title="Demander le rapport automatique de ce rôle" data-i18n="chat_btn_report" style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">${window.i18n.t('chat_btn_report')}</button>
                </div>
            </div>
            
            <div class="chat-container" style="display: flex; flex-direction: column; height: calc(100vh - 150px); background: var(--bg-surface); border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); overflow: hidden;">
                
                <div id="chatMessages" style="flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px;">
                    <div style="text-align: center; color: var(--text-muted); font-size: 12px; margin-bottom: 10px;">
                        ${window.i18n.t('chat_intro')}
                    </div>
                </div>

                <div style="padding: 15px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar); display: flex; gap: 10px;">
                    <textarea id="chatInput" class="inline-input" data-i18n-placeholder="chat_ph_message" placeholder="Posez une question sur vos finances..." 
                        style="flex: 1; resize: none; border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; min-height: 44px; max-height: 120px;" 
                        onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.ChatView.sendMessage(); }"></textarea>
                    
                    <button class="btn btn-primary" id="chatSendBtn" onclick="window.ChatView.sendMessage()" style="padding: 0 20px;" data-i18n="chat_btn_send">
                        ${window.i18n.t('chat_btn_send')}
                    </button>
                </div>
            </div>
        `;
    },

    async init() {
        this.history = [];
        this.renderHistory();
        // Event delegation for AI action buttons (onclick stripped by DOMPurify)
        document.getElementById('chatMessages')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action-id]');
            if (btn) window.ChatView.openActionModal(parseInt(btn.dataset.actionId));
        });
    },

    renderHistory() {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        // Keep intro message
        const intro = container.firstElementChild.outerHTML;
        
        const msgsHtml = this.history.map((msg, index) => {
            const isUser = msg.role === 'user';
            
            // Format content if it's from AI
            let displayContent = msg.content;
            if (!isUser && window.marked && window.DOMPurify) {
                let rawContent = msg.content;
                let actions = [];
                
                // Match the JSON signature {"id": 123, "updates": {...}} anywhere in the text
                const actionRegex = /\{\s*"id"\s*:\s*\d+\s*,\s*"updates"\s*:\s*\{[^}]+\}\s*\}/g;
                
                rawContent = rawContent.replace(actionRegex, function(match) {
                    try {
                        const actionObj = JSON.parse(match);
                        actions.push(actionObj);
                        return ''; // Remove JSON from raw text
                    } catch (e) {
                        return match;
                    }
                });
                
                // Clean up any empty markdown blocks left behind
                rawContent = rawContent.replace(/```(?:action|json)?\s*```/g, '');

                displayContent = DOMPurify.sanitize(marked.parse(rawContent));
                
                // Append the action UI boxes at the end of the AI's response
                for (const actionObj of actions) {
                    window.ChatView = window.ChatView || {};
                    window.ChatView.pendingActions = window.ChatView.pendingActions || {};
                    window.ChatView.pendingActions[actionObj.id] = actionObj;
                    
                    displayContent += `<div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                        <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                        <div style="font-size: 12px; margin-bottom: 12px;">${window.i18n.t('chat_ai_propose_modify')} #${actionObj.id}.</div>
                        <button class="btn btn-primary" data-action-id="${actionObj.id}" style="padding: 6px 12px; font-size: 12px;">${window.i18n.t('chat_btn_review')}</button>
                    </div>`;
                }
            }

            return `
                <div style="display: flex; flex-direction: column; align-items: ${isUser ? 'flex-end' : 'flex-start'};">
                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; padding: 0 4px;">
                        ${isUser ? window.i18n.t('chat_label_you') : 'Ollama OmniBank'}
                    </div>
                    <div class="chat-bubble ${isUser ? 'user' : 'ai'}" id="msg-${index}">
                        ${displayContent}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = intro + msgsHtml;
        this.renderMath();
        this.scrollToBottom();
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
        const role = document.getElementById('chatRoleSelect').value;
        const input = document.getElementById('chatInput');
        
        if (role === 'advisor') {
            input.value = "Fais-moi un bilan financier global de ma situation actuelle. Quels sont mes points forts et les points à surveiller ?";
        } else if (role === 'simulator') {
            input.value = "Analyse ma capacité d'épargne et mes marges de manœuvre actuelles pour de nouveaux projets ou achats.";
        } else if (role === 'alerts') {
            input.value = "Fais-moi un rapport détaillé des anomalies, des dépenses excessives récentes, et des risques de découvert urgents.";
        }
        
        this.sendMessage();
    },

    async openActionModal(txId) {
        const actionObj = this.pendingActions[txId];
        if (!actionObj) return;

        // Fetch current transaction to show "before" values
        let currentTx = null;
        try {
            const resp = await fetch(`/api/transactions/${txId}`);
            if (resp.ok) currentTx = await resp.json();
        } catch(e) {}

        const fieldLabels = { category: window.i18n.t('field_label_category'), description: window.i18n.t('field_label_description'), amount: window.i18n.t('field_label_amount'), date_operation: window.i18n.t('field_label_date') };

        let detailsHtml = `<strong>Transaction #${actionObj.id}</strong>`;
        if (currentTx?.description) detailsHtml += ` — <em>${currentTx.description}</em>`;
        detailsHtml += `<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">`;
        detailsHtml += `<thead><tr>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_field">${window.i18n.t('chat_th_field')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_before">${window.i18n.t('chat_th_before')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_after">${window.i18n.t('chat_th_after')}</th>
        </tr></thead><tbody>`;

        for (const [key, newVal] of Object.entries(actionObj.updates || {})) {
            const label = fieldLabels[key] || key;
            const oldVal = currentTx ? (currentTx[key] ?? '<em>vide</em>') : '...';
            detailsHtml += `<tr>
                <td style="padding:6px 8px; font-weight:600;">${label}</td>
                <td style="padding:6px 8px; color:var(--text-muted); text-decoration:line-through;">${oldVal}</td>
                <td style="padding:6px 8px; color:var(--accent); font-weight:600;">${newVal}</td>
            </tr>`;
        }
        detailsHtml += `</tbody></table>`;

        document.getElementById('aiActionDetails').innerHTML = detailsHtml;
        document.getElementById('aiActionModal').style.display = 'flex';
        document.getElementById('aiActionConfirmBtn').onclick = () => this.applyAiAction(actionObj);
    },

    closeActionModal() {
        document.getElementById('aiActionModal').style.display = 'none';
    },

    async applyAiAction(actionObj) {
        const btn = document.getElementById('aiActionConfirmBtn');
        btn.disabled = true;
        btn.innerText = window.i18n.t('msg_applying');

        try {
            const response = await fetch(`/api/transactions/${actionObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actionObj.updates)
            });

            if (!response.ok) throw new Error("Erreur API");

            // Success
            this.closeActionModal();
            
            // Add a feedback message in chat
            this.history.push({ 
                role: 'assistant', 
                content: `✅ La transaction **#${actionObj.id}** a été mise à jour avec succès dans la base de données.` 
            });
            this.renderHistory();

        } catch (error) {
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_edit_error', {error: error.message}));
        } finally {
            btn.disabled = false;
            btn.innerText = window.i18n.t('btn_validate_edit');
        }
    },

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;

        // Add user message
        this.history.push({ role: 'user', content: text });
        input.value = '';
        input.style.height = 'auto'; // Reset textarea height
        
        // Add empty AI message placeholder
        this.history.push({ role: 'assistant', content: '<div class="typing-indicator"><span></span><span></span><span></span></div>' });
        const aiMsgIndex = this.history.length - 1;
        
        this.renderHistory();
        
        const sendBtn = document.getElementById('chatSendBtn');
        sendBtn.disabled = true;
        input.disabled = true;

        try {
            const response = await fetch('/api/chat/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: text,
                    // Pass history excluding the last 2 items we just added
                    history: this.history.slice(0, -2),
                    role: document.getElementById('chatRoleSelect').value
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "API Error");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            let done = false;
            let aiText = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.substring(6).trim();
                            if (dataStr === '[DONE]') {
                                done = true;
                                break;
                            }
                            try {
                                const data = JSON.parse(dataStr);
                                if (data.error) {
                                    aiText += `\n**Erreur:** ${data.error}`;
                                } else if (data.content) {
                                    aiText += data.content;
                                }
                            } catch (e) {
                                console.error("Parse error on chunk:", dataStr);
                            }
                        }
                    }

                    // Update UI live
                    this.history[aiMsgIndex].content = aiText;
                    
                    // We can either re-render the whole history, or just update the specific bubble.
                    // For markdown to work well, we re-parse the bubble content.
                    const bubble = document.getElementById(`msg-${aiMsgIndex}`);
                    if (bubble && window.marked && window.DOMPurify) {
                        bubble.innerHTML = DOMPurify.sanitize(marked.parse(aiText));
                        // Debounce Math rendering might be better, but doing it live is okay for small texts
                        this.renderMath();
                    } else if (bubble) {
                        bubble.textContent = aiText;
                    }
                    this.scrollToBottom();
                }
            }

        } catch (e) {
            console.error(e);
            this.history[aiMsgIndex].content = `*${window.i18n.t('chat_error_connection')}: ${e.message}*`;
        } finally {
            // Re-render full history once stream is done — parses action blocks & cleans JSON
            this.renderHistory();
            sendBtn.disabled = false;
            input.disabled = false;
            input.focus();
        }
    }
};
