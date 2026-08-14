// static/js/views/config/config_profiles.js — Gestion des Profils Maîtres, PIN de sécurité & Thèmes
window.ConfigView = Object.assign(window.ConfigView || {}, {
    async _refreshProfilesPanel() {
        const container = document.getElementById('profilesListContainer');
        if (!container) return;

        try {
            const data = await API.get('/api/profiles/');
            const activeId = data.active_profile_id;
            const profiles = data.profiles || [];

            if (profiles.length === 0) {
                container.innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">Aucun profil trouvé.</p>`;
                return;
            }

            container.innerHTML = profiles.map(p => {
                const isActive = p.id === activeId;
                const isDefault = p.id === 'default';
                const safeName = window.escapeHtml ? window.escapeHtml(p.name) : p.name;
                const pIcon = p.icon || '👤';

                const txtActive = window.i18n ? window.i18n.t('profiles_active') : 'Actif';
                const txtDefault = window.i18n ? window.i18n.t('profiles_default') : 'Profil par défaut';
                const txtPinEnabled = window.i18n ? window.i18n.t('profiles_pin_enabled') : 'Activé';
                const txtPinNone = window.i18n ? window.i18n.t('profiles_pin_none') : 'Aucun';
                const txtSwitch = window.i18n ? window.i18n.t('profiles_btn_switch') : '⚡ Basculer';
                const txtEdit = window.i18n ? window.i18n.t('profiles_btn_edit') : '✏️ Éditer';
                const txtPin = window.i18n ? window.i18n.t('profiles_btn_pin') : '🔑 PIN';

                return `
                    <div style="background: var(--bg-card, var(--bg-surface)); border: ${isActive ? '2px solid var(--accent)' : '1px solid var(--border-color)'}; ${isActive ? 'box-shadow: 0 4px 16px var(--accent-glow);' : ''} border-radius: 12px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; position: relative;">
                        <div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                                <div style="display:flex; align-items:center; gap: 8px;">
                                    <span style="width: 12px; height: 12px; border-radius: 50%; background-color: ${p.color || '#6366f1'}; display: inline-block; box-shadow: 0 0 8px ${p.color || '#6366f1'};"></span>
                                    <span style="font-size: 16px; line-height: 1;">${pIcon}</span>
                                    <strong style="font-size: 14px; color: var(--text-main);">${safeName}</strong>
                                </div>
                                ${isActive ? `<span style="font-size: 10px; font-weight: 700; background: var(--accent-subtle); border: 1px solid var(--accent-border); color: var(--accent); padding: 2px 8px; border-radius: 10px;" data-i18n="profiles_active">${txtActive}</span>` : ''}
                            </div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">
                                ${isDefault ? `<span style="display:inline-block; margin-right:6px;" data-i18n="profiles_default">${txtDefault}</span>` : ''}
                                <span>🔒 PIN: ${p.has_pin ? txtPinEnabled : txtPinNone}</span>
                            </div>
                        </div>

                        <div style="display:flex; gap:6px; flex-wrap:wrap; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 8px;">
                            ${!isActive ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.app.switchProfile('${p.id}')" data-i18n="profiles_btn_switch">${txtSwitch}</button>` : ''}
                            ${isActive ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.ConfigView._showEditProfileModal('${p.id}', '${safeName.replace(/'/g, "\\'")}', '${p.color}', '${pIcon.replace(/'/g, "\\'")}', '${p.currency || 'EUR'}', ${p.pay_cycle_day || 28}, '${p.date_format || 'DD/MM/YYYY'}')" data-i18n="profiles_btn_edit">${txtEdit}</button>` : ''}
                            ${isActive ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="window.ConfigView._showManagePinModal('${p.id}', ${p.has_pin})" data-i18n="profiles_btn_pin">${txtPin}</button>` : ''}
                            ${(isActive && !isDefault) ? `<button class="btn btn-danger" style="padding: 3px 8px; font-size: 11px; margin-left:auto;" onclick="window.ConfigView._deleteProfilePrompt('${p.id}', '${safeName.replace(/'/g, "\\'")}')">🗑️</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            if (window.i18n && window.i18n.translateDOM) {
                window.i18n.translateDOM(container);
            }

            const lockSel = document.getElementById('autoLockMinutesSelect');
            if (lockSel && window.ProfileStorage) {
                lockSel.value = window.ProfileStorage.get('omni_autolock_minutes') || '5';
            }
        } catch (e) {
            console.error("Failed to load profiles list", e);
        }
    },

    _editingProfileId: null,
    _pinProfileId: null,
    _pinHasPin: false,
    _deleteProfileId: null,

    _initColorSwatches() {
        const container = document.getElementById('masterProfileColorSwatches');
        if (!container || container._swatchesInited) return;
        container._swatchesInited = true;

        const input = document.getElementById('masterProfileColorInput');
        const picker = document.getElementById('masterProfileCustomColorPicker');

        const updateSelectedColor = (col) => {
            if (input) input.value = col;
            if (picker) picker.value = col;

            // Live Theme Preview if editing current active profile or creating
            const activeId = window.app && window.app.activeProfileId ? window.app.activeProfileId : null;
            if (!this._editingProfileId || this._editingProfileId === activeId) {
                if (window.app && window.app.applyProfileTheme) {
                    window.app.applyProfileTheme(col);
                }
            }
        };

        container.querySelectorAll('.profile-color-swatch').forEach(swatch => {
            swatch.onclick = () => {
                container.querySelectorAll('.profile-color-swatch').forEach(s => {
                    s.style.border = '2px solid transparent';
                    s.classList.remove('active');
                });
                swatch.style.border = '2px solid #ffffff';
                swatch.classList.add('active');
                const col = swatch.getAttribute('data-color');
                updateSelectedColor(col);
            };
        });

        if (picker) {
            picker.oninput = (e) => {
                container.querySelectorAll('.profile-color-swatch').forEach(s => {
                    s.style.border = '2px solid transparent';
                    s.classList.remove('active');
                });
                updateSelectedColor(e.target.value);
            };
        }
    },

    _selectColorSwatch(colorHex) {
        this._initColorSwatches();
        const container = document.getElementById('masterProfileColorSwatches');
        const input = document.getElementById('masterProfileColorInput');
        const picker = document.getElementById('masterProfileCustomColorPicker');
        
        const targetColor = colorHex || '#6366f1';
        if (input) input.value = targetColor;
        if (picker) picker.value = targetColor;

        if (container) {
            let matched = false;
            container.querySelectorAll('.profile-color-swatch').forEach(swatch => {
                const c = swatch.getAttribute('data-color');
                if (c && c.toLowerCase() === targetColor.toLowerCase()) {
                    swatch.style.border = '2px solid #ffffff';
                    swatch.classList.add('active');
                    matched = true;
                } else {
                    swatch.style.border = '2px solid transparent';
                    swatch.classList.remove('active');
                }
            });
            if (!matched && container.firstElementChild) {
                container.firstElementChild.style.border = '2px solid #ffffff';
                container.firstElementChild.classList.add('active');
            }
        }
    },

    _initIconSwatches() {
        const container = document.getElementById('masterProfileIconSwatches');
        if (!container || container._swatchesInited) return;
        container._swatchesInited = true;

        const hiddenInput = document.getElementById('masterProfileIconInput');
        const customInput = document.getElementById('masterProfileCustomIconInput');
        const toggleBtn = document.getElementById('masterProfileEmojiPickerToggleBtn');
        const popover = document.getElementById('masterProfileEmojiPopover');

        const emojis = [
            "👤","🏢","🤝","🏠","✈️","💼","💳","📊","📈","📉","💰","💵","💎","🛒",
            "🏷️","🎁","🍕","☕","🍺","🍔","🚗","🚲","⚓","🚀","💡","🔧","📦","📱",
            "💻","🎨","⚽","🎯","🏆","⭐","🔥","❤️","🔒","🔑","👑","🎓","🐱","🐶",
            "🌳","🌟","☀️","🌙","⚡","🍀"
        ];

        if (popover && popover.children.length === 0) {
            emojis.forEach(emo => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = emo;
                btn.style.cssText = "font-size:18px; width:32px; height:32px; border-radius:6px; border:none; background:var(--bg-base); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform 0.1s;";
                btn.onmouseover = () => btn.style.transform = 'scale(1.2)';
                btn.onmouseout = () => btn.style.transform = 'scale(1)';
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (hiddenInput) hiddenInput.value = emo;
                    if (customInput) customInput.value = emo;
                    container.querySelectorAll('.profile-icon-swatch').forEach(b => {
                        b.style.border = '1px solid var(--border-color)';
                        b.classList.remove('active');
                    });
                    popover.style.display = 'none';
                };
                popover.appendChild(btn);
            });
        }

        if (toggleBtn && popover) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                const isOpen = popover.style.display === 'grid';
                popover.style.display = isOpen ? 'none' : 'grid';
            };
            document.addEventListener('click', (e) => {
                if (!popover.contains(e.target) && !toggleBtn.contains(e.target)) {
                    popover.style.display = 'none';
                }
            });
        }

        container.querySelectorAll('.profile-icon-swatch').forEach(btn => {
            btn.onclick = () => {
                container.querySelectorAll('.profile-icon-swatch').forEach(b => {
                    b.style.border = '1px solid var(--border-color)';
                    b.classList.remove('active');
                });
                btn.style.border = '2px solid var(--accent)';
                btn.classList.add('active');
                const val = btn.getAttribute('data-icon');
                if (hiddenInput) hiddenInput.value = val;
                if (customInput) customInput.value = '';
                if (popover) popover.style.display = 'none';
            };
        });

        if (customInput) {
            customInput.oninput = (e) => {
                const val = e.target.value.trim();
                if (val) {
                    container.querySelectorAll('.profile-icon-swatch').forEach(b => {
                        b.style.border = '1px solid var(--border-color)';
                        b.classList.remove('active');
                    });
                    if (hiddenInput) hiddenInput.value = val;
                }
            };
        }
    },

    _selectIconSwatch(iconVal) {
        this._initIconSwatches();
        const container = document.getElementById('masterProfileIconSwatches');
        const hiddenInput = document.getElementById('masterProfileIconInput');
        const customInput = document.getElementById('masterProfileCustomIconInput');

        const val = iconVal || '👤';
        if (hiddenInput) hiddenInput.value = val;

        if (container) {
            let matched = false;
            container.querySelectorAll('.profile-icon-swatch').forEach(btn => {
                const iconAttr = btn.getAttribute('data-icon');
                if (iconAttr === val) {
                    btn.style.border = '2px solid var(--accent)';
                    btn.classList.add('active');
                    matched = true;
                } else {
                    btn.style.border = '1px solid var(--border-color)';
                    btn.classList.remove('active');
                }
            });
            if (!matched && customInput) {
                customInput.value = val;
            } else if (customInput) {
                customInput.value = '';
            }
        }
    },

    _showCreateProfileModal() {
        this._editingProfileId = null;
        this._initColorSwatches();
        this._initIconSwatches();

        const titleText = document.getElementById('masterProfileModalTitleText');
        const titleIcon = document.getElementById('masterProfileModalIcon');
        const submitBtn = document.getElementById('masterProfileSubmitBtn');
        const nameInput = document.getElementById('masterProfileNameInput');
        const currSelect = document.getElementById('masterProfileCurrencySelect');
        const dateSelect = document.getElementById('masterProfileDateFormatSelect');
        const payCycleInput = document.getElementById('masterProfilePayCycleDayInput');
        const editExtraSec = document.getElementById('masterProfileEditExtraSection');
        const pinCreateSec = document.getElementById('masterProfilePinCreateSection');
        const enablePinCheck = document.getElementById('masterProfileEnablePinCheck');
        const pinCreateInput = document.getElementById('masterProfilePinCreateInput');
        const pinInputGroup = document.getElementById('masterProfilePinInputGroup');
        const errDiv = document.getElementById('masterProfileError');
        const modal = document.getElementById('masterProfileModal');

        if (titleText) titleText.textContent = window.i18n ? window.i18n.t('profiles_create_modal_title') : "Nouveau profil maître";
        if (titleIcon) titleIcon.textContent = "➕";
        if (submitBtn) submitBtn.textContent = window.i18n ? window.i18n.t('profiles_btn_create') : "Créer et ouvrir le profil";
        if (nameInput) nameInput.value = "";
        if (currSelect) currSelect.value = "EUR";
        if (dateSelect) dateSelect.value = "DD/MM/YYYY";
        if (payCycleInput) payCycleInput.value = 28;
        if (editExtraSec) editExtraSec.style.display = "none";
        if (pinCreateSec) pinCreateSec.style.display = "block";
        if (enablePinCheck) enablePinCheck.checked = false;
        if (pinCreateInput) pinCreateInput.value = "";
        if (pinInputGroup) pinInputGroup.style.display = "none";
        if (errDiv) errDiv.style.display = "none";

        this._selectIconSwatch('👤');
        this._selectColorSwatch('#6366f1');

        if (modal) {
            modal.style.display = "flex";
            if (window.i18n && window.i18n.translateDOM) {
                window.i18n.translateDOM(modal);
            }
            setTimeout(() => { if (nameInput) nameInput.focus(); }, 100);
        }
    },

    async _showEditProfileModal(profileId, currentName, currentColor, currentIcon, currentCurrency, currentPayCycleDay, currentDateFormat) {
        const activeId = window.app && window.app.activeProfileId ? window.app.activeProfileId : null;
        if (activeId && activeId !== profileId) {
            const msg = (window.i18n ? window.i18n.t('profiles_edit_active_only_err') : "Vous devez être connecté à ce profil pour le modifier.");
            if (typeof showToast === 'function') showToast(msg, "error");
            return;
        }

        // Fetch fresh profiles metadata from server to guarantee sync with restored DB settings
        try {
            const pData = await API.get('/api/profiles/');
            if (window.app) window.app.profiles = pData.profiles;
        } catch (e) {}

        const activeProf = window.app && window.app.profiles ? window.app.profiles.find(p => p.id === profileId) : null;

        this._editingProfileId = profileId;
        this._initColorSwatches();
        this._initIconSwatches();

        const titleText = document.getElementById('masterProfileModalTitleText');
        const titleIcon = document.getElementById('masterProfileModalIcon');
        const submitBtn = document.getElementById('masterProfileSubmitBtn');
        const nameInput = document.getElementById('masterProfileNameInput');
        const currSelect = document.getElementById('masterProfileCurrencySelect');
        const dateSelect = document.getElementById('masterProfileDateFormatSelect');
        const payCycleInput = document.getElementById('masterProfilePayCycleDayInput');
        const editExtraSec = document.getElementById('masterProfileEditExtraSection');
        const pinCreateSec = document.getElementById('masterProfilePinCreateSection');
        const inlinePinGroup = document.getElementById('masterProfileInlinePinBtnGroup');
        const pinStatusText = document.getElementById('masterProfilePinStatusText');
        const errDiv = document.getElementById('masterProfileError');
        const modal = document.getElementById('masterProfileModal');

        const pIcon = (activeProf ? activeProf.icon : null) || currentIcon || '👤';
        const pColor = (activeProf ? activeProf.color : null) || currentColor || '#6366f1';
        const pName = (activeProf ? activeProf.name : null) || currentName || '';
        const pCurrency = (activeProf ? activeProf.currency : null) || currentCurrency || 'EUR';
        const pPayCycleDay = (activeProf ? activeProf.pay_cycle_day : null) || currentPayCycleDay || 28;
        const pDateFormat = (activeProf ? activeProf.date_format : null) || currentDateFormat || 'DD/MM/YYYY';
        const hasPin = activeProf ? activeProf.has_pin : false;

        if (titleText) titleText.textContent = window.i18n ? window.i18n.t('profiles_edit_modal_title') : "Paramètres du profil";
        if (titleIcon) titleIcon.textContent = pIcon || "✏️";
        if (submitBtn) submitBtn.textContent = window.i18n ? window.i18n.t('profiles_btn_update') : "Mettre à jour";
        if (nameInput) nameInput.value = pName;
        if (currSelect) currSelect.value = pCurrency;
        if (dateSelect) dateSelect.value = pDateFormat;
        if (payCycleInput) payCycleInput.value = pPayCycleDay;
        if (pinCreateSec) pinCreateSec.style.display = "none";
        if (errDiv) errDiv.style.display = "none";

        if (editExtraSec) editExtraSec.style.display = "block";
        if (pinStatusText) {
            pinStatusText.textContent = hasPin 
                ? (window.i18n ? window.i18n.t('profiles_pin_status_protected') : "🔒 Profil protégé par PIN")
                : (window.i18n ? window.i18n.t('profiles_pin_status_none') : "Aucun code PIN défini pour ce profil");
        }

        if (inlinePinGroup) {
            const btnChangePin = window.i18n ? window.i18n.t('profiles_btn_change_pin') : "✏️ Modifier PIN";
            const btnRemovePin = window.i18n ? window.i18n.t('profiles_btn_remove_pin') : "🗑️ Supprimer PIN";
            const btnSetPin = window.i18n ? window.i18n.t('profiles_btn_set_pin') : "🔒 Configurer un PIN";

            if (hasPin) {
                inlinePinGroup.innerHTML = `
                    <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="window.ConfigView.closeMasterProfileModal(); window.ConfigView._showManagePinModal('${profileId}', true)">
                        ${btnChangePin}
                    </button>
                    <button type="button" class="btn btn-danger" style="font-size:11px; padding:4px 8px;" onclick="window.ConfigView.closeMasterProfileModal(); window.ConfigView._showManagePinModal('${profileId}', true)">
                        ${btnRemovePin}
                    </button>
                `;
            } else {
                inlinePinGroup.innerHTML = `
                    <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 8px;" onclick="window.ConfigView.closeMasterProfileModal(); window.ConfigView._showManagePinModal('${profileId}', false)">
                        ${btnSetPin}
                    </button>
                `;
            }
        }

        this._selectIconSwatch(pIcon);
        this._selectColorSwatch(pColor);

        if (modal) {
            modal.style.display = "flex";
            if (window.i18n && window.i18n.translateDOM) {
                window.i18n.translateDOM(modal);
            }
            setTimeout(() => { if (nameInput) nameInput.focus(); }, 100);
        }
    },

    downloadCurrentProfileBackup() {
        const activeId = window.app && window.app.activeProfileId ? window.app.activeProfileId : 'default';
        window.location.href = `/api/maintenance/backup/profile/${activeId}`;
    },

    closeMasterProfileModal() {
        const modal = document.getElementById('masterProfileModal');
        if (modal) modal.style.display = "none";

        // Restore active profile saved theme if live preview was active
        if (window.app && window.app.activeProfileId && window.app.profiles) {
            const activeProf = window.app.profiles.find(p => p.id === window.app.activeProfileId);
            if (activeProf && activeProf.color && window.app.applyProfileTheme) {
                window.app.applyProfileTheme(activeProf.color);
            }
        }
    },

    async submitMasterProfileModal() {
        const nameInput = document.getElementById('masterProfileNameInput');
        const colorInput = document.getElementById('masterProfileColorInput');
        const iconInput = document.getElementById('masterProfileIconInput');
        const currSelect = document.getElementById('masterProfileCurrencySelect');
        const dateSelect = document.getElementById('masterProfileDateFormatSelect');
        const payCycleInput = document.getElementById('masterProfilePayCycleDayInput');
        const enablePinCheck = document.getElementById('masterProfileEnablePinCheck');
        const pinCreateInput = document.getElementById('masterProfilePinCreateInput');
        const errDiv = document.getElementById('masterProfileError');

        const name = nameInput ? nameInput.value.trim() : "";
        const color = colorInput ? colorInput.value.trim() : "#6366f1";
        const icon = iconInput ? iconInput.value.trim() : "👤";
        const currency = currSelect ? currSelect.value : "EUR";
        const date_format = dateSelect ? dateSelect.value : "DD/MM/YYYY";
        const pay_cycle_day = payCycleInput ? parseInt(payCycleInput.value, 10) : 28;
        const enablePin = enablePinCheck ? enablePinCheck.checked : false;
        const pin = (enablePin && pinCreateInput) ? pinCreateInput.value.trim() : null;

        if (!name) {
            if (errDiv) {
                errDiv.textContent = "Le nom du profil est requis.";
                errDiv.style.display = "block";
            }
            return;
        }

        if (enablePin && (!pin || pin.length < 4)) {
            if (errDiv) {
                errDiv.textContent = "Le code PIN de protection doit comporter au moins 4 chiffres.";
                errDiv.style.display = "block";
            }
            return;
        }

        try {
            if (errDiv) errDiv.style.display = "none";
            if (this._editingProfileId) {
                const payload = { name, color, icon, currency, pay_cycle_day, date_format };
                await API.put(`/api/profiles/${this._editingProfileId}`, payload);
                showToast("Profil mis à jour", "success");

                if (window.app && window.app.applyProfileTheme) {
                    window.app.applyProfileTheme(color);
                }
                const modal = document.getElementById('masterProfileModal');
                if (modal) modal.style.display = "none";

                const pData = await API.get('/api/profiles/');
                if (window.app) {
                    window.app.profiles = pData.profiles;
                    if (window.app._renderProfileSelector) {
                        window.app._renderProfileSelector();
                    }
                }

                const quickPayInput = document.getElementById('quickPayDay');
                if (quickPayInput && pay_cycle_day) {
                    quickPayInput.value = pay_cycle_day;
                }

                await this._refreshProfilesPanel();
                if (window.app && window.app.refreshAll) {
                    await window.app.refreshAll();
                }
            } else {
                const payload = { name, color, icon, currency, pay_cycle_day, date_format, auto_activate: true };
                if (pin) payload.pin = pin;
                await API.post('/api/profiles/', payload);
                showToast("Nouveau profil créé — ouverture en cours...", "success");
                window.location.reload();
            }
        } catch (e) {
            if (errDiv) {
                errDiv.textContent = e.message || "Erreur lors de l'enregistrement";
                errDiv.style.display = "block";
            }
        }
    },

    _showConfigurePinModal(profileId) {
        const activeProf = window.app && window.app.profiles ? window.app.profiles.find(p => p.id === profileId) : null;
        const hasPin = activeProf ? Boolean(activeProf.has_pin) : false;
        this._showManagePinModal(profileId, hasPin);
    },

    _clearPin(profileId) {
        this._showManagePinModal(profileId, true);
    },

    _showManagePinModal(profileId, hasPin) {
        const activeId = window.app && window.app.activeProfileId ? window.app.activeProfileId : null;
        if (activeId && activeId !== profileId) {
            const msg = (window.i18n ? window.i18n.t('profiles_pin_active_only_err') : "Vous devez être connecté à ce profil pour gérer son code PIN.");
            if (typeof showToast === 'function') showToast(msg, "error");
            return;
        }

        this._pinProfileId = profileId;
        this._pinHasPin = hasPin;

        const modal = document.getElementById('masterProfilePinConfigModal');
        const currentGroup = document.getElementById('masterProfileCurrentPinGroup');
        const currentInput = document.getElementById('masterProfileCurrentPinInput');
        const newInput = document.getElementById('masterProfileNewPinInput');
        const removeBtn = document.getElementById('masterProfileRemovePinBtn');
        const titleText = document.getElementById('masterProfilePinConfigTitleText');
        const errDiv = document.getElementById('masterProfilePinConfigError');

        if (currentInput) currentInput.value = "";
        if (newInput) newInput.value = "";
        if (errDiv) errDiv.style.display = "none";

        if (hasPin) {
            if (currentGroup) currentGroup.style.display = "block";
            if (removeBtn) removeBtn.style.display = "inline-block";
            if (titleText) titleText.textContent = "Modifier la protection PIN";
        } else {
            if (currentGroup) currentGroup.style.display = "none";
            if (removeBtn) removeBtn.style.display = "none";
            if (titleText) titleText.textContent = "Configurer un code PIN";
        }

        if (modal) {
            modal.style.display = "flex";
            setTimeout(() => {
                if (hasPin && currentInput) currentInput.focus();
                else if (newInput) newInput.focus();
            }, 100);
        }
    },

    closePinConfigModal() {
        const modal = document.getElementById('masterProfilePinConfigModal');
        if (modal) modal.style.display = "none";
    },

    async submitSavePin() {
        const currentInput = document.getElementById('masterProfileCurrentPinInput');
        const newInput = document.getElementById('masterProfileNewPinInput');
        const errDiv = document.getElementById('masterProfilePinConfigError');

        const currentPin = currentInput ? currentInput.value.trim() : "";
        const newPin = newInput ? newInput.value.trim() : "";

        if (this._pinHasPin && !currentPin) {
            if (errDiv) { errDiv.textContent = "Veuillez entrer le code PIN actuel."; errDiv.style.display = "block"; }
            return;
        }

        if (!newPin || newPin.length < 4) {
            if (errDiv) { errDiv.textContent = "Le nouveau code PIN doit comporter au moins 4 chiffres."; errDiv.style.display = "block"; }
            return;
        }

        try {
            if (errDiv) errDiv.style.display = "none";
            const body = { pin: newPin };
            if (this._pinHasPin) body.current_pin = currentPin;

            await API.post(`/api/profiles/${this._pinProfileId}/pin`, body);
            showToast(this._pinHasPin ? "Code PIN modifié avec succès" : "Code PIN configuré avec succès", "success");
            this.closePinConfigModal();
            await this._refreshProfilesPanel();
            if (window.app && window.app._renderProfileSelector) {
                const pData = await API.get('/api/profiles/');
                window.app.profiles = pData.profiles;
                window.app.initAutoLock();
                window.app._renderProfileSelector();
            }
        } catch (e) {
            if (errDiv) {
                errDiv.textContent = e.message || "Erreur lors de l'enregistrement du PIN";
                errDiv.style.display = "block";
            }
        }
    },

    async submitRemovePin() {
        const currentInput = document.getElementById('masterProfileCurrentPinInput');
        const errDiv = document.getElementById('masterProfilePinConfigError');
        const currentPin = currentInput ? currentInput.value.trim() : "";

        if (!currentPin) {
            if (errDiv) { errDiv.textContent = "Veuillez entrer le code PIN actuel pour confirmer la suppression."; errDiv.style.display = "block"; }
            return;
        }

        try {
            if (errDiv) errDiv.style.display = "none";
            await API.del(`/api/profiles/${this._pinProfileId}/pin`, { current_pin: currentPin });
            showToast("Code PIN supprimé avec succès", "success");
            this.closePinConfigModal();
            await this._refreshProfilesPanel();
            if (window.app && window.app._renderProfileSelector) {
                const pData = await API.get('/api/profiles/');
                window.app.profiles = pData.profiles;
                window.app.initAutoLock();
                window.app._renderProfileSelector();
            }
        } catch (e) {
            if (errDiv) {
                errDiv.textContent = e.message || "Erreur lors de la suppression du PIN";
                errDiv.style.display = "block";
            }
        }
    },

    _deleteProfilePrompt(profileId, profileName) {
        const activeId = window.app && window.app.activeProfileId ? window.app.activeProfileId : null;
        if (activeId && activeId !== profileId) {
            const msg = (window.i18n ? window.i18n.t('profiles_delete_active_only_err') : "Vous devez être connecté à ce profil pour le supprimer.");
            if (typeof showToast === 'function') showToast(msg, "error");
            return;
        }

        this._deleteProfileId = profileId;
        const sub = document.getElementById('masterProfileDeleteSub');
        const modal = document.getElementById('masterProfileDeleteModal');

        if (sub) {
            sub.textContent = `Voulez-vous vraiment supprimer définitivement le profil « ${profileName} » et toutes ses données ? Cette action est irréversible.`;
        }

        if (modal) modal.style.display = "flex";
    },

    async submitDeleteProfile() {
        if (!this._deleteProfileId) return;
        const modal = document.getElementById('masterProfileDeleteModal');
        try {
            await API.del(`/api/profiles/${this._deleteProfileId}`);
            showToast("Profil supprimé avec succès — réorientation...", "success");
            if (modal) modal.style.display = "none";
            setTimeout(() => { window.location.reload(); }, 500);
        } catch (e) {
            showToast(e.message || "Erreur lors de la suppression du profil", "error");
        }
    },


});
