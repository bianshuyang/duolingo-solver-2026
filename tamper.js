// ==UserScript==
// @name         Duo-Interface Helper (v17.2 Sliders)
// @namespace    http://tampermonkey.net/
// @version      17.2
// @description  v17.2: Replaced text inputs with sliders (50ms steps) to fix typing issues.
// @author       You
// @match        *://*.duolingo.com/*
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let ANSWER_DATA = null;

    // --- CONFIGURATION: DEFAULTS ---
    const DEFAULT_SPEEDS = {
        TRANSLATE_WORD: 600,  // Delay between clicking words
        MATCH_FIRST: 400,     // Delay finding first pair item
        MATCH_SECOND: 1000,   // Delay finishing a pair
        SELECT_OPTION: 800    // Delay picking multiple choice
    };

    // Load from LocalStorage
    let SPEEDS = JSON.parse(localStorage.getItem('DUO_SPEEDS')) || Object.assign({}, DEFAULT_SPEEDS);

    function saveSpeeds() {
        localStorage.setItem('DUO_SPEEDS', JSON.stringify(SPEEDS));
    }

    // ==========================================
    // 1. NETWORK INTERCEPTOR
    // ==========================================
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch(...args);
        const clone = response.clone();
        if (response.url.includes('/sessions')) {
            clone.json().then(data => {
                if (data && data.challenges) {
                    const currentSize = JSON.stringify(data).length;
                    if (currentSize > 1000) {
                        ANSWER_DATA = data;
                        logToScreen(`Session Captured! (${data.challenges.length} items)`, "success");
                    }
                }
            }).catch(e => {});
        }
        return response;
    };

    // ==========================================
    // 2. UI & LOGGING
    // ==========================================
    function logToScreen(msg, type = "info") {
        const logBox = document.getElementById('duo-log-content');
        if (!logBox) return;
        const line = document.createElement('div');
        line.style.borderBottom = "1px solid #eee";
        line.style.padding = "2px 0";
        line.style.fontSize = "11px";
        line.style.fontFamily = "monospace";
        if (type === "error") line.style.color = "#e74c3c";
        else if (type === "success") line.style.color = "#27ae60";
        else line.style.color = "#34495e";
        line.innerText = `> ${msg}`;
        logBox.appendChild(line);
        logBox.scrollTop = logBox.scrollHeight;
    }

    function clearLog() {
        const logBox = document.getElementById('duo-log-content');
        if (logBox) logBox.innerHTML = '';
    }

    // ==========================================
    // 3. UTILS & SOLVER
    // ==========================================
    function normalize(text) {
        if (!text) return "";
        return String(text).replace(/(^[0-9]+)|([0-9]+$)/g, '').replace(/['"’‘“”]/g, '').replace(/[\s\u3000]+/g, '').replace(/[。、.,?!？!]/g, '').toLowerCase();
    }
    function getText(el) {
        if (!el) return "";
        const clone = el.cloneNode(true);
        clone.querySelectorAll('rt').forEach(rt => rt.remove());
        return clone.textContent.trim();
    }
    function getAllText(obj) {
        if (!obj || typeof obj !== 'object') return [];
        const keys = ['text', 'phrase', 'correctTokens', 'prompt', 'sentence', 'transliteration'];
        let found = [];
        keys.forEach(k => { if (obj[k]) found.push(String(obj[k])); });
        return found;
    }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function scan() {
        const tokens = Array.from(document.querySelectorAll('button[data-test$="-challenge-tap-token"]'));
        const choices = Array.from(document.querySelectorAll('[data-test="challenge-choice"]'));
        const header = document.querySelector('[data-test="challenge-header"]');
        let prompt = header ? getText(header) : "";
        const hints = document.querySelectorAll('[data-test="hint-token"]');
        if (hints.length) prompt = Array.from(hints).map(h => h.getAttribute('aria-label')).join('');
        return { tokens: tokens.map(getText), choices: choices.map(getText), prompt };
    }

    function findMatch(screen) {
        if (!ANSWER_DATA) { logToScreen("No Data yet...", "warn"); return null; }
        const screenP = normalize(screen.prompt);
        // Prompt Match
        let match = ANSWER_DATA.challenges.find(ch => normalize(ch.prompt) === screenP || normalize(ch.sentence) === screenP);
        if (match) return match;
        // Token Match
        if (screen.tokens.length) {
            const sToks = screen.tokens.map(normalize);
            match = ANSWER_DATA.challenges.find(ch => {
               const cToks = (ch.correctTokens || []).map(normalize);
               if (!cToks.length) return false;
               const hits = cToks.filter(t => sToks.includes(t));
               return (hits.length / cToks.length) > 0.7;
            });
            if (match) return match;
        }
        return null;
    }

    async function solve() {
        clearLog();
        const screen = scan();
        const challenge = findMatch(screen);
        if (!challenge) { logToScreen("No match found", "error"); return; }

        // Logic routing
        const isTranslate = (challenge.correctTokens || challenge.correctSolutions) && !challenge.pairs;
        const isMatch = challenge.pairs && challenge.pairs.length > 0;
        const isSelect = challenge.choices && (challenge.correctIndex !== undefined);

        if (isTranslate) {
            logToScreen("Translating...", "info");
            let words = challenge.correctTokens || challenge.correctSolutions[0].split(" ");
            let btns = Array.from(document.querySelectorAll('button[data-test$="-challenge-tap-token"]'));
            for (let w of words) {
                const bIdx = btns.findIndex(b => normalize(getText(b)) === normalize(w) && !b.disabled);
                if (bIdx > -1) {
                    btns[bIdx].click();
                    btns.splice(bIdx, 1);
                    await sleep(SPEEDS.TRANSLATE_WORD);
                }
            }
        } else if (isMatch) {
            logToScreen("Matching Pairs...", "info");
            let btns = Array.from(document.querySelectorAll('button[data-test$="-challenge-tap-token"]'));
            for (let p of challenge.pairs) {
                const pTxts = getAllText(p).map(normalize);
                let count = 0;
                for (let k=0; k<2; k++) {
                    const bIdx = btns.findIndex(b => pTxts.includes(normalize(getText(b))) && !b.disabled);
                    if (bIdx > -1) {
                        btns[bIdx].click();
                        btns.splice(bIdx, 1);
                        count++;
                        if (count===1) await sleep(SPEEDS.MATCH_FIRST);
                    }
                }
                if (count===2) await sleep(SPEEDS.MATCH_SECOND);
            }
        } else if (isSelect) {
            logToScreen("Selecting Option...", "info");
            const opts = document.querySelectorAll('[data-test="challenge-choice"]');
            const idx = challenge.correctIndex;
            if (opts[idx]) {
                opts[idx].click();
                await sleep(SPEEDS.SELECT_OPTION);
            }
        }
        logToScreen("Done.", "success");
    }

    // ==========================================
    // 4. UI CONSTRUCTION (With Sliders)
    // ==========================================
    function createUI() {
        const div = document.createElement("div");
        Object.assign(div.style, {
            position: "fixed", top: "10px", right: "10px", zIndex: "99999",
            backgroundColor: "white", padding: "10px", borderRadius: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.2)", width: "240px",
            fontFamily: "sans-serif", border: "1px solid #ccc", fontSize: "12px"
        });

        // STOP DUOLINGO KEYBOARD INTERFERENCE
        div.addEventListener('keydown', e => e.stopPropagation());
        div.addEventListener('click', e => e.stopPropagation());

        div.innerHTML = `
            <div style="text-align:center; font-weight:bold; margin-bottom:5px; border-bottom:1px solid #eee; padding-bottom:5px;">
                Duo Helper v17.2
            </div>
            <div id="duo-log-content" style="height:80px; overflow-y:auto; background:#f9f9f9; border:1px solid #eee; padding:5px; margin-bottom:8px;">
                <div style="color:#aaa;">Waiting for data...</div>
            </div>
            <button id="duo-solve-btn" style="width:100%; padding:6px; background:#2ecc71; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-bottom:10px;">
                ▶ SOLVE
            </button>
            <div style="font-weight:bold; margin-bottom:5px;">Speed Settings (ms):</div>
            <div id="duo-settings"></div>
        `;

        const settingsContainer = div.querySelector('#duo-settings');

        // Helper to build a slider
        function addSlider(label, key, min=100, max=1500) {
            const row = document.createElement('div');
            row.style.marginBottom = "8px";

            // Label + Value
            const header = document.createElement('div');
            header.style.display = "flex";
            header.style.justifyContent = "space-between";
            header.style.marginBottom = "2px";

            const nameSpan = document.createElement('span');
            nameSpan.innerText = label;

            const valSpan = document.createElement('span');
            valSpan.style.fontWeight = "bold";
            valSpan.style.color = "#3498db";
            valSpan.innerText = SPEEDS[key] + " ms";

            header.appendChild(nameSpan);
            header.appendChild(valSpan);

            // Slider
            const input = document.createElement('input');
            input.type = "range";
            input.min = min;
            input.max = max;
            input.step = "50"; // 50ms steps as requested
            input.value = SPEEDS[key];
            input.style.width = "100%";
            input.style.cursor = "pointer";

            // Events
            input.addEventListener('input', (e) => {
                // Live update visual only
                valSpan.innerText = e.target.value + " ms";
            });
            input.addEventListener('change', (e) => {
                // Save on release
                SPEEDS[key] = parseInt(e.target.value);
                saveSpeeds();
                logToScreen(`Saved ${label}: ${SPEEDS[key]}ms`);
            });

            row.appendChild(header);
            row.appendChild(input);
            settingsContainer.appendChild(row);
        }

        addSlider("Click Word", "TRANSLATE_WORD");
        addSlider("Match (Pick)", "MATCH_FIRST");
        addSlider("Match (Pair)", "MATCH_SECOND");
        addSlider("Select Opt", "SELECT_OPTION");

        document.body.appendChild(div);
        document.getElementById('duo-solve-btn').onclick = solve;
    }

    window.addEventListener('load', createUI);
    setInterval(() => { if (!document.getElementById('duo-log-content')) createUI(); }, 2500);

})();