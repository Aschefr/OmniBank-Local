class I18nManager {
    constructor() {
        this.lang = localStorage.getItem('omni_lang') || 'fr';
        this.translations = {};
        this.availableLangs = [];
        this.knownLangs = [
            { code: 'fr', flag: 'fr', label: 'Français' },
            { code: 'en', flag: 'gb', label: 'English' },
            { code: 'es', flag: 'es', label: 'Español' },
            { code: 'de', flag: 'de', label: 'Deutsch' },
            { code: 'it', flag: 'it', label: 'Italiano' },
            { code: 'pt', flag: 'pt', label: 'Português' },
            { code: 'nl', flag: 'nl', label: 'Nederlands' }
        ];
    }

    get currentLang() {
        return this.lang;
    }

    getLangInfo(code = this.lang) {
        return (this.availableLangs && this.availableLangs.find(l => l.code === code)) || 
               (this.knownLangs.find(l => l.code === code)) || 
               { code, flag: code, label: code.toUpperCase() };
    }

    async discoverLangs() {
        const found = [];
        for (const l of this.knownLangs) {
            try {
                const res = await fetch(`/static/i18n/${l.code}.json?v=${Date.now()}`, { method: 'HEAD' });
                if (res.ok) {
                    found.push(l);
                }
            } catch (e) {
                // File does not exist, ignore
            }
        }
        if (found.length === 0) {
            // Safety fallback for offline/isolated environments
            found.push({ code: 'fr', flag: 'fr', label: 'Français' });
            found.push({ code: 'en', flag: 'gb', label: 'English' });
        }
        this.availableLangs = found;
        return this.availableLangs;
    }

    async init() {
        await this.discoverLangs();
        
        // Ensure active lang exists in discovered langs, fallback to first available
        if (!this.availableLangs.some(l => l.code === this.lang)) {
            this.lang = this.availableLangs[0].code;
            localStorage.setItem('omni_lang', this.lang);
        }

        try {
            const response = await fetch(`/static/i18n/${this.lang}.json?v=${Date.now()}`);
            if (response.ok) {
                this.translations = await response.json();
                document.documentElement.lang = this.lang;
                this.translateDOM();
            } else {
                console.error("Failed to load translations for language: " + this.lang);
            }
        } catch (e) {
            console.error("Error loading i18n", e);
        }
    }

    translateDOM(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (this.translations[key]) {
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
