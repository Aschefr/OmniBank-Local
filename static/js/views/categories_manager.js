window.CategoriesView = {
    categories: [],
    
    render() {
        const types = [
            { key: 'expense_fixed', default: 'Fixed expenses' },
            { key: 'expense_var', default: 'Variable expenses' },
            { key: 'income', default: 'Income' },
            { key: 'transfer', default: 'Transfer' },
            { key: 'neutral', default: 'Neutral' }
        ];

        let typeSettingsHtml = types.map(t => `
            <div style="display:flex; flex-direction:column; gap:4px;">
                <label style="font-size:12px; color:var(--text-muted);">${t.default}</label>
                <input type="text" id="type_label_${t.key}" class="inline-input" 
                       value="${window.app.getTypeLabel(t.key)}" 
                       placeholder="${t.default}" 
                       style="border:1px solid var(--border-color); padding: 5px;">
            </div>
        `).join('');

        return `
            <div class="view-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <h2>🏷️ <span data-i18n="nav_categories">Categories</span></h2>
                <input type="text" id="categoryViewSearch" class="inline-input" placeholder="Search a category..." data-i18n-placeholder="cat_search_ph" style="min-width: 180px; max-width: 300px; padding: 8px 12px; border-radius: 8px;" oninput="window.CategoriesView.applyFilter()">
            </div>
            
            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
                    <h3 style="margin: 0;" data-i18n="cat_custom_types">Type Customization</h3>
                    <button class="btn btn-secondary" onclick="window.CategoriesView.saveTypeLabels()" data-i18n="btn_save_names">Save names</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;">
                    ${typeSettingsHtml}
                </div>
            </div>

            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                <h3 style="margin-top: 0;" data-i18n="cat_new">New Category</h3>
                <div class="categories-add-form" style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                    <input type="text" id="cat_name" class="inline-input" placeholder="${window.i18n.t('cat_name_ph') || 'Category name'}" style="flex: 1; min-width: 200px;">
                    <select id="cat_type" class="inline-input" style="width: auto;">
                        ${types.map(t => `<option value="${t.key}">${window.app.getTypeLabel(t.key)}</option>`).join('')}
                    </select>
                    <button class="btn btn-primary" onclick="window.CategoriesView.addCategory()" data-i18n="btn_add">Add</button>
                </div>
            </div>

            <div id="categoriesContainer" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; align-items: start;">
                <!-- Rendered dynamically -->
            </div>

            <!-- Edit Modal -->
            <div id="catEditModal" class="modal-overlay" style="display:none; z-index:1000;">
                <div class="modal" style="width: 400px; padding: 25px;">
                    <h3 style="margin-top:0; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:10px;" data-i18n="cat_edit">Edit Category</h3>
                    <input type="hidden" id="edit_cat_id">
                    <div style="margin-bottom: 15px;">
                        <label style="font-size:12px; color:var(--text-muted);" data-i18n="cat_edit_name">Name (will be changed everywhere!)</label>
                        <input type="text" id="edit_cat_name" class="inline-input" style="width:100%; margin-top:5px; padding:8px;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="font-size:12px; color:var(--text-muted);" data-i18n="th_type">Type</label>
                        <select id="edit_cat_type" class="inline-input" style="width:100%; margin-top:5px; padding:8px;">
                            ${types.map(t => `<option value="${t.key}">${window.app.getTypeLabel(t.key)}</option>`).join('')}
                        </select>
                    </div>
                    <div style="margin-bottom: 25px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="edit_cat_closed" style="accent-color: var(--accent); width: 16px; height: 16px;">
                            <span data-i18n="cat_close">Close this category</span>
                        </label>
                    </div>
                    <div style="display:flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn btn-secondary" onclick="document.getElementById('catEditModal').style.display='none'" data-i18n="btn_cancel">Cancel</button>
                        <button class="btn btn-primary" onclick="window.CategoriesView.saveEdit()" data-i18n="btn_save">Save</button>
                    </div>
                </div>
            </div>

            <!-- Delete / Reallocate Modal -->
            <div id="catDeleteModal" class="modal-overlay" style="display:none; z-index:1000;">
                <div class="modal" style="width: 400px; padding: 25px;">
                    <h3 style="margin-top:0; color: #ff5630; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:10px;" data-i18n="cat_delete">Delete Category</h3>
                    <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 15px;">
                        <span data-i18n="cat_reallocate_msg">What to do with existing transactions associated with</span> <strong id="del_cat_name_display"></strong> ?
                    </p>
                    <input type="hidden" id="del_cat_id">
                    
                    <div style="margin-bottom: 25px;">
                        <select id="del_reallocate_target" class="inline-input" style="width:100%; padding:8px;">
                            <option value="">${window.i18n.t('cat_no_reallocate') || 'Do not reallocate (keep old name)'}</option>
                            <!-- Filled dynamically -->
                        </select>
                    </div>

                    <div style="display:flex; justify-content: flex-end; gap: 10px;">
                        <button class="btn btn-secondary" onclick="document.getElementById('catDeleteModal').style.display='none'" data-i18n="btn_cancel">Cancel</button>
                        <button class="btn btn-danger" onclick="window.CategoriesView.confirmDelete()" data-i18n="btn_delete">Delete</button>
                    </div>
                </div>
            </div>
        `;
    },

    async init() {
        await this.loadData();
    },

    async loadData() {
        try {
            this.categories = await API.get('/api/categories/');
            this.renderTable();
        } catch (e) {
            console.error("Failed to load categories", e);
        }
    },

    applyFilter() {
        this.renderTable();
    },

    renderTable() {
        const container = document.getElementById('categoriesContainer');
        if (!container) return;
        
        let html = '';
        const searchInput = document.getElementById('categoryViewSearch');
        const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
        
        const types = ['expense_fixed', 'expense_var', 'income', 'transfer', 'neutral'];
        
        types.forEach(t => {
            let cats = this.categories.filter(c => c.type === t);
            if (search) {
                cats = cats.filter(c => c.name.toLowerCase().includes(search));
            }
            
            html += `
            <div style="background: var(--bg-surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); overflow-x: auto;">
                <h4 style="margin-top: 0; margin-bottom: 15px; color: var(--accent); display: flex; align-items: center; gap: 8px;">
                    <span style="background: rgba(51,102,255,0.1); padding: 4px 8px; border-radius: 6px;">${window.app.getTypeLabel(t)}</span>
                    <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">(${cats.length})</span>
                </h4>
                <table class="data-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th data-i18n="th_name">Name</th>
                            <th data-i18n="th_status">Status</th>
                            <th style="width: 120px; text-align: right;" data-i18n="th_actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            if (cats.length === 0) {
                html += `
                <tr>
                    <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 15px; font-style: italic;" data-i18n="cat_empty_list">${window.i18n.t('cat_empty_list') || 'No categories'}</td>
                </tr>
                `;
            } else {
                cats.forEach(cat => {
                    const isClosed = cat.is_closed;
                    const rowStyle = isClosed ? 'opacity: 0.5;' : '';
                    const statusBadge = isClosed 
                        ? `<span style="background:rgba(239,68,68,0.15); color:#ff5630; padding:2px 6px; border-radius:4px; font-size:10px;">${window.i18n.t('badge_closed_cat') || 'Closed'}</span>` 
                        : `<span style="background:rgba(16,185,129,0.15); color:#10b981; padding:2px 6px; border-radius:4px; font-size:10px;">${window.i18n.t('badge_active') || 'Active'}</span>`;
                    
                    html += `
                    <tr style="${rowStyle}">
                        <td style="padding-left: 10px;"><strong>${cat.name}</strong></td>
                        <td>${statusBadge}</td>
                        <td style="text-align: right; white-space: nowrap; overflow: visible;">
                            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.CategoriesView.openEdit(${cat.id})" title="${window.i18n.t('tooltip_edit') || 'Edit'}">✏️</button>
                            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="window.CategoriesView.toggleClose(${cat.id})" title="${isClosed ? (window.i18n.t('tooltip_reopen') || 'Reopen') : (window.i18n.t('tooltip_close') || 'Close')}">${isClosed ? '🔓' : '🔒'}</button>
                            <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="window.CategoriesView.openDelete(${cat.id})" title="${window.i18n.t('tooltip_delete') || 'Delete'}">✕</button>
                        </td>
                    </tr>
                    `;
                });
            }
            
            html += `
                    </tbody>
                </table>
            </div>
            `;
        });
        
        container.innerHTML = html;
        window.i18n.translateDOM(container);
    },

    async saveTypeLabels() {
        const types = ['expense_fixed', 'expense_var', 'income', 'transfer', 'neutral'];
        let payload = {};
        types.forEach(t => {
            const el = document.getElementById('type_label_' + t);
            if (el && el.value.trim()) {
                payload['type_label_' + t] = el.value.trim();
            }
        });
        
        const btn = document.querySelector('[onclick="window.CategoriesView.saveTypeLabels()"]');
        try {
            await API.post('/api/config/', payload);
            for(let k in payload) window.app.config[k] = payload[k];
            this.renderTable();
            if (btn) {
                const origText = btn.textContent;
                const origBg = btn.style.background;
                btn.textContent = '✓ ' + window.i18n.t('msg_saved');
                btn.style.background = 'rgba(16,185,129,0.25)';
                btn.style.color = '#10b981';
                btn.style.transition = 'all 0.3s';
                setTimeout(() => {
                    btn.textContent = origText;
                    btn.style.background = origBg;
                    btn.style.color = '';
                }, 2000);
            }
        } catch (e) {
            if (btn) {
                const origBg = btn.style.background;
                btn.style.background = 'rgba(255,86,48,0.25)';
                btn.style.color = '#ff5630';
                btn.style.animation = 'none';
                btn.offsetHeight; 
                btn.style.animation = 'shake 0.4s ease';
                setTimeout(() => {
                    btn.style.background = origBg;
                    btn.style.color = '';
                }, 2000);
            }
        }
    },

    async addCategory() {
        try {
            const data = {
                name: document.getElementById('cat_name').value.trim(),
                type: document.getElementById('cat_type').value
            };
            if (!data.name) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_name_required'));
            
            await API.post('/api/categories/', data);
            document.getElementById('cat_name').value = '';
            await this.loadData();
            window.dispatchEvent(new Event('categoriesUpdated'));
            showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_category_added'));
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_category_exists'));
        }
    },

    openEdit(id) {
        const cat = this.categories.find(c => c.id === id);
        if(!cat) return;
        document.getElementById('edit_cat_id').value = id;
        document.getElementById('edit_cat_name').value = cat.name;
        document.getElementById('edit_cat_type').value = cat.type;
        document.getElementById('edit_cat_closed').checked = cat.is_closed;
        document.getElementById('catEditModal').style.display = 'flex';
    },

    async saveEdit() {
        const id = document.getElementById('edit_cat_id').value;
        const name = document.getElementById('edit_cat_name').value.trim();
        const type = document.getElementById('edit_cat_type').value;
        const is_closed = document.getElementById('edit_cat_closed').checked;
        
        if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_name_required'));
        
        try {
            await API.put(`/api/categories/${id}`, { name, type, is_closed });
            document.getElementById('catEditModal').style.display = 'none';
            await this.loadData();
            window.dispatchEvent(new Event('categoriesUpdated'));
            showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_category_updated'));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || window.i18n.t('msg_cannot_update'));
        }
    },

    async toggleClose(id) {
        const cat = this.categories.find(c => c.id === id);
        if(!cat) return;
        try {
            await API.put(`/api/categories/${id}`, { 
                name: cat.name, 
                type: cat.type, 
                is_closed: !cat.is_closed 
            });
            await this.loadData();
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error') || "Error", e.message);
        }
    },

    openDelete(id) {
        const cat = this.categories.find(c => c.id === id);
        if(!cat) return;
        
        document.getElementById('del_cat_id').value = id;
        document.getElementById('del_cat_name_display').textContent = cat.name;
        
        const select = document.getElementById('del_reallocate_target');
        let options = `<option value="">${window.i18n.t('cat_no_reallocate') || 'Do not reallocate (keep old name)'}</option>`;
        
        this.categories.forEach(c => {
            if (c.id !== id && !c.is_closed) {
                options += `<option value="${c.name}">${window.i18n.t('cat_reallocate_to') || 'Reallocate to'} ${c.name}</option>`;
            }
        });
        select.innerHTML = options;
        
        document.getElementById('catDeleteModal').style.display = 'flex';
    },

    async confirmDelete() {
        const id = document.getElementById('del_cat_id').value;
        const target = document.getElementById('del_reallocate_target').value;
        
        let url = `/api/categories/${id}`;
        if (target) {
            url += `?reallocate_to=${encodeURIComponent(target)}`;
        }
        
        try {
            await API.del(url);
            document.getElementById('catDeleteModal').style.display = 'none';
            await this.loadData();
            window.dispatchEvent(new Event('categoriesUpdated'));
            showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_category_deleted'));
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_cannot_delete'));
        }
    }
};
