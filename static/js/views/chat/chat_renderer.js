// static/js/views/chat/chat_renderer.js — Moteur de rendu des messages (Markdown, KaTeX, Bulles & Historique)
window.ChatView = Object.assign(window.ChatView || {}, {
    formatMessageContent(msg) {
        const isUser = msg.role === 'user';
        let displayContent = msg.content;
        
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

            // Clean up any stray backtick wrappers
            rawContent = rawContent.replace(/```(?:action|json)?\s*\n?/g, '').replace(/\n?\s*```/g, '');

            // Strip literal \n if present in raw string
            rawContent = rawContent.replace(/\\n/g, '\n');

            // Strip TOOLS_USED comment (badges are rendered in renderHistory meta-row)
            rawContent = rawContent.replace(/<!--\s*TOOLS_USED:\s*[^>]+?\s*-->\n?/, '');
            
            // Match signature {"id": 123, "updates": {...}} or {"id": 123, "updates": {}}
            const actionRegex = /\{\s*"id"\s*:\s*\d+\s*,\s*"updates"\s*:\s*\{[^}]*\}\s*\}/g;
            rawContent = rawContent.replace(actionRegex, (match) => {
                try {
                    let actionObj = JSON.parse(match);
                    if (!actionObj.updates || Object.keys(actionObj.updates).length === 0) {
                        actionObj = {
                            action: 'delete_transaction',
                            params: { transaction_id: actionObj.id }
                        };
                    }
                    actions.push(actionObj);
                    return '';
                } catch (e) {
                    return match;
                }
            });
            
            // Match signature {"action": "...", "params": {...}}
            const genericActionRegex = /\{\s*"action"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^}]*\}\s*\}/g;
            rawContent = rawContent.replace(genericActionRegex, (match) => {
                try {
                    const actionObj = JSON.parse(match);
                    actions.push(actionObj);
                    return '';
                } catch (e) {
                    return match;
                }
            });
            
            rawContent = rawContent.replace(/```(?:action|json)?\s*```/g, '');

            // Check for thinking blocks - use placeholders to bypass DOMPurify stripping
            let hasThink = false;
            let isOpenThink = false;
            if (rawContent.includes('<think>')) {
                hasThink = true;
                if (rawContent.includes('</think>')) {
                    rawContent = rawContent.replace(/<think>/g, '___THINK_START___').replace(/<\/think>/g, '___THINK_END___');
                } else {
                    isOpenThink = true;
                    rawContent = rawContent.replace(/<think>/g, '___THINK_START___') + '___THINK_END_ACTIVE___';
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
                
                // Replace placeholders back to HTML details after sanitization
                if (hasThink) {
                    const defaultInProgress = '🧠 Réflexion en cours...';
                    const defaultPhase = '🧠 Phase de réflexion';
                    const thinkTitle = isOpenThink 
                        ? (window.i18n ? (window.i18n.t('chat_thinking_in_progress') || defaultInProgress) : defaultInProgress)
                        : (window.i18n ? (window.i18n.t('chat_thinking_phase') || defaultPhase) : defaultPhase);
                    const openAttr = isOpenThink ? "open" : "";
                    displayContent = displayContent
                        .replace(/___THINK_START___/g, `<details class="ai-think-details" ${openAttr}><summary class="ai-think-summary"><span>${thinkTitle}</span></summary><div class="ai-think-content">`)
                        .replace(/___THINK_END___/g, '</div></details>')
                        .replace(/___THINK_END_ACTIVE___/g, '</div></details>');
                }

                for (const actionObj of actions) {
                    if (actionObj.id !== undefined) {
                        this.pendingActions[actionObj.id] = actionObj;
                        displayContent += `
                            <div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                                <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                                <div style="font-size: 12px; margin-bottom: 12px;">${window.i18n.t('chat_ai_propose_modify')} #${actionObj.id}.</div>
                                <button class="btn btn-primary" data-action-id="${actionObj.id}" style="padding: 6px 12px; font-size: 12px;">${window.i18n.t('chat_btn_review')}</button>
                            </div>
                        `;
                    } else if (actionObj.action !== undefined) {
                        const actionId = 'act_' + Math.random().toString(36).substr(2, 9);
                        this.pendingActions[actionId] = actionObj;
                        
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
                            desc = window.i18n.tp('chat_action_propose_update_recurrence', { desc: actionObj.params.description || actionObj.params.template_id });
                        } else if (actionObj.action === 'delete_recurrence_template') {
                            desc = window.i18n.tp('chat_action_propose_delete_recurrence', { id: actionObj.params.template_id });
                        } else if (actionObj.action === 'create_category') {
                            desc = window.i18n.tp('chat_action_propose_create_category', { name: actionObj.params.name });
                        } else if (actionObj.action === 'delete_category') {
                            desc = window.i18n.tp('chat_action_propose_delete_category', { name: actionObj.params.name });
                        } else if (actionObj.action === 'set_predicted_paycheck') {
                            desc = window.i18n.tp('chat_action_propose_set_paycheck', { amount: actionObj.params.amount, day: actionObj.params.day_of_month });
                        } else if (actionObj.action === 'delete_transaction') {
                            desc = window.i18n.tp('chat_action_propose_delete_transaction', { id: actionObj.params.transaction_id });
                        }

                        displayContent += `
                            <div class="ai-action-box" style="margin-top: 15px; padding: 15px; background: rgba(51, 102, 255, 0.08); border: 1px solid var(--accent); border-radius: 8px;">
                                <div style="font-weight: 600; color: var(--accent); margin-bottom: 8px;">${window.i18n.t('chat_ai_recommendation')}</div>
                                <div style="font-size: 12px; margin-bottom: 12px;">${desc}.</div>
                                <button class="btn btn-primary" data-action-id="${actionId}" style="padding: 6px 12px; font-size: 12px;">${window.i18n.t('chat_btn_review_generic')}</button>
                            </div>
                        `;
                    }
                }
            }
        } else if (isUser) {
            displayContent = window.escapeHtml(displayContent);
        }

        if (!isUser) {
            displayContent = this.enrichWithEntityBadges(displayContent, msg.entity_snapshots);
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
                        const label = (window.i18n && window.i18n.t(`tool_${t}`)) || t;
                        const tooltipDesc = (window.i18n && window.i18n.t(`tool_${t}_desc`)) || label;
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
            const savedScroll = sessionStorage.getItem(`chatScrollPos_${this.activeSessionId}`);
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
                    sessionStorage.setItem(`chatScrollPos_${this.activeSessionId}`, container.scrollTop);
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

    async loadEntityCache() {
        if (this._entityCache) return this._entityCache;
        if (this._entityLoadingPromise) return this._entityLoadingPromise;
        
        this._entityLoadingPromise = (async () => {
            try {
                const [bRes, aRes, cRes] = await Promise.all([
                    API.get('/api/budgets/status').catch(() => null),
                    API.get('/api/accounts/').catch(() => null),
                    API.get('/api/categories/').catch(() => null)
                ]);
                this._entityCache = {
                    budgets: (bRes?.budgets || []).filter(b => b.name && b.name.trim().length >= 3),
                    accounts: (aRes || []).filter(a => a.name && a.name.trim().length >= 3),
                    categories: (cRes || []).filter(c => (c.name || c).trim().length >= 3)
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
                }
                if (name && name.length >= 3 && !entities.some(e => e.name.toLowerCase() === name.toLowerCase())) {
                    let icon = '🏷️';
                    if (type === 'budget') icon = snapData.envelope_type === 'savings' ? '🎯' : '🏷️';
                    else if (type === 'account') icon = '🏦';
                    else if (type === 'category') icon = '🛒';
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

        if (!budgets && !accounts && !categories && entities.length === 0) {
            this.loadEntityCache();
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
                        <span>${entType === 'budget' ? '🏷️' : entType === 'account' ? '🏦' : '🛒'}</span>
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
                if (backBtn) backBtn.style.display = 'inline-flex';
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
    }

});


