class I18nManager {
    constructor() {
        this.lang = localStorage.getItem('omni_lang') || 'fr';
        this.translations = {};
    }

    get currentLang() {
        return this.lang;
    }

    async init() {
        try {
            const response = await fetch(`/static/i18n/${this.lang}.json?v=${Date.now()}`);
            if (response.ok) {
                this.translations = await response.json();
                document.documentElement.lang = this.lang;
                this.translateDOM();
            } else {
                console.error("Failed to load translations");
            }
        } catch (e) {
            console.error("Error loading i18n", e);
        }
    }

    translateDOM(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (this.translations[key]) {
                // If it's an input with placeholder
                if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                    el.setAttribute('placeholder', this.translations[key]);
                } else {
                    el.innerHTML = this.translations[key];
                }
            }
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (this.translations[key]) el.setAttribute('title', this.translations[key]);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (this.translations[key]) el.setAttribute('placeholder', this.translations[key]);
        });
    }

    t(key, fallback = null) {
        if (this.translations[key] !== undefined && this.translations[key] !== null) {
            return this.translations[key];
        }
        return fallback !== null ? fallback : key;
    }

    tp(key, params = {}, fallback = null) {
        let str = this.translations[key];
        if (str === undefined || str === null) {
            str = fallback !== null ? fallback : key;
        }
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return str;
    }

    async setLang(lang) {
        this.lang = lang;
        localStorage.setItem('omni_lang', lang);
        await this.init();
    }
}

window.i18n = new I18nManager();
