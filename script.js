let isEvaluated = false;
const mf = document.getElementById('expression');
const resultEl = document.getElementById('result');

// 狀態變數
let isShift = false;
let isAlpha = false;
let isHyp = false;
let isSto = false;
let isRcl = false;
let angleMode = localStorage.getItem('casio_angle_mode') || 'D'; // 'D', 'R', 'G'
let defaultFormat = localStorage.getItem('casio_default_format') || 'S'; // 'S': 分數/精確優先, 'D': 小數優先
let lastExact = '';
let lastDecimal = '';
let isShowingDecimal = false;
let isShowingDMS = false;
let lastNumericVal = null;
let ansValue = 1;
let preAnsValue = 0;
let ansExact = '1';
let preAnsExact = '0';
let xAnsValue = 0;
let xAnsExact = '0';
try {
    const savedXVal = localStorage.getItem('casio_calc_xans_val');
    const savedXExact = localStorage.getItem('casio_calc_xans_exact');
    if (savedXVal !== null) xAnsValue = parseFloat(savedXVal) || 0;
    if (savedXExact !== null) xAnsExact = savedXExact;
} catch(e) {}
let engOffset = 0;

// 計算歷史 (Multi-Replay 記憶體，建議 20 次記憶以兼顧運算深度與翻閱體驗)
const MAX_HISTORY = 20;

const loadHistory = () => {
    try {
        const saved = localStorage.getItem('casio_calc_history');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                return parsed.slice(-MAX_HISTORY);
            }
        }
    } catch(e) {
        console.warn('載入計算歷史失敗', e);
    }
    return [];
};

const saveHistory = () => {
    try {
        localStorage.setItem('casio_calc_history', JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch(e) {
        console.warn('儲存計算歷史失敗', e);
    }
    try {
        const panel = typeof getHistoryPanel === 'function' ? getHistoryPanel() : null;
        if (panel && panel.style.display !== 'none') {
            renderHistoryList();
        }
    } catch(e) {}
};

let history = loadHistory();
let historyIndex = -1;
let draftExpression = '';
let isMultiSolution = false;
let resultCurrentTranslateY = 0;
let resultOverflowH = 0;

// 判斷是否可往上回溯歷史 (更舊紀錄) 或多解向上捲動
const canRecallUp = () => {
    if (isMultiSolution) return resultCurrentTranslateY < -2;
    if (history.length === 0) return false;
    if (historyIndex === -1) return true; // 當前在草稿/空白畫面，可往上叫出最新一筆
    return historyIndex > 0; // 在歷史紀錄中，上方還有更舊紀錄
};

// 判斷是否可往下瀏覽歷史 (較新紀錄或草稿) 或多解向下捲動
const canRecallDown = () => {
    if (isMultiSolution) return resultOverflowH > 2 && resultCurrentTranslateY > -(resultOverflowH - 2);
    if (history.length === 0 || historyIndex === -1) return false;
    return (historyIndex < history.length - 1) || Boolean(draftExpression && draftExpression.trim());
};

// 載入指定索引的歷史紀錄
const recallCalculation = (index) => {
    if (index < 0 || index >= history.length) return;
    if (isMultiSolution) {
        setMultiSolutionMode(false);
    }
    historyIndex = index;
    const item = history[index];
    
    if (typeof item === 'string') {
        mf.value = item;
        resultEl.value = '0';
        lastExact = '';
        lastDecimal = '';
        lastNumericVal = null;
        isShowingDecimal = false;
        isShowingDMS = false;
        engOffset = 0;
    } else {
        mf.value = item.expression || '';
        resultEl.value = item.result || '0';
        lastExact = item.lastExact || '';
        lastDecimal = item.lastDecimal || '';
        lastNumericVal = (item.lastNumericVal !== undefined) ? item.lastNumericVal : null;
        isShowingDecimal = Boolean(item.isShowingDecimal);
        isShowingDMS = Boolean(item.isShowingDMS);
        engOffset = item.engOffset || 0;
    }
    
    isEvaluated = true;
    removeHighlightBackgrounds();
    updateIndicators();
    setTimeout(() => updateResultPaging(true), 30);
};

// 向上回溯 (Older)
const handleRecallUp = () => {
    if (history.length === 0) return false;
    if (historyIndex === -1) {
        if (!isEvaluated && mf.value && mf.value.trim()) {
            draftExpression = mf.value;
        } else {
            draftExpression = '';
        }
        recallCalculation(history.length - 1);
        return true;
    } else if (historyIndex > 0) {
        recallCalculation(historyIndex - 1);
        return true;
    }
    return false;
};

// 向下前進 (Newer / Return to Draft)
const handleRecallDown = () => {
    if (history.length === 0 || historyIndex === -1) return false;
    if (historyIndex < history.length - 1) {
        recallCalculation(historyIndex + 1);
        return true;
    } else if (historyIndex === history.length - 1) {
        if (isMultiSolution) {
            setMultiSolutionMode(false);
        }
        historyIndex = -1;
        mf.value = draftExpression || '';
        resultEl.value = '0';
        lastExact = '';
        lastDecimal = '';
        lastNumericVal = null;
        isShowingDecimal = false;
        isShowingDMS = false;
        isEvaluated = false;
        draftExpression = '';
        updateIndicators();
        updateResultPaging(true);
        suppressSoftKeyboard();
        mf.focus({ preventScroll: true });
        return true;
    }
    return false;
};

// ==========================================
// 歷史紀錄彈窗視窗管理
// ==========================================
let historyMode = 'normal'; // 'normal' (檢視/帶入算式編輯) 或 'xans' (點選結果值帶入 xAns)

const getHistoryPanel = () => document.getElementById('history-panel');
const getHistoryList = () => document.getElementById('history-list');
const getHistoryTitle = () => document.getElementById('history-title');

const updateHistoryPanelPosition = () => {
    const panel = getHistoryPanel();
    const topBtns = document.querySelector('.top-buttons');
    if (topBtns && panel) {
        panel.style.top = (topBtns.offsetTop + topBtns.offsetHeight + 4) + 'px';
    }
};

const openHistoryForXAns = () => {
    historyMode = 'xans';
    showHistoryPanel();
};

const selectHistoryResultForXAns = (item) => {
    if (!item) return;

    // 取得該紀錄的結果值
    const res = typeof item === 'string' ? '' : (item.result || '');
    if (res && (res.includes('Math ERROR') || res.includes('ERROR'))) {
        return;
    }

    let numVal = null;
    let exactVal = null;

    if (typeof item === 'object') {
        if (item.lastNumericVal !== null && item.lastNumericVal !== undefined && !isNaN(item.lastNumericVal)) {
            numVal = item.lastNumericVal;
        }
        if (item.lastExact && !item.lastExact.includes('ERROR') && !item.lastExact.includes('=') && !item.lastExact.includes('\\begin{array}')) {
            exactVal = item.lastExact;
        } else if (item.result && !item.result.includes('ERROR') && !item.result.includes('=') && !item.result.includes('\\begin{array}')) {
            exactVal = item.result;
        }
    }

    if (numVal === null) {
        if (res) {
            try {
                if (ce) {
                    const parsed = ce.parse(res).evaluate();
                    const n = parsed && parsed.N ? Number(parsed.N().numericValue) : parseFloat(res);
                    if (!isNaN(n)) numVal = n;
                }
            } catch(e) {}
        }
        if (numVal === null) {
            numVal = parseFloat(res) || 0;
        }
    }

    if (!exactVal) {
        exactVal = String(numVal);
    }

    // 儲存至 xAns 全域變數與 localStorage
    xAnsValue = numVal;
    xAnsExact = exactVal;
    try {
        localStorage.setItem('casio_calc_xans_val', String(xAnsValue));
        localStorage.setItem('casio_calc_xans_exact', xAnsExact);
    } catch(e) {}

    // 關閉歷史紀錄面板
    hideHistoryPanel();

    // 帶入 LED 螢幕
    if (isEvaluated) {
        mf.value = '\\operatorname{xAns}';
        resultEl.value = '0';
        isEvaluated = false;
        historyIndex = -1;
        draftExpression = '';
        updateResultPaging(true);
    } else {
        if (!mf.value || !mf.value.trim()) {
            mf.value = '\\operatorname{xAns}';
        } else {
            insertMath('\\operatorname{xAns}');
        }
    }

    suppressSoftKeyboard();
    mf.focus({ preventScroll: true });
    mf.executeCommand('moveToMathfieldEnd');
    removeHighlightBackgrounds();
    updateIndicators();
};

const renderHistoryList = () => {
    const list = getHistoryList();
    const title = getHistoryTitle();
    if (!list) return;
    list.innerHTML = '';

    if (history.length === 0) {
        if (title) title.textContent = historyMode === 'xans' ? '歷史紀錄 (0) - 暫無結果可選' : '歷史紀錄 (0)';
        const empty = document.createElement('div');
        empty.className = 'history-empty';
        empty.textContent = historyMode === 'xans' ? '暫無可帶入 xAns 的計算歷史' : '暫無計算歷史紀錄';
        list.appendChild(empty);
        return;
    }

    if (title) {
        if (historyMode === 'xans') {
            title.textContent = `選擇 xAns 結果值 (${history.length})`;
        } else {
            title.textContent = `歷史紀錄 (${history.length})`;
        }
    }

    // 最新紀錄排在最上方
    const reversed = history.slice().reverse();
    reversed.forEach((item) => {
        const expr = typeof item === 'string' ? item : (item.expression || '');
        const res = typeof item === 'string' ? '' : (item.result || '');
        const isError = res && res.includes('ERROR');

        const card = document.createElement('div');
        card.className = 'history-item' + (historyMode === 'xans' ? ' is-xans-mode' : '');
        card.title = historyMode === 'xans' ? '點選將此計算結果值帶入 xAns' : '點選將此計算式帶入螢幕重新編輯';
        if (historyMode === 'xans' && isError) {
            card.style.opacity = '0.5';
            card.style.cursor = 'not-allowed';
        }

        // 算式欄位
        const mfExp = document.createElement('math-field');
        mfExp.className = 'history-item-exp';
        mfExp.setAttribute('read-only', '');
        mfExp.setAttribute('inputmode', 'none');
        mfExp.setAttribute('math-virtual-keyboard-policy', 'manual');
        mfExp.value = expr;
        card.appendChild(mfExp);

        // 結果欄位 (若有計算結果)
        if (res && res !== '0') {
            const resWrap = document.createElement('div');
            resWrap.className = 'history-item-res-wrapper';

            if (historyMode === 'xans' && !isError) {
                const tag = document.createElement('span');
                tag.className = 'history-item-xans-tag';
                tag.textContent = 'xAns 帶入';
                resWrap.appendChild(tag);
            }

            const eqSpan = document.createElement('span');
            eqSpan.className = 'history-item-eq';
            eqSpan.textContent = '=';
            resWrap.appendChild(eqSpan);

            const mfRes = document.createElement('math-field');
            mfRes.className = 'history-item-res';
            mfRes.setAttribute('read-only', '');
            mfRes.setAttribute('inputmode', 'none');
            mfRes.setAttribute('math-virtual-keyboard-policy', 'manual');
            mfRes.value = res;
            resWrap.appendChild(mfRes);

            card.appendChild(resWrap);
        }

        // 點選就將選中的計算式帶入led螢幕可重新編輯計算式，或在 xans 模式下將結果帶入 xAns
        card.addEventListener('click', () => {
            if (historyMode === 'xans') {
                if (!isError) {
                    selectHistoryResultForXAns(item);
                }
            } else {
                selectHistoryItem(expr);
            }
        });

        list.appendChild(card);
    });
};

const selectHistoryItem = (expr) => {
    mf.value = expr;
    resultEl.value = '';
    isEvaluated = false;
    historyIndex = -1;
    draftExpression = '';
    suppressSoftKeyboard();
    mf.focus({ preventScroll: true });
    mf.executeCommand('moveToMathfieldEnd');
    removeHighlightBackgrounds();
    updateIndicators();
    updateResultPaging(true);
    hideHistoryPanel();
};

const showHistoryPanel = () => {
    const panel = getHistoryPanel();
    if (!panel) return;
    updateHistoryPanelPosition();
    renderHistoryList();
    panel.style.display = 'flex';
};

const hideHistoryPanel = () => {
    const panel = getHistoryPanel();
    if (!panel) return;
    panel.style.display = 'none';
    historyMode = 'normal';
};

const toggleHistoryPanel = () => {
    const panel = getHistoryPanel();
    if (!panel) return;
    if (panel.style.display === 'none' || getComputedStyle(panel).display === 'none') {
        showHistoryPanel();
    } else {
        hideHistoryPanel();
    }
};

const setupHistoryPanelEvents = () => {
    const clearBtn = document.getElementById('history-clear-btn');
    const closeBtn = document.getElementById('history-close-btn');

    if (clearBtn && !clearBtn._bound) {
        clearBtn._bound = true;
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            history = [];
            historyIndex = -1;
            draftExpression = '';
            saveHistory();
            renderHistoryList();
            updateIndicators();
        });
    }

    if (closeBtn && !closeBtn._bound) {
        closeBtn._bound = true;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideHistoryPanel();
        });
    }

    // 點擊視窗外部區域自動關閉歷史紀錄
    document.addEventListener('pointerdown', (e) => {
        const panel = getHistoryPanel();
        if (!panel || panel.style.display === 'none') return;
        const historyBtn = document.querySelector('.history-btn');
        if (historyBtn && (historyBtn === e.target || historyBtn.contains(e.target))) {
            return;
        }
        if (!panel.contains(e.target)) {
            hideHistoryPanel();
        }
    });

    window.addEventListener('resize', () => {
        const panel = getHistoryPanel();
        if (panel && panel.style.display !== 'none') {
            updateHistoryPanelPosition();
        }
    });
};

// 變數記憶體 (計算機 9大變數)
const memoryVars = {
    A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, X: 0, Y: 0, M: 0
};

// 抑制手機原生軟體鍵盤 (Gboard/iOS) 與避免 MathLive 自動彈出虛擬鍵盤
const suppressSoftKeyboard = () => {
    if (mf) {
        mf.setAttribute('inputmode', 'none');
        mf.mathVirtualKeyboardPolicy = 'manual';
    }
    if (window.mathVirtualKeyboard) {
        try {
            window.mathVirtualKeyboard.policy = 'manual';
        } catch(e) {}
    }
};

// 切換虛擬鍵盤 (叫出 / 關閉)
const toggleVirtualKeyboard = () => {
    if (!window.mathVirtualKeyboard) return;
    if (window.mathVirtualKeyboard.visible) {
        window.mathVirtualKeyboard.hide();
    } else {
        mf.focus({ preventScroll: true });
        window.mathVirtualKeyboard.show();
    }
};

// 綁定虛擬鍵盤切換圖示 (點擊 toggle virtual keyboard 按鈕時召喚/收合鍵盤，平日點擊其他按鈕則不跳出)
const setupVirtualKeyboardToggle = () => {
    if (!mf || !mf.shadowRoot) return;
    const toggle = mf.shadowRoot.querySelector('[part="virtual-keyboard-toggle"]');
    if (toggle && !toggle._hasCustomToggle) {
        toggle._hasCustomToggle = true;
        const toggleHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleVirtualKeyboard();
        };
        toggle.addEventListener('pointerdown', toggleHandler);
        toggle.addEventListener('click', toggleHandler);
    }
};

// 消除根號、次方等公式編輯時的反白背景與選取高亮 (避免出現白色方塊)，並使計算結果貼近LED底緣
const removeHighlightBackgrounds = () => {
    [mf, resultEl].forEach(el => {
        if (!el) return;
        el.style.setProperty('--contains-highlight-background-color', 'transparent');
        el.style.setProperty('--selection-background-color', 'transparent');
        el.style.setProperty('--text-highlight-background-color', 'transparent');
        el.style.setProperty('--composition-background-color', 'transparent');
        el.style.setProperty('--error-background-color', 'transparent');
        
        try {
            if (el.shadowRoot) {
                let style = el.shadowRoot.querySelector('style.no-highlight');
                if (!style) {
                    style = document.createElement('style');
                    style.className = 'no-highlight';
                    el.shadowRoot.appendChild(style);
                }
                style.textContent = `
                    .ML__contains-highlight, 
                    .ML__focused .ML__contains-highlight {
                        background: transparent !important;
                        background-color: transparent !important;
                    }
                    .ML__selection, 
                    .ML__selected,
                    .ML__focused .ML__selection,
                    .ML__focused .ML__selected {
                        background: transparent !important;
                        background-color: transparent !important;
                        color: hsl(212, 40%, 49%) !important;
                    }
                    .ML__placeholder {
                        background: transparent !important;
                        background-color: transparent !important;
                    }
                    .ML__error {
                        background: transparent !important;
                        background-color: transparent !important;
                        border: none !important;
                        outline: none !important;
                    }
                    ${el === resultEl ? `
                    :host {
                        display: flex !important;
                        justify-content: flex-end !important;
                        align-items: flex-end !important;
                        padding-bottom: 0 !important;
                        margin-bottom: 0 !important;
                        overflow: visible !important;
                    }
                    :host(.is-multi-solution) {
                        align-items: flex-start !important;
                        justify-content: flex-start !important;
                    }
                    .ML__container, .ML__field-container {
                        background: transparent !important;
                        display: flex !important;
                        align-items: flex-end !important;
                        justify-content: flex-end !important;
                        padding-bottom: 0 !important;
                        margin-bottom: 0 !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }
                    :host(.is-multi-solution) .ML__container,
                    :host(.is-multi-solution) .ML__field-container {
                        align-items: flex-start !important;
                        justify-content: flex-start !important;
                    }
                    .ML__content {
                        align-self: flex-end !important;
                        padding-bottom: 0 !important;
                        margin-bottom: 0 !important;
                        overflow: visible !important;
                        will-change: transform;
                    }
                    :host(.is-multi-solution) .ML__content {
                        align-self: flex-start !important;
                    }
                    ` : `
                    .ML__content {
                        padding-top: 6px !important;
                    }
                    `}
                `;
            }
        } catch(e) {}
    });
    setupVirtualKeyboardToggle();
};

// 螢幕指示標記更新
const updateIndicators = () => {
    const indSpans = document.querySelectorAll('.indicators span');
    if (!indSpans || indSpans.length < 15) return;
    indSpans[0].style.color = isShift ? '#FFD700' : 'transparent'; // Shift S: 金色
    indSpans[1].style.color = isAlpha ? '#d83a48' : 'transparent'; // Alpha A: 紅色
    indSpans[2].style.color = memoryVars.M !== 0 ? '#111' : 'transparent';
    indSpans[3].style.color = isSto ? '#111' : 'transparent';
    indSpans[4].style.color = isRcl ? '#111' : 'transparent';
    const elD = document.getElementById('ind-d') || indSpans[9];
    const elR = document.getElementById('ind-r') || indSpans[10];
    const elG = document.getElementById('ind-g') || indSpans[11];
    if (elD) elD.style.color = angleMode === 'D' ? '#111' : 'transparent';
    if (elR) elR.style.color = angleMode === 'R' ? '#111' : 'transparent';
    if (elG) elG.style.color = angleMode === 'G' ? '#111' : 'transparent';
    const isMathActive = (defaultFormat === 'S');
    const indMath = document.getElementById('ind-math') || indSpans[14];
    if (indMath) {
        indMath.style.color = isMathActive ? '#111' : 'rgba(17, 17, 17, 0.25)';
    }

    // 方向箭頭指示標記
    const indLeft = document.querySelector('.indicators .ind-left');
    const indUp = document.querySelector('.indicators .ind-up');
    const indDown = document.querySelector('.indicators .ind-down');
    const indRight = document.querySelector('.indicators .ind-right');

    if (isMultiSolution) {
        // 多解水平指示器：左方若有未顯示內容 (translateX < -2) 則亮 ◀，右方若有未顯示內容則亮 ▶
        if (indLeft) indLeft.style.color = (resultCurrentTranslateX < -2) ? '#111' : 'transparent';
        if (indRight) indRight.style.color = (resultOverflowW > 2 && resultCurrentTranslateX > -(resultOverflowW - 2)) ? '#111' : 'transparent';
    } else if (isEvaluated && resultTotalPages > 1) {
        // 結果過長時：左方若有未顯示內容 (translateX < overflowW) 則亮 ◀，右方若有未顯示內容 (translateX > 0) 則亮 ▶
        if (indLeft) indLeft.style.color = (resultCurrentTranslateX < resultOverflowW - 3) ? '#111' : 'transparent';
        if (indRight) indRight.style.color = (resultCurrentTranslateX > 3) ? '#111' : 'transparent';
    } else {
        // 算式輸入中若超長，依 scrollLeft 指示可往左或往右捲動
        const expContent = mf && mf.shadowRoot ? mf.shadowRoot.querySelector('.ML__content') : null;
        if (expContent && expContent.scrollWidth > expContent.clientWidth + 2) {
            mf.classList.add('is-overflowing');
            if (indLeft) indLeft.style.color = expContent.scrollLeft > 2 ? '#111' : 'transparent';
            if (indRight) indRight.style.color = (expContent.scrollLeft < expContent.scrollWidth - expContent.clientWidth - 2) ? '#111' : 'transparent';
        } else {
            if (mf) mf.classList.remove('is-overflowing');
            if (indLeft) indLeft.style.color = 'transparent';
            if (indRight) indRight.style.color = 'transparent';
        }
    }
    if (indUp) indUp.style.color = canRecallUp() ? '#111' : 'transparent';
    if (indDown) indDown.style.color = canRecallDown() ? '#111' : 'transparent';
};

// 切換角度單位 D (DEG) -> R (RAD) -> G (GRA) -> D
const cycleAngleMode = (targetMode = null) => {
    if (targetMode && ['D', 'R', 'G'].includes(targetMode)) {
        angleMode = targetMode;
    } else {
        if (angleMode === 'D') angleMode = 'R';
        else if (angleMode === 'R') angleMode = 'G';
        else angleMode = 'D';
    }
    localStorage.setItem('casio_angle_mode', angleMode);
    syncAngleMode();
    updateIndicators();
};

const setupAngleIndicatorsToggle = () => {
    ['ind-d', 'ind-r', 'ind-g'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.angleBound) {
            el.dataset.angleBound = 'true';
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                cycleAngleMode();
                suppressSoftKeyboard();
            });
        }
    });
};

// 切換小數 / 自然分數永久預設模式 (點擊螢幕 Math 指示標記)
const toggleMathMode = () => {
    defaultFormat = defaultFormat === 'S' ? 'D' : 'S';
    localStorage.setItem('casio_default_format', defaultFormat);
    
    // 若當前螢幕有計算結果，同步將當前結果切換為該永久模式之表現形式
    if (isEvaluated && lastExact && lastDecimal && !lastExact.includes('ERROR')) {
        isShowingDecimal = (defaultFormat === 'D');
        resultEl.value = isShowingDecimal ? lastDecimal : lastExact;
        removeHighlightBackgrounds();
        setTimeout(() => updateResultPaging(true), 30);
    }
    updateIndicators();
};

const setupMathIndicatorToggle = () => {
    const mathInd = document.getElementById('ind-math') || document.querySelector('.indicators .ind-math') || (document.querySelectorAll('.indicators span')[14]);
    if (mathInd && !mathInd.dataset.mathBound) {
        mathInd.dataset.mathBound = 'true';
        mathInd.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleMathMode();
            suppressSoftKeyboard();
        });
    }
};

const setupIndicatorArrowClicks = () => {
    const indUp = document.querySelector('.indicators .ind-up');
    const indDown = document.querySelector('.indicators .ind-down');
    const indLeft = document.querySelector('.indicators .ind-left');
    const indRight = document.querySelector('.indicators .ind-right');

    const bind = (el, btnSel) => {
        if (el && !el.dataset.arrowBound) {
            el.dataset.arrowBound = 'true';
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const btn = document.querySelector(btnSel);
                if (btn) btn.click();
            });
        }
    };

    bind(indUp, '.d-up');
    bind(indDown, '.d-down');
    bind(indLeft, '.d-left');
    bind(indRight, '.d-right');
};

// 綁定 MathField 佔位符點擊防護與精準聚焦 (支援滑鼠點擊任意輸入方格、避免選取反白吞噬運算符或公式)
const setupPlaceholderClickGuard = () => {
    if (!mf || mf._hasPlaceholderGuard) return;
    mf._hasPlaceholderGuard = true;

    const handler = (e) => {
        const shadow = mf.shadowRoot;
        if (!shadow) return;

        // 收集目前 MathField 內部所有佔位符方格元素 (文字為 ▢ 或具 .ML__placeholder)
        const placeholders = Array.from(shadow.querySelectorAll('.ML__cmr, .ML__placeholder')).filter(s => s.textContent === '▢' || s.classList.contains('ML__placeholder'));

        const clientX = e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : null);
        const clientY = e.clientY || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : null);

        // 1. 若式子中含有 nPr (P) 或 nCr (C) 運算符
        const allSpans = Array.from(shadow.querySelectorAll('.ML__text, .ML__cmr'));
        const pSpan = allSpans.find(s => s.textContent === 'P' || s.textContent === 'C');

        if (pSpan && clientX !== null && clientX !== undefined) {
            const pRect = pSpan.getBoundingClientRect();
            // 若點擊在 P/C 右側或落在 P/C 本身（第二方格區間）
            if (clientX >= pRect.left - 4) {
                setTimeout(() => {
                    if (placeholders.length >= 2) {
                        mf.position = 0;
                        mf.executeCommand('moveToNextPlaceholder');
                        mf.executeCommand('moveToNextPlaceholder');
                    } else if (placeholders.length === 1) {
                        mf.position = 0;
                        mf.executeCommand('moveToNextPlaceholder');
                    } else {
                        mf.executeCommand('moveToMathfieldEnd');
                    }
                    removeHighlightBackgrounds();
                }, 15);
                return;
            } else if (clientX < pRect.left - 4 && placeholders.length >= 1) {
                // 若點擊在 P/C 左側（第 1 方格區間）
                setTimeout(() => {
                    mf.position = 0;
                    mf.executeCommand('moveToNextPlaceholder');
                    removeHighlightBackgrounds();
                }, 15);
                return;
            }
        }

        // 2. 一般佔位符（分數、根號、次方等）：依 2D 歐幾里得距離吸附最近方格
        if (clientX !== null && clientX !== undefined && clientY !== null && clientY !== undefined && placeholders.length > 0) {
            let closestIdx = -1;
            let minDistance = Infinity;

            placeholders.forEach((el, idx) => {
                const rect = el.getBoundingClientRect();
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const dist = Math.hypot(clientX - centerX, clientY - centerY);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIdx = idx;
                }
            });

            if (closestIdx >= 0 && minDistance < 70) {
                setTimeout(() => {
                    mf.position = 0;
                    for (let i = 0; i <= closestIdx; i++) {
                        mf.executeCommand('moveToNextPlaceholder');
                    }
                    removeHighlightBackgrounds();
                }, 15);
                return;
            }
        }

        // 3. 通用選取防護：若選取範圍異常橫跨多個字符或包含 P/C，自動收縮選取防止按鍵輸入時覆蓋整段式子
        setTimeout(() => {
            const selVal = mf.getValue(mf.selection);
            const ranges = mf.selection ? mf.selection.ranges : null;
            const isMulti = ranges && ranges.some(([s, end]) => Math.abs(end - s) > 1);
            if (isMulti || (selVal && (selVal.includes('P') || selVal.includes('C')))) {
                mf.executeCommand('collapseSelection');
            }
            removeHighlightBackgrounds();
        }, 15);
    };

    mf.addEventListener('pointerup', handler);
    mf.addEventListener('touchend', handler, { passive: true });
};


// 計算解過長分頁與即時拖曳狀態
let resultPage = 0;
let resultTotalPages = 1;
let resultOverflowW = 0;
let resultCurrentTranslateX = 0;

// 多解方程式展開模式設定
const setMultiSolutionMode = (active) => {
    isMultiSolution = Boolean(active);
    const vp = document.getElementById('result-viewport');
    const exp = document.getElementById('expression') || mf;

    if (isMultiSolution) {
        if (vp) vp.classList.add('is-multi-solution');
        if (exp) exp.classList.add('is-multi-solution');
        if (resultEl) resultEl.classList.add('is-multi-solution');
        resultCurrentTranslateY = 0;
        resultCurrentTranslateX = 0;
        resultOverflowH = 0;
        resultOverflowW = 0;
        removeHighlightBackgrounds();
        setTimeout(() => updateResultScrollBounds(true), 30);
    } else {
        if (vp) {
            vp.classList.remove('is-multi-solution', 'is-overflowing', 'is-dragging');
        }
        if (exp) exp.classList.remove('is-multi-solution');
        if (resultEl) {
            resultEl.classList.remove('is-multi-solution');
            const sr = resultEl.shadowRoot;
            const content = sr ? sr.querySelector('.ML__content') : null;
            if (content) {
                content.style.transform = '';
                content.style.transition = '';
            }
        }
        resultCurrentTranslateY = 0;
        resultCurrentTranslateX = 0;
        resultOverflowH = 0;
        resultOverflowW = 0;
        removeHighlightBackgrounds();
        updateIndicators();
    }
};

// 計算多解垂直與水平捲動範圍與指示器
const updateResultScrollBounds = (resetToZero = false) => {
    if (!resultEl) return;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    const vp = document.getElementById('result-viewport') || resultEl;

    if (!content || !isEvaluated || !isMultiSolution) {
        resultOverflowH = 0;
        resultOverflowW = 0;
        resultCurrentTranslateY = 0;
        resultCurrentTranslateX = 0;
        if (content) {
            content.style.transform = '';
            content.style.transition = '';
        }
        if (vp) vp.classList.remove('is-overflowing');
        updateIndicators();
        return;
    }

    const contentH = content.getBoundingClientRect().height;
    const contentW = content.getBoundingClientRect().width;
    const viewH = vp.clientHeight || 90;
    const viewW = resultEl.clientWidth || vp.clientWidth || 276;

    resultOverflowH = Math.max(0, contentH - viewH);
    resultOverflowW = Math.max(0, contentW - viewW);

    if (resetToZero) {
        resultCurrentTranslateY = 0;
        resultCurrentTranslateX = 0;
        content.style.transition = 'none';
        content.style.transform = 'translate(0px, 0px)';
    } else {
        resultCurrentTranslateY = Math.max(-resultOverflowH, Math.min(0, resultCurrentTranslateY));
        resultCurrentTranslateX = Math.max(-resultOverflowW, Math.min(0, resultCurrentTranslateX));
        content.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
    }

    if (resultOverflowH > 2 || resultOverflowW > 2) {
        vp.classList.add('is-overflowing');
    } else {
        vp.classList.remove('is-overflowing');
    }

    updateIndicators();
};

const scrollMultiSolutionUp = () => {
    if (!isMultiSolution || resultCurrentTranslateY >= -2) return false;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    if (!content) return false;

    resultCurrentTranslateY = Math.min(0, resultCurrentTranslateY + 28);
    content.style.transition = 'transform 0.15s ease-out';
    content.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
    updateIndicators();
    return true;
};

const scrollMultiSolutionDown = () => {
    if (!isMultiSolution || resultOverflowH <= 2 || resultCurrentTranslateY <= -(resultOverflowH - 2)) return false;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    if (!content) return false;

    resultCurrentTranslateY = Math.max(-resultOverflowH, resultCurrentTranslateY - 28);
    content.style.transition = 'transform 0.15s ease-out';
    content.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
    updateIndicators();
    return true;
};

const scrollMultiSolutionLeft = () => {
    if (!isMultiSolution || resultCurrentTranslateX >= -2) return false;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    if (!content) return false;

    const step = Math.max(60, (resultEl.clientWidth || 276) * 0.4);
    resultCurrentTranslateX = Math.min(0, resultCurrentTranslateX + step);
    content.style.transition = 'transform 0.15s ease-out';
    content.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
    updateIndicators();
    return true;
};

const scrollMultiSolutionRight = () => {
    if (!isMultiSolution || resultOverflowW <= 2 || resultCurrentTranslateX <= -(resultOverflowW - 2)) return false;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    if (!content) return false;

    const step = Math.max(60, (resultEl.clientWidth || 276) * 0.4);
    resultCurrentTranslateX = Math.max(-resultOverflowW, resultCurrentTranslateX - step);
    content.style.transition = 'transform 0.15s ease-out';
    content.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
    updateIndicators();
    return true;
};

// 更新計算解分頁狀態
const updateResultPaging = (resetToPageZero = true) => {
    if (!resultEl) return;
    if (isMultiSolution) {
        updateResultScrollBounds(resetToPageZero);
        return;
    }
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    const vp = document.getElementById('result-viewport') || resultEl;
    
    if (!content || !isEvaluated || !resultEl.value || resultEl.value === '0') {
        resultPage = 0;
        resultTotalPages = 1;
        resultOverflowW = 0;
        resultCurrentTranslateX = 0;
        if (content) {
            content.style.transform = '';
            content.style.transition = '';
        }
        if (vp) vp.classList.remove('is-overflowing');
        updateIndicators();
        return;
    }

    const contentW = content.getBoundingClientRect().width;
    const viewW = resultEl.clientWidth || 276;
    resultOverflowW = Math.max(0, contentW - viewW);

    if (resultOverflowW <= 3) {
        resultPage = 0;
        resultTotalPages = 1;
        resultCurrentTranslateX = 0;
        content.style.transform = '';
        content.style.transition = '';
        if (vp) vp.classList.remove('is-overflowing');
        updateIndicators();
        return;
    }

    if (vp) vp.classList.add('is-overflowing');

    // 計算分頁步長 (約螢幕寬度減去小幅重疊以利接續閱讀)
    const pageStep = Math.max(80, viewW - 25);
    resultTotalPages = Math.ceil(resultOverflowW / pageStep) + 1;

    if (resetToPageZero) {
        resultPage = 0;
    } else {
        resultPage = Math.max(0, Math.min(resultTotalPages - 1, resultPage));
    }

    applyResultPage(resultPage);
};

// 套用計算解分頁位移
const applyResultPage = (page) => {
    if (!resultEl) return;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    if (!content) return;

    resultPage = Math.max(0, Math.min(resultTotalPages - 1, page));

    if (resultOverflowW <= 3) {
        resultCurrentTranslateX = 0;
        content.style.transform = '';
        content.style.transition = '';
        updateIndicators();
        return;
    }

    const viewW = resultEl.clientWidth || 276;
    const pageStep = Math.max(80, viewW - 25);

    // 第 0 頁: translateX = +resultOverflowW (最左側對齊螢幕左緣)
    // 最後一頁: translateX = 0 (最右側對齊螢幕右緣)
    // 中間頁: 依 pageStep 位移
    let currentShiftFromStart = resultPage * pageStep;
    if (resultPage === resultTotalPages - 1) {
        currentShiftFromStart = resultOverflowW;
    } else {
        currentShiftFromStart = Math.min(resultOverflowW, currentShiftFromStart);
    }

    const translateX = resultOverflowW - currentShiftFromStart;
    resultCurrentTranslateX = translateX;

    content.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
    content.style.transform = `translateX(${translateX}px)`;

    updateIndicators();
};

const pageResultLeft = () => {
    if (isMultiSolution) {
        return scrollMultiSolutionLeft();
    }
    if (isEvaluated && resultTotalPages > 1) {
        if (resultPage > 0) {
            applyResultPage(resultPage - 1);
            return true;
        }
        return false; // 已在最左頁，讓後續按鍵處理可切換為進入算式編輯
    }
    return false;
};

const pageResultRight = () => {
    if (isMultiSolution) {
        return scrollMultiSolutionRight();
    }
    if (isEvaluated && resultTotalPages > 1) {
        if (resultPage < resultTotalPages - 1) {
            applyResultPage(resultPage + 1);
            return true;
        }
        return false; // 已在最右頁，讓後續按鍵處理可切換為進入算式編輯
    }
    return false;
};

// 綁定輸入區 (expression) 滑鼠與觸控拖曳捲動
const attachExpressionDrag = () => {
    if (!mf || mf._hasExpDrag) return;
    mf._hasExpDrag = true;

    const getExpContent = () => mf.shadowRoot ? mf.shadowRoot.querySelector('.ML__content') : null;

    let isExpDragging = false;
    let expStartX = 0;
    let expStartScroll = 0;
    let expMoved = false;

    const updateOverflowCursor = () => {
        const c = getExpContent();
        if (c && c.scrollWidth > c.clientWidth + 2) {
            mf.classList.add('is-overflowing');
        } else {
            mf.classList.remove('is-overflowing');
        }
    };

    const startDrag = (clientX) => {
        const c = getExpContent();
        if (!c || c.scrollWidth <= c.clientWidth + 2) return false;
        isExpDragging = true;
        expMoved = false;
        expStartX = clientX;
        expStartScroll = c.scrollLeft;
        mf.classList.add('is-dragging');
        return true;
    };

    const moveDrag = (clientX) => {
        if (!isExpDragging) return false;
        const c = getExpContent();
        if (!c) return false;
        const dx = clientX - expStartX;
        if (Math.abs(dx) > 3) {
            expMoved = true;
            c.scrollLeft = expStartScroll - dx;
            updateIndicators();
            return true;
        }
        return false;
    };

    const endDrag = () => {
        if (!isExpDragging) return;
        isExpDragging = false;
        mf.classList.remove('is-dragging');
        updateIndicators();
        updateOverflowCursor();
    };

    // 1. Pointer Events (Desktop 滑鼠與觸控通用)
    mf.addEventListener('pointerdown', (e) => {
        // 點擊鍵盤或選單按鈕時不攔截
        if (e.target && e.target.closest && (e.target.closest('[part*="toggle"]') || e.target.closest('.ML__virtual-keyboard-toggle') || e.target.closest('.ML__menu-toggle'))) {
            return;
        }
        if (startDrag(e.clientX)) {
            try { mf.setPointerCapture(e.pointerId); } catch(err) {}
        }
    });

    mf.addEventListener('pointermove', (e) => {
        if (moveDrag(e.clientX)) {
            e.preventDefault();
        }
    });

    const releasePointer = (e) => {
        if (isExpDragging) {
            try { mf.releasePointerCapture(e.pointerId); } catch(err) {}
            endDrag();
        }
    };
    mf.addEventListener('pointerup', releasePointer);
    mf.addEventListener('pointercancel', releasePointer);

    // 2. 觸控專屬支援 (確保手機瀏覽器防滑動衝突)
    mf.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
            startDrag(e.touches[0].clientX);
        }
    }, { passive: true });

    mf.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length === 1 && moveDrag(e.touches[0].clientX)) {
            e.preventDefault();
        }
    }, { passive: false });

    mf.addEventListener('touchend', endDrag, { passive: true });

    // 3. 拖曳結束防止觸發游標亂跳
    mf.addEventListener('click', (e) => {
        if (expMoved) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // 算式變更時自動偵測超長游標提示與方向指示
    mf.addEventListener('input', () => {
        setTimeout(() => {
            updateOverflowCursor();
            updateIndicators();
        }, 30);
    });
};

// 綁定輸出區 (result) 滑鼠與觸控連續拖曳與滑動分頁 / 垂直多解檢視
const attachResultDragAndSwipe = () => {
    const vp = document.getElementById('result-viewport') || resultEl;
    if (!vp || vp._hasResultDrag) return;
    vp._hasResultDrag = true;

    const getResContent = () => resultEl && resultEl.shadowRoot ? resultEl.shadowRoot.querySelector('.ML__content') : null;

    let isResDragging = false;
    let resStartX = 0;
    let resStartY = 0;
    let resStartTranslateX = 0;
    let resStartTranslateY = 0;
    let resMoved = false;

    const startDrag = (clientX, clientY) => {
        const c = getResContent();
        if (!c || !isEvaluated) return false;

        if (isMultiSolution) {
            // 只要垂直或水平任一方向有溢出，即允許拖曳
            if (resultOverflowH <= 2 && resultOverflowW <= 2) return false;
            isResDragging = true;
            resMoved = false;
            resStartX = clientX;
            resStartY = clientY;
            resStartTranslateX = resultCurrentTranslateX;
            resStartTranslateY = resultCurrentTranslateY;
            c.style.transition = 'none';
            vp.classList.add('is-dragging');
            return true;
        }

        if (resultOverflowW <= 3) return false;
        isResDragging = true;
        resMoved = false;
        resStartX = clientX;
        resStartTranslateX = resultCurrentTranslateX;
        c.style.transition = 'none'; // ⭐️ 拖曳時立即跟手
        vp.classList.add('is-dragging');
        return true;
    };

    const moveDrag = (clientX, clientY) => {
        if (!isResDragging) return false;
        const c = getResContent();
        if (!c) return false;

        if (isMultiSolution) {
            const dx = clientX - resStartX;
            const dy = clientY - resStartY;
            let moved = false;

            if (resultOverflowW > 2 && Math.abs(dx) > 1) {
                let nextX = resStartTranslateX + dx;
                nextX = Math.max(-resultOverflowW, Math.min(0, nextX));
                resultCurrentTranslateX = nextX;
                moved = true;
            }
            if (resultOverflowH > 2 && Math.abs(dy) > 1) {
                let nextY = resStartTranslateY + dy;
                nextY = Math.max(-resultOverflowH, Math.min(0, nextY));
                resultCurrentTranslateY = nextY;
                moved = true;
            }

            if (moved) {
                resMoved = true;
                c.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
                updateIndicators();
                return true;
            }
            return false;
        }

        const dx = clientX - resStartX;
        if (Math.abs(dx) > 2) {
            resMoved = true;
            let nextX = resStartTranslateX + dx;
            // 限制在 [0, resultOverflowW] 區間
            nextX = Math.max(0, Math.min(resultOverflowW, nextX));
            resultCurrentTranslateX = nextX;
            c.style.transform = `translateX(${nextX}px)`;
            updateIndicators();
            return true;
        }
        return false;
    };

    const endDrag = (clientX, clientY) => {
        if (!isResDragging) return;
        isResDragging = false;
        vp.classList.remove('is-dragging');
        const c = getResContent();
        if (!c) return;

        if (isMultiSolution) {
            c.style.transition = 'transform 0.15s cubic-bezier(0.2, 0, 0, 1)';
            resultCurrentTranslateX = Math.max(-resultOverflowW, Math.min(0, resultCurrentTranslateX));
            resultCurrentTranslateY = Math.max(-resultOverflowH, Math.min(0, resultCurrentTranslateY));
            c.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
            updateIndicators();
            return;
        }

        c.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';

        // 依放開時的位置同步 resultPage
        const viewW = resultEl.clientWidth || 276;
        const pageStep = Math.max(80, viewW - 25);
        if (resultCurrentTranslateX >= resultOverflowW - 10) {
            resultPage = 0;
        } else if (resultCurrentTranslateX <= 10) {
            resultPage = resultTotalPages - 1;
        } else {
            resultPage = Math.max(0, Math.min(resultTotalPages - 1, Math.round((resultOverflowW - resultCurrentTranslateX) / pageStep)));
        }

        updateIndicators();
    };

    // 1. Pointer Events (Desktop 與 Mobile)
    vp.addEventListener('pointerdown', (e) => {
        if (startDrag(e.clientX, e.clientY)) {
            try { vp.setPointerCapture(e.pointerId); } catch(err) {}
        }
    });

    vp.addEventListener('pointermove', (e) => {
        if (moveDrag(e.clientX, e.clientY)) {
            e.preventDefault();
        }
    });

    const releasePointer = (e) => {
        if (isResDragging) {
            try { vp.releasePointerCapture(e.pointerId); } catch(err) {}
            endDrag(e.clientX, e.clientY);
        }
    };
    vp.addEventListener('pointerup', releasePointer);
    vp.addEventListener('pointercancel', releasePointer);

    // 2. Touch Events (Mobile 專屬防滾動)
    vp.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    vp.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length === 1 && moveDrag(e.touches[0].clientX, e.touches[0].clientY)) {
            e.preventDefault();
        }
    }, { passive: false });

    vp.addEventListener('touchend', (e) => {
        const clientX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : resStartX;
        const clientY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : resStartY;
        endDrag(clientX, clientY);
    }, { passive: true });

    // 3. 滾輪支援 (桌面端滾動多解)
    vp.addEventListener('wheel', (e) => {
        if (!isMultiSolution) return;
        const c = getResContent();
        if (!c) return;

        let handled = false;
        if (resultOverflowH > 2 && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX || 0)) {
            e.preventDefault();
            const step = e.deltaY > 0 ? -28 : 28;
            resultCurrentTranslateY = Math.max(-resultOverflowH, Math.min(0, resultCurrentTranslateY + step));
            handled = true;
        } else if (resultOverflowW > 2) {
            e.preventDefault();
            const delta = (Math.abs(e.deltaX) > 0) ? e.deltaX : e.deltaY;
            const step = delta > 0 ? -35 : 35;
            resultCurrentTranslateX = Math.max(-resultOverflowW, Math.min(0, resultCurrentTranslateX + step));
            handled = true;
        }

        if (handled) {
            c.style.transition = 'transform 0.1s ease-out';
            c.style.transform = `translate(${resultCurrentTranslateX}px, ${resultCurrentTranslateY}px)`;
            updateIndicators();
        }
    }, { passive: false });
};

attachExpressionDrag();
attachResultDragAndSwipe();
window.addEventListener('resize', () => updateResultPaging(false));

window.addEventListener('load', () => {
    suppressSoftKeyboard();
    removeHighlightBackgrounds();
    setupVirtualKeyboardToggle();
    setupMathIndicatorToggle();
    setupAngleIndicatorsToggle();
    setupIndicatorArrowClicks();
    setupPlaceholderClickGuard();
    updateIndicators();
});

if (mf) {
    suppressSoftKeyboard();
    removeHighlightBackgrounds();
    setupVirtualKeyboardToggle();
    setupMathIndicatorToggle();
    setupAngleIndicatorsToggle();
    setupIndicatorArrowClicks();
    setupPlaceholderClickGuard();
    mf.addEventListener('focus', () => {
        suppressSoftKeyboard();
        removeHighlightBackgrounds();
    });
    mf.addEventListener('touchstart', () => {
        suppressSoftKeyboard();
        removeHighlightBackgrounds();
    }, { passive: true });
}

// 預設展示式與歷史初始狀態
if (history.length === 0) {
    mf.value = '\\int_0^{\\frac{\\pi}{2}} \\cos(x) dx';
    resultEl.value = '1';
    isEvaluated = true;
    lastExact = '1';
    lastDecimal = '1';
    lastNumericVal = 1;
    ansValue = 1;
    preAnsValue = 0;
    ansExact = '1';
    preAnsExact = '0';
    history = [{
        expression: mf.value,
        result: resultEl.value,
        lastExact: lastExact,
        lastDecimal: lastDecimal,
        lastNumericVal: lastNumericVal,
        isShowingDecimal: false,
        isShowingDMS: false,
        engOffset: 0
    }];
    saveHistory();
    historyIndex = 0;
} else {
    // 恢復最新一筆計算
    recallCalculation(history.length - 1);
}
removeHighlightBackgrounds();

// 初始化 ComputeEngine
let ce;
const syncAngleMode = () => {
    if (ce) {
        ce.angularUnit = angleMode === 'D' ? 'deg' : (angleMode === 'R' ? 'rad' : 'grad');
    }
};

if (window.ComputeEngine) {
    ce = new window.ComputeEngine.ComputeEngine();
    syncAngleMode();
}

mf.addEventListener('input', () => {
    if (isMultiSolution) {
        setMultiSolutionMode(false);
    }
    isEvaluated = false;
    historyIndex = -1;
    draftExpression = '';
    isShowingDMS = false;
    updateIndicators();
    updateResultPaging(true);
});

const insertMath = (latex) => {
    if (isMultiSolution) {
        setMultiSolutionMode(false);
    }
    if (isEvaluated) {
        // 若運算完畢直接按四則運算符號或平方，自動延續 Ans
        const isOp = ['+', '-', '\\times ', '\\div ', '/', '^2', '^{#0}', '^{-1}'].includes(latex);
        if (isOp) {
            mf.value = '\\operatorname{Ans}';
        } else {
            mf.value = '';
        }
        isEvaluated = false;
        historyIndex = -1;
        draftExpression = '';
        isShowingDMS = false;
        updateIndicators();
        updateResultPaging(true);
    }
    suppressSoftKeyboard();
    mf.focus({ preventScroll: true });
    mf.insert(latex);
    removeHighlightBackgrounds();
    if (window.mathVirtualKeyboard) {
        try { window.mathVirtualKeyboard.hide(); } catch(e) {}
    }
};

// 度分秒 (DMS) 轉換函數
const toDMS = (val) => {
    const sign = val < 0 ? '-' : '';
    const abs = Math.abs(val);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 100) / 100;
    return sign + d + '^{\\circ}' + m + '\'' + s + '\'\'';
};

// 浮點數轉換為最簡分數演算法 (連分數演算法)
const floatToFraction = (val, maxDenom = 100000) => {
    if (!Number.isFinite(val)) return null;
    const sign = val < 0 ? -1 : 1;
    val = Math.abs(val);
    if (Math.abs(val - Math.round(val)) < 1e-9) {
        return { num: sign * Math.round(val), den: 1 };
    }
    let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
    let b = val;
    let iter = 0;
    while (iter++ < 20) {
        let a = Math.floor(b);
        let aux = h1;
        h1 = a * h1 + h2;
        h2 = aux;
        aux = k1;
        k1 = a * k1 + k2;
        k2 = aux;
        if (Math.abs(val - h1 / k1) < 1e-8 || k1 > maxDenom) break;
        if (Math.abs(b - a) < 1e-12) break;
        b = 1 / (b - a);
    }
    if (Math.abs(val - h1 / k1) < 1e-6 && k1 <= maxDenom) {
        return { num: sign * h1, den: k1 };
    }
    return null;
};

// 帶分數 (a b/c) 與假分數 (d/c) 雙向互相切換函數 (對應 Shift + S<=>D 功能)
const toggleMixedImproper = (currentValStr, numericVal) => {
    if (!currentValStr) return currentValStr;
    let str = currentValStr.trim();
    if (str.includes('ERROR') || str.includes('=')) return str;
    
    // 若包含 \sqrt, \pi, \sin 等非有理分數特殊符號，則不轉換帶分數
    if (/\\[a-zA-Z]+/.test(str.replace(/\\frac/g, ''))) return str;

    // 1. 若目前為帶分數：{a}\frac{b}{c} 或 -{a}\frac{b}{c}
    const mixedMatch = str.match(/^(-)?\s*\{?(\d+)\}?\s*\\frac\{(\d+)\}\{(\d+)\}$/);
    if (mixedMatch) {
        const sign = mixedMatch[1] === '-' ? '-' : '';
        const a = parseInt(mixedMatch[2], 10);
        const b = parseInt(mixedMatch[3], 10);
        const c = parseInt(mixedMatch[4], 10);
        const improperNum = a * c + b;
        return (sign === '-' ? '-\\frac{' : '\\frac{') + improperNum + '}{' + c + '}';
    }

    // 2. 若目前為假分數：\frac{N}{D} 或 -\frac{N}{D}
    const improperMatch = str.match(/^(-)?\s*\\frac\{(-?\d+)\}\{(\d+)\}$/);
    if (improperMatch) {
        let isNeg = (improperMatch[1] === '-') ^ (parseInt(improperMatch[2], 10) < 0);
        const sign = isNeg ? '-' : '';
        const num = Math.abs(parseInt(improperMatch[2], 10));
        const den = parseInt(improperMatch[3], 10);
        if (den === 0) return str;
        if (num >= den && den > 1) {
            const a = Math.floor(num / den);
            const b = num % den;
            if (b === 0) {
                return (sign === '-' ? '-' : '') + a;
            }
            return (sign === '-' ? '-{' : '{') + a + '}\\frac{' + b + '}{' + den + '}';
        }
        return str;
    }

    // 3. 若目前為小數或數值形式，先換算為最簡分數後轉為帶分數
    if (numericVal !== null && Number.isFinite(numericVal)) {
        const frac = floatToFraction(numericVal);
        if (frac && frac.den > 1) {
            const sign = frac.num < 0 ? '-' : '';
            const num = Math.abs(frac.num);
            const den = frac.den;
            if (num >= den) {
                const a = Math.floor(num / den);
                const b = num % den;
                if (b === 0) return String(frac.num);
                return (sign === '-' ? '-{' : '{') + a + '}\\frac{' + b + '}{' + den + '}';
            } else {
                return (sign === '-' ? '-\\frac{' : '\\frac{') + num + '}{' + den + '}';
            }
        }
    }

    return str;
};

// 核心計算求值函數
const evaluateExpression = () => {
    if (!mf.value || !mf.value.trim()) return;
    try {
        if (!ce) {
            resultEl.value = '\\text{載入中...}';
            return;
        }
        setMultiSolutionMode(false);
        syncAngleMode();

        let rawLatex = mf.value;

        // 1. 替換 Ans、PreAns 與 xAns (包含解開被意外包裹在 \text{...} 內的 Ans/運算式，並消除任何前綴如 \operatorname, \mathrm, \text)
        const ansSubVal = (ansExact && !ansExact.includes('ERROR') && !ansExact.includes('=')) ? ansExact : ansValue;
        const preAnsSubVal = (preAnsExact && !preAnsExact.includes('ERROR') && !preAnsExact.includes('=')) ? preAnsExact : preAnsValue;
        const xAnsSubVal = (xAnsExact && !xAnsExact.includes('ERROR') && !xAnsExact.includes('=')) ? xAnsExact : xAnsValue;

        const replaceAnsToken = (str, tokenName, subVal) => {
            let res = str;
            const strVal = String(subVal);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            
            // 1.1 若包裹在 \text{...} 且包含其他運算子，先解開
            res = res.replace(/\\text\{([^{}]*?)\}/g, (match, inner) => {
                if (new RegExp('\\b' + tokenName + '\\b', 'i').test(inner) && /[\/\+\-\*]|\\div|\\times/.test(inner)) {
                    return inner;
                }
                return match;
            });

            // 1.2 反覆剝除任何可能巢狀包裹在變數外層的格式前綴 (\operatorname, \mathrm, \text, \mathbf, \mathit 等)
            // 例如 MathLive 常見的 \operatorname{\mathrm{Ans}} 或 {\operatorname{\mathrm{Ans}}}
            // 關鍵：替換時前後加上空格，確保與前方指令 (如 \times, \div 等) 保持間距，避免粘連成 \timesAns 或 \divAns
            const reWrapper = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s*\\{\\s*' + tokenName + '\\s*\\}', 'gi');
            const reNoBraces = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s+' + tokenName + '\\b', 'gi');
            let prev;
            do {
                prev = res;
                res = res.replace(reWrapper, ' ' + tokenName + ' ');
                res = res.replace(reNoBraces, ' ' + tokenName + ' ');
            } while (res !== prev);

            // 1.3 隱式乘法處理：
            // 若變數前面緊鄰數字或右括號 (例如 3Ans 或 )Ans)，自動補上乘號 \times
            const reImplicitBefore = new RegExp('([0-9.]|\\)|\\\\right\\))\\s*' + tokenName + '\\b', 'gi');
            res = res.replace(reImplicitBefore, '$1\\times ' + tokenName);

            // 若變數後面緊鄰數字或左括號 (例如 Ans3 或 Ans()，自動補上乘號 \times
            const reImplicitAfter = new RegExp('\\b' + tokenName + '\\s*([0-9.]|\\(|\\\\left\\()', 'gi');
            res = res.replace(reImplicitAfter, tokenName + '\\times $1');

            // 1.4 變數已徹底純淨化，替換為數值 (若純數值則不額外加括號，負數或算式才加 \left( \right))
            const rePlain = new RegExp('\\b' + tokenName + '\\b', 'gi');
            res = res.replace(rePlain, ' ' + wrappedVal + ' ');
            return res;
        };

        let mathStr = replaceAnsToken(rawLatex, 'PreAns', preAnsSubVal);
        mathStr = replaceAnsToken(mathStr, 'xAns', xAnsSubVal);
        mathStr = replaceAnsToken(mathStr, 'Ans', ansSubVal);

        // 1.6 解開任何殘留於 \text{...} 內的四則運算子與斜線除號
        mathStr = mathStr.replace(/\\text\{([^{}]*?)\}/g, (match, inner) => {
            if (/[\/\+\-\*]|\\div|\\times/.test(inner)) {
                return inner;
            }
            return match;
        });

        // 1.7 正規化帶分數輸入 {a}\frac{b}{c} 或 a\frac{b}{c} 為 \left(a + \frac{b}{c}\right)
        mathStr = mathStr.replace(/(?:\{(\d+)\}|(?<![\\a-zA-Z0-9])(\d+))\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (match, w1, w2, num, den) => {
            const whole = w1 || w2;
            return '\\left(' + whole + '+\\frac{' + num + '}{' + den + '}\\right)';
        });

        // 2. 替換乘除符號 (確保星號與斜線皆對應標準運算式)
        mathStr = mathStr
            .replace(/\\textasteriskcenter/g, '\\times ')
            .replace(/\*/g, '\\times ')
            .replace(/\\ast/g, '\\times ')
            .replace(/\\text\{\/\}/g, '\\div ')
            .replace(/\//g, (match, offset, str) => (offset > 0 && str[offset - 1] === '\\') ? match : '\\div ');

        // 3. 隨機數替換 (RanInt#, Ran#)
        // 3.1 RanInt# 替換（支援兩參數 RanInt#(min, max) 或單參數 RanInt#(max)，支援 \left(、hash、\# 等各種 MathLive 格式）
        const ranIntSeparator = /,(?:\\[,;:!]|\\quad|\\qquad|\\enspace|\s)*/;
        const parseRangeNum = (str, fallback) => {
            if (!str) return fallback;
            let s = str.replace(/\\placeholder\{[^}]*\}/g, '')
                       .replace(/\\left|\\right|[{}]/g, '')
                       .replace(/\\[,;:!]/g, '')
                       .replace(/\\quad|\\qquad|\\enspace/g, '')
                       .replace(/[#?]/g, '')
                       .trim();
            if (!s) return fallback;
            if (ce) {
                try {
                    let parsed = ce.parse(s).evaluate();
                    let num = Number(parsed.numericValue);
                    if (!isNaN(num)) return Math.round(num);
                } catch(e) {}
            }
            let n = parseInt(s, 10);
            return isNaN(n) ? fallback : n;
        };

        const ranIntRegex = /(?:\\(?:operatorname|text|mathrm))?\s*\{?\s*RanInt\s*(?:\\#|#|\\?hash)?\s*\}?\s*(?:\\#|#|\\?hash)?\s*(?:\\left)?\s*\(\s*([^)]+?)\s*(?:\\right)?\s*\)/gi;
        mathStr = mathStr.replace(ranIntRegex, (match, inner) => {
            const parts = inner.split(ranIntSeparator);
            if (parts.length >= 2) {
                const v1 = parseRangeNum(parts[0], 1);
                const v2 = parseRangeNum(parts[1], 6);
                const min = Math.min(v1, v2);
                const max = Math.max(v1, v2);
                const rand = Math.floor(Math.random() * (max - min + 1)) + min;
                return '(' + rand + ')';
            } else {
                let n = parseRangeNum(parts[0], 6);
                const min = n >= 1 ? 1 : n;
                const max = n >= 1 ? n : 1;
                const rand = Math.floor(Math.random() * (max - min + 1)) + min;
                return '(' + rand + ')';
            }
        });

        // 3.2 Ran# 替換（0~0.999 隨機小數，支援 Ran#、Ran\#、Ranhash 等）
        const ranRegex = /(?:\\(?:operatorname|text|mathrm))?\s*\{?\s*Ran\s*(?:\\#|#|\\?hash)?\s*\}?\s*(?:\\#|#|\\?hash)?/gi;
        mathStr = mathStr.replace(ranRegex, () => {
            return '(' + (Math.floor(Math.random() * 1000) / 1000) + ')';
        });

        // 4. 極座標 / 直角座標轉換 (Pol, Rec)
        const polMatch = mathStr.match(/(?:\\operatorname\{Pol\}|Pol)(?:\\left)?\s*\(\s*([^,)]+?)\s*(?:,|\\,)\s*([^,)]+?)\s*(?:\\right)?\s*\)/i);
        if (polMatch) {
            const x = Number(ce.parse(polMatch[1]).evaluate().N().numericValue);
            const y = Number(ce.parse(polMatch[2]).evaluate().N().numericValue);
            if (!isNaN(x) && !isNaN(y)) {
                const r = Math.hypot(x, y);
                let theta = Math.atan2(y, x);
                let unit = '';
                if (angleMode === 'D') {
                    theta = theta * 180 / Math.PI;
                    unit = '^{\\circ}';
                } else if (angleMode === 'G') {
                    theta = theta * 200 / Math.PI;
                    unit = '\\text{g}';
                }
                const rRound = Math.round(r * 100000000) / 100000000;
                const thRound = Math.round(theta * 100000000) / 100000000;
                lastExact = 'r=' + rRound + ',\\ \\theta=' + thRound + unit;
                lastDecimal = lastExact;
                lastNumericVal = r;
                preAnsValue = ansValue;
                ansValue = r;
                preAnsExact = ansExact;
                ansExact = String(r);
                resultEl.value = lastExact;
                isEvaluated = true;
                return;
            }
        }

        const recMatch = mathStr.match(/(?:\\operatorname\{Rec\}|Rec)(?:\\left)?\s*\(\s*([^,)]+?)\s*(?:,|\\,)\s*([^,)]+?)\s*(?:\\right)?\s*\)/i);
        if (recMatch) {
            const r = Number(ce.parse(recMatch[1]).evaluate().N().numericValue);
            let theta = Number(ce.parse(recMatch[2]).evaluate().N().numericValue);
            if (!isNaN(r) && !isNaN(theta)) {
                if (angleMode === 'D') theta = theta * Math.PI / 180;
                else if (angleMode === 'G') theta = theta * Math.PI / 200;
                const x = r * Math.cos(theta);
                const y = r * Math.sin(theta);
                const xRound = Math.round(x * 100000000) / 100000000;
                const yRound = Math.round(y * 100000000) / 100000000;
                lastExact = 'X=' + xRound + ',\\ Y=' + yRound;
                lastDecimal = lastExact;
                lastNumericVal = x;
                preAnsValue = ansValue;
                ansValue = x;
                preAnsExact = ansExact;
                ansExact = String(x);
                resultEl.value = lastExact;
                isEvaluated = true;
                return;
            }
        }

        // 5. 排列 nPr 與 組合 nCr 格式轉換
        // 5.0 預防性修正：若數值意外合併於 \text{P...} 或 \text{C...} 內，自動分離
        mathStr = mathStr.replace(/(?:\\(?:text|mathrm|mathbf|operatorname)\s*\{\s*([PC])([0-9.]+)\s*\})/g, '\\text{$1}{$2}');

        // 若開頭或運算符後缺少前置 n 運算元 (例如直接輸入 P2 或 C3)，自動補上 Ans 作為前置運算元
        mathStr = mathStr.replace(/(^|[+\-*/(])\s*(?:\\(?:text|mathrm|mathbf|operatorname|mathbin)\s*\{\s*(?:\\mathrm\s*\{\s*)?([PC])(?:\s*\})?\s*\}|\b([PC])\b)\s*(?:\{([^{}]+)\}|\(([^()]+)\)|([0-9.]+))/g, (m, prefix, op1, op2, r1, r2, r3) => {
            const op = op1 || op2;
            const r = (r1 || r2 || r3 || '').trim();
            return `${prefix}\\operatorname{Ans}\\text{${op}}{${r}}`;
        });

        // 5.1 上下標格式相容支援 (例如 {}^{n}\text{P}_{r} 或 {}_{n}\text{P}_{r})
        const pOpPattern = '(?:\\\\(?:text|mathrm|mathbf|operatorname|mathbin)\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*)?P(?:\\s*\\})?\\s*\\}|\\bP\\b)';
        const cOpPattern = '(?:\\\\(?:text|mathrm|mathbf|operatorname|mathbin)\\s*\\{\\s*(?:\\\\mathrm\\s*\\{\\s*)?C(?:\\s*\\})?\\s*\\}|\\bC\\b)';

        mathStr = mathStr.replace(new RegExp('\\{?\\s*(?:\\^\\{([^{}]+)\\}\\s*\\_\\{([^{}]+)\\}|\\_\\{([^{}]+)\\}\\s*\\^\\{([^{}]+)\\})\\s*\\}?\\s*' + pOpPattern, 'g'), (m, n1, r1, r2, n2) => {
            const n = (n1 || n2 || '').trim();
            const r = (r1 || r2 || '').trim();
            return `\\frac{(${n})!}{((${n})-(${r}))!}`;
        });
        mathStr = mathStr.replace(new RegExp(pOpPattern + '\\s*(?:\\^\\{([^{}]+)\\}\\s*\\_\\{([^{}]+)\\}|\\_\\{([^{}]+)\\}\\s*\\^\\{([^{}]+)\\})', 'g'), (m, n1, r1, r2, n2) => {
            const n = (n1 || n2 || '').trim();
            const r = (r1 || r2 || '').trim();
            return `\\frac{(${n})!}{((${n})-(${r}))!}`;
        });
        mathStr = mathStr.replace(new RegExp('\\{?\\s*(?:\\^\\{([^{}]+)\\}\\s*\\_\\{([^{}]+)\\}|\\_\\{([^{}]+)\\}\\s*\\^\\{([^{}]+)\\})\\s*\\}?\\s*' + cOpPattern, 'g'), (m, n1, r1, r2, n2) => {
            const n = (n1 || n2 || '').trim();
            const r = (r1 || r2 || '').trim();
            return `\\binom{${n}}{${r}}`;
        });
        mathStr = mathStr.replace(new RegExp(cOpPattern + '\\s*(?:\\^\\{([^{}]+)\\}\\s*\\_\\{([^{}]+)\\}|\\_\\{([^{}]+)\\}\\s*\\^\\{([^{}]+)\\})', 'g'), (m, n1, r1, r2, n2) => {
            const n = (n1 || n2 || '').trim();
            const r = (r1 || r2 || '').trim();
            return `\\binom{${n}}{${r}}`;
        });

        // 5.2 行內雙方格與標準格式支援 (包含 {n}\text{P}{r}, n\text{P}r, (n)\text{P}(r) 等)
        const opReP = new RegExp('(?:\\{([^{}]+)\\}|\\(([^()]+)\\)|([0-9.]+))\\s*' + pOpPattern + '\\s*(?:\\{([^{}]+)\\}|\\(([^()]+)\\)|([0-9.]+))', 'g');
        const opReC = new RegExp('(?:\\{([^{}]+)\\}|\\(([^()]+)\\)|([0-9.]+))\\s*' + cOpPattern + '\\s*(?:\\{([^{}]+)\\}|\\(([^()]+)\\)|([0-9.]+))', 'g');

        mathStr = mathStr.replace(opReP, (m, n1, n2, n3, r1, r2, r3) => {
            const n = (n1 || n2 || n3 || '').trim();
            const r = (r1 || r2 || r3 || '').trim();
            if (n.includes('placeholder') || r.includes('placeholder') || !n || !r) {
                return '\\text{ERROR}';
            }
            if (!isNaN(Number(n)) && !isNaN(Number(r))) {
                const numN = Number(n);
                const numR = Number(r);
                if (numN < numR || numN < 0 || numR < 0 || !Number.isInteger(numN) || !Number.isInteger(numR)) {
                    return '\\text{ERROR}';
                }
            }
            return `\\frac{(${n})!}{((${n})-(${r}))!}`;
        });

        mathStr = mathStr.replace(opReC, (m, n1, n2, n3, r1, r2, r3) => {
            const n = (n1 || n2 || n3 || '').trim();
            const r = (r1 || r2 || r3 || '').trim();
            if (n.includes('placeholder') || r.includes('placeholder') || !n || !r) {
                return '\\text{ERROR}';
            }
            if (!isNaN(Number(n)) && !isNaN(Number(r))) {
                const numN = Number(n);
                const numR = Number(r);
                if (numN < numR || numN < 0 || numR < 0 || !Number.isInteger(numN) || !Number.isInteger(numR)) {
                    return '\\text{ERROR}';
                }
            }
            return `\\binom{${n}}{${r}}`;
        });

        if (mathStr.includes('\\text{ERROR}')) {
            throw new Error('Math ERROR');
        }

        // 6. 百分比計算處理 (%)
        // 先將所有形式的百分比標記統一為標準的 %
        mathStr = mathStr.replace(/(?:\\text\s*\{\s*\\?%\s*\}|\\%)/g, '%');

        // 6.1 處理加減百分比 (例如 100 + 10% => 110, 100 - 10% => 90)
        mathStr = mathStr.replace(/(^|[^0-9.%])([0-9.]+)\s*([+-])\s*([0-9.]+)%/g, (match, prefix, a, op, b) => {
            return `${prefix}${a} ${op} \\left(${a} \\times \\frac{${b}}{100}\\right)`;
        });

        // 6.2 處理括號後接百分比: (expr)% 或 \left(expr\right)%
        mathStr = mathStr.replace(/(?:\\left\((.*?)\\right\)|\(([^()]+)\))%/g, (m, p1, p2) => {
            const inner = p1 || p2;
            return `\\left(\\frac{${inner}}{100}\\right)`;
        });

        // 6.3 處理分數後接百分比: \frac{a}{b}%
        mathStr = mathStr.replace(/(\\frac\{[^{}]+\}\{[^{}]+\})%/g, (m, frac) => {
            return `\\left(\\frac{${frac}}{100}\\right)`;
        });

        // 6.4 處理一般數值或變數後接百分比: 50%, 2.5%, Ans%
        mathStr = mathStr.replace(/([0-9.]+|[A-Za-z]+)%/g, (m, num) => {
            return `\\left(\\frac{${num}}{100}\\right)`;
        });

        // 6.5 安全清理任何單獨殘留的 %
        mathStr = mathStr.replace(/%/g, '\\times \\frac{1}{100}');

        // 7. 解方程式 (SOLVE 功能，含等號 =)
        if (mathStr.includes('=')) {
            let eqExpr = ce.parse(mathStr);
            let solutions = null;
            try {
                solutions = eqExpr.solve('X');
                if (!solutions || solutions.length === 0) {
                    solutions = eqExpr.solve('x');
                }
                if (!solutions || solutions.length === 0) {
                    solutions = eqExpr.solve();
                }
            } catch(e) {}

            if (solutions && solutions.length > 0) {
                // 若為多個實數解，依數值大小升序排序 (x_1 <= x_2 <= ...)
                try {
                    const allReal = solutions.every(s => s.N && !isNaN(Number(s.N().numericValue)));
                    if (allReal && solutions.length > 1) {
                        solutions.sort((a, b) => Number(a.N().numericValue) - Number(b.N().numericValue));
                    }
                } catch(e) {}

                const formatSol = (s, isDec) => {
                    if (isDec && s.N) {
                        try {
                            const nVal = Number(s.N().numericValue);
                            if (!isNaN(nVal)) {
                                return String(Math.round(nVal * 10000000000) / 10000000000);
                            }
                        } catch(e) {}
                    }
                    return s.latex || String(s);
                };

                if (solutions.length === 1) {
                    const ex = formatSol(solutions[0], false);
                    const dec = formatSol(solutions[0], true);
                    lastExact = 'x = ' + ex;
                    lastDecimal = 'x = ' + dec;
                    setMultiSolutionMode(false);
                } else {
                    const exactRows = solutions.map((s, idx) => `x_{${idx + 1}} = ${formatSol(s, false)}`);
                    const decimalRows = solutions.map((s, idx) => `x_{${idx + 1}} = ${formatSol(s, true)}`);
                    lastExact = '\\begin{array}{l} ' + exactRows.join(' \\\\ ') + ' \\end{array}';
                    lastDecimal = '\\begin{array}{l} ' + decimalRows.join(' \\\\ ') + ' \\end{array}';
                    setMultiSolutionMode(true);
                }

                let firstVal = Number(solutions[0].N ? solutions[0].N().numericValue : solutions[0]);
                if (!isNaN(firstVal)) {
                    lastNumericVal = firstVal;
                    memoryVars.X = firstVal;
                    preAnsValue = ansValue;
                    ansValue = firstVal;
                    preAnsExact = ansExact;
                    ansExact = String(firstVal);
                }
                resultEl.value = (defaultFormat === 'D' && lastDecimal) ? lastDecimal : lastExact;
                isEvaluated = true;
                removeHighlightBackgrounds();
                updateIndicators();
                setTimeout(() => updateResultPaging(true), 40);
                return;
            }
        }

        // 8. 替換非方程式中的記憶體變數 (A, B, C, D, E, F, Y, M，若非微分/積分亦替換 X)
        ['A', 'B', 'C', 'D', 'E', 'F', 'Y', 'M'].forEach(v => {
            const reWrapper = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s*\\{\\s*' + v + '\\s*\\}', 'gi');
            const reNoBraces = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s+' + v + '\\b', 'gi');
            let prev;
            do {
                prev = mathStr;
                mathStr = mathStr.replace(reWrapper, ' ' + v + ' ');
                mathStr = mathStr.replace(reNoBraces, ' ' + v + ' ');
            } while (mathStr !== prev);

            // 隱式乘法支援 (如 3A 或 )A 自動補 \times)
            mathStr = mathStr.replace(new RegExp('([0-9.]|\\)|\\\\right\\))\\s*' + v + '\\b', 'g'), '$1\\times ' + v);
            mathStr = mathStr.replace(new RegExp('\\b' + v + '\\s*([0-9.]|\\(|\\\\left\\()', 'g'), v + '\\times $1');

            const reg = new RegExp('\\b' + v + '\\b', 'g');
            const strVal = String(memoryVars[v]);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            mathStr = mathStr.replace(reg, ' ' + wrappedVal + ' ');
        });
        if (!mathStr.includes('dx') && !mathStr.includes('\\frac{d}{dx}')) {
            const reWrapper = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s*\\{\\s*X\\s*\\}', 'gi');
            const reNoBraces = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s+X\\b', 'gi');
            let prev;
            do {
                prev = mathStr;
                mathStr = mathStr.replace(reWrapper, ' X ');
                mathStr = mathStr.replace(reNoBraces, ' X ');
            } while (mathStr !== prev);

            mathStr = mathStr.replace(/([0-9.]|\)|\\right\))\s*X\b/g, '$1\\times X');
            mathStr = mathStr.replace(/\bX\s*([0-9.]|\(|\\left\()/g, 'X\\times $1');

            const strVal = String(memoryVars.X);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            mathStr = mathStr.replace(/\bX\b/g, ' ' + wrappedVal + ' ');
        }

        // 9. 使用 Compute Engine 計算
        const expr = ce.parse(mathStr);
        let evalExpr = null;
        let latexRes = '';
        try {
            evalExpr = expr.evaluate();
            latexRes = evalExpr.latex;
        } catch(e) {}

        let numVal = null;
        try {
            let res = (evalExpr || expr).N().numericValue;
            if (res !== undefined && res !== null) {
                if (typeof res === 'number') numVal = res;
                else if (res.decimal !== undefined) numVal = Number(res);
                else if (res.num !== undefined) numVal = Number(res.num);
                else if (!isNaN(Number(res))) numVal = Number(res);
            }
        } catch(e) {}

        if (!latexRes || latexRes === 'Error') {
            if (numVal !== null) {
                latexRes = String(Math.round(numVal * 10000000000) / 10000000000);
            }
        }

        if (numVal !== null && Number.isFinite(numVal)) {
            if (Number.isInteger(numVal)) {
                // 若為整數，確保移除小數尾數 (例如 ComputeEngine 輸出 20.0 或 75.0)
                latexRes = String(numVal);
            } else {
                // 若 latexRes 為純小數或純數字，嘗試透過連分數演算法轉為精確最簡分數
                const isPureDecimal = !latexRes || (!latexRes.includes('\\frac') && !latexRes.includes('\\sqrt') && !latexRes.includes('\\pi') && !latexRes.includes('\\times 10'));
                if (isPureDecimal) {
                    const frac = floatToFraction(numVal);
                    if (frac && frac.den > 1) {
                        const sign = frac.num < 0 ? '-' : '';
                        latexRes = (sign === '-' ? '-\\frac{' : '\\frac{') + Math.abs(frac.num) + '}{' + frac.den + '}';
                    }
                }
            }
        }

        if (latexRes) {
            lastExact = latexRes;
        } else {
            lastExact = '\\text{Math ERROR}';
        }

        if (numVal !== null) {
            lastNumericVal = numVal;
            lastDecimal = String(Math.round(numVal * 10000000000) / 10000000000);
            preAnsValue = ansValue;
            ansValue = numVal;
            preAnsExact = ansExact;
            ansExact = (latexRes && !latexRes.includes('ERROR') && !latexRes.includes('=')) ? latexRes : String(numVal);
        } else {
            lastNumericVal = null;
            lastDecimal = '';
        }

        engOffset = 0;
        isShowingDecimal = (defaultFormat === 'D');
        isShowingDMS = false;

        // 根據預設模式決定呈現分數(S)或小數(D)
        resultEl.value = (defaultFormat === 'D' && lastDecimal) ? lastDecimal : lastExact;
        removeHighlightBackgrounds();
        isEvaluated = true;

        // 加入歷史記錄 (避免重複堆疊)
        const newRecord = {
            expression: rawLatex,
            result: resultEl.value,
            lastExact: lastExact,
            lastDecimal: lastDecimal,
            lastNumericVal: lastNumericVal,
            isShowingDecimal: isShowingDecimal,
            isShowingDMS: isShowingDMS,
            engOffset: engOffset
        };

        const lastRec = history.length > 0 ? history[history.length - 1] : null;
        const isDuplicate = lastRec && 
            (typeof lastRec === 'object' ? (lastRec.expression === rawLatex && lastRec.result === resultEl.value) : lastRec === rawLatex);

        if (!isDuplicate) {
            history.push(newRecord);
            if (history.length > MAX_HISTORY) {
                history.shift();
            }
            saveHistory();
        }

        historyIndex = history.length - 1;
        draftExpression = '';

        isShift = false;
        isAlpha = false;
        isHyp = false;
        isSto = false;
        isRcl = false;
        updateIndicators();
        setTimeout(() => updateResultPaging(true), 40);
    } catch(e) {
        resultEl.value = '\\text{Math ERROR}';
        isEvaluated = true;
        const errRecord = {
            expression: rawLatex,
            result: '\\text{Math ERROR}',
            lastExact: '\\text{Math ERROR}',
            lastDecimal: '',
            lastNumericVal: null,
            isShowingDecimal: false,
            isShowingDMS: false,
            engOffset: 0
        };
        const lastRec = history.length > 0 ? history[history.length - 1] : null;
        const isDuplicate = lastRec && 
            (typeof lastRec === 'object' ? (lastRec.expression === rawLatex && lastRec.result === errRecord.result) : lastRec === rawLatex);
        if (!isDuplicate) {
            history.push(errRecord);
            if (history.length > MAX_HISTORY) {
                history.shift();
            }
            saveHistory();
        }
        historyIndex = history.length - 1;
        draftExpression = '';
        updateIndicators();
        setTimeout(() => updateResultPaging(true), 40);
    }
};

// 鍵盤按鈕點擊事件
document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });
    btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
    });

    btn.addEventListener('click', () => {
        let val = btn.getAttribute('data-val');
        if (!val) return;

        // 1. 處理 STO (儲存變數)
        if (isSto) {
            const varMap = {
                'minus': 'A', 'deg': 'B', 'hyp': 'C',
                'sin': 'D', 'cos': 'E', 'tan': 'F',
                'rparen': 'X', 'sd': 'Y', 'mplus': 'M'
            };
            const varName = varMap[val];
            if (varName) {
                const saveVal = lastNumericVal !== null ? lastNumericVal : ansValue;
                memoryVars[varName] = saveVal;
                resultEl.value = '\\text{Ans} \\to ' + varName + ' = ' + saveVal;
                isSto = false;
                isShift = false;
                updateIndicators();
                return;
            }
            isSto = false;
            updateIndicators();
        }

        // 2. 處理 RCL (讀取變數)
        if (isRcl) {
            const varMap = {
                'minus': 'A', 'deg': 'B', 'hyp': 'C',
                'sin': 'D', 'cos': 'E', 'tan': 'F',
                'rparen': 'X', 'sd': 'Y', 'mplus': 'M'
            };
            const varName = varMap[val];
            if (varName) {
                const readVal = memoryVars[varName];
                insertMath(String(readVal));
                isRcl = false;
                updateIndicators();
                return;
            }
            isRcl = false;
            updateIndicators();
        }

        // 3. 狀態切換鍵
        if (val === 'shift') {
            isShift = !isShift;
            if (isShift) isAlpha = false;
            updateIndicators();
            return;
        }
        if (val === 'alpha') {
            isAlpha = !isAlpha;
            if (isAlpha) isShift = false;
            updateIndicators();
            return;
        }
        if (val === 'hyp') {
            if (isAlpha) {
                insertMath('C');
                isAlpha = false;
                updateIndicators();
                return;
            }
            isHyp = !isHyp;
            return;
        }
        if (val === 'vkey' || val === 'mode') {
            if (isShift) {
                // SHIFT + V-key (SETUP 功能)：切換永久預設輸出格式 S (MathO) 或 D (LineIO/小數)
                toggleMathMode();
                isShift = false;
                updateIndicators();
                return;
            }
            toggleVirtualKeyboard();
            return;
        }

        // 4. 重置與清除
        if (val === 'ac') {
            setMultiSolutionMode(false);
            mf.value = '';
            resultEl.value = '0';
            isEvaluated = false;
            isShift = false;
            isAlpha = false;
            isHyp = false;
            isSto = false;
            isRcl = false;
            isShowingDMS = false;
            historyIndex = -1;
            draftExpression = '';
            hideHistoryPanel();
            updateIndicators();
            updateResultPaging(true);
            suppressSoftKeyboard();
            mf.focus({ preventScroll: true });
            return;
        }

        // 5. 歷史紀錄視窗 (History 按鍵)
        if (val === 'history') {
            isShift = false;
            isAlpha = false;
            updateIndicators();
            historyMode = 'normal';
            toggleHistoryPanel();
            return;
        }

        if (val === 'del') {
            if (isMultiSolution) {
                setMultiSolutionMode(false);
            }
            if (isEvaluated) {
                mf.value = '';
                resultEl.value = '0';
                isEvaluated = false;
                historyIndex = -1;
                draftExpression = '';
                updateIndicators();
                updateResultPaging(true);
            } else {
                mf.executeCommand('deleteBackward');
            }
            return;
        }

        // 5. CLR (Shift + 9)
        if (val === '9' && isShift) {
            setMultiSolutionMode(false);
            Object.keys(memoryVars).forEach(k => memoryVars[k] = 0);
            ansValue = 0;
            preAnsValue = 0;
            ansExact = '0';
            preAnsExact = '0';
            xAnsValue = 0;
            xAnsExact = '0';
            try {
                localStorage.removeItem('casio_calc_xans_val');
                localStorage.removeItem('casio_calc_xans_exact');
            } catch(e) {}
            history = [];
            historyIndex = -1;
            draftExpression = '';
            saveHistory();
            resultEl.value = '\\text{Reset All}';
            isShift = false;
            updateIndicators();
            updateResultPaging(true);
            return;
        }

        // 6. STO 與 RCL 觸發
        if (val === 'rcl') {
            if (isShift) {
                isSto = true;
                isRcl = false;
                isShift = false;
                updateIndicators();
                return;
            }
            isRcl = true;
            isSto = false;
            updateIndicators();
            return;
        }

        // 7. M+ / M- (記憶體加減)
        if (val === 'mplus') {
            if (isAlpha) {
                insertMath('M');
                isAlpha = false;
                updateIndicators();
                return;
            }
            if (!isEvaluated) {
                evaluateExpression();
            }
            const currentVal = lastNumericVal !== null ? lastNumericVal : ansValue;
            if (isShift) {
                memoryVars.M -= currentVal;
            } else {
                memoryVars.M += currentVal;
            }
            resultEl.value = 'M = ' + (Math.round(memoryVars.M * 10000000000) / 10000000000);
            isShift = false;
            updateIndicators();
            return;
        }

        // 8. CALC 與 SOLVE
        if (val === 'calc') {
            if (isAlpha) {
                insertMath('=');
                isAlpha = false;
                updateIndicators();
                return;
            }
            evaluateExpression();
            return;
        }

        // 9. 等號 =
        if (val === '=') {
            evaluateExpression();
            return;
        }

        // 10. S<=>D (精確 / 小數切換) 及 SHIFT + S<=>D (帶分數 a b/c <=> 假分數 d/c 切換)
        if (val === 'sd') {
            if (isAlpha) {
                insertMath('Y');
                isAlpha = false;
                updateIndicators();
                return;
            }
            if (isShift) {
                // SHIFT + S<=>D：切換帶分數 (a b/c) 與假分數 (d/c)
                if (!isEvaluated && mf.value && mf.value.trim()) {
                    evaluateExpression();
                }
                if (isEvaluated && resultEl.value) {
                    const currentDisplayed = resultEl.value;
                    const converted = toggleMixedImproper(currentDisplayed, lastNumericVal);
                    if (converted !== currentDisplayed) {
                        resultEl.value = converted;
                        lastExact = converted;
                        ansExact = converted;
                        isShowingDecimal = false;
                        removeHighlightBackgrounds();
                    }
                }
                isShift = false;
                updateIndicators();
                setTimeout(() => updateResultPaging(true), 30);
                return;
            }
            if (isEvaluated) {
                // 若 lastExact 尚未具備分數表現 (或與小數相同)，且存在數值，自動換算最簡分數
                if ((!lastExact || lastExact === lastDecimal || !lastExact.includes('\\frac')) && lastNumericVal !== null && Number.isFinite(lastNumericVal)) {
                    const frac = floatToFraction(lastNumericVal);
                    if (frac && frac.den > 1) {
                        const sign = frac.num < 0 ? '-' : '';
                        lastExact = (sign === '-' ? '-\\frac{' : '\\frac{') + Math.abs(frac.num) + '}{' + frac.den + '}';
                        ansExact = lastExact;
                    }
                }

                if (lastExact && lastDecimal) {
                    isShowingDecimal = !isShowingDecimal;
                    resultEl.value = isShowingDecimal ? lastDecimal : lastExact;
                    removeHighlightBackgrounds();
                    updateIndicators();
                    setTimeout(() => updateResultPaging(true), 30);
                }
            }
            return;
        }

        // 11. ENG (工程科學記號轉換)
        if (val === 'eng' && !isAlpha) {
            if (isEvaluated && lastNumericVal !== null) {
                if (lastNumericVal === 0) {
                    resultEl.value = '0 \\times 10^{0}';
                } else {
                    if (isShift) {
                        engOffset += 3;
                    } else {
                        engOffset -= 3;
                    }
                    const sign = lastNumericVal < 0 ? -1 : 1;
                    const absVal = Math.abs(lastNumericVal);
                    const exp = Math.floor(Math.log10(absVal));
                    const baseExp = Math.floor(exp / 3) * 3;
                    const finalExp = baseExp + engOffset;
                    let mantissa = (sign * absVal) / Math.pow(10, finalExp);
                    mantissa = Math.round(mantissa * 100000000) / 100000000;
                    resultEl.value = mantissa + ' \\times 10^{' + finalExp + '}';
                }
                isShowingDecimal = true;
                isShift = false;
                updateIndicators();
                setTimeout(() => updateResultPaging(true), 30);
            }
            return;
        }

        // 12. 度分秒 DMS (°'”) 轉換
        if (val === 'deg') {
            if (isAlpha) {
                insertMath('B');
                isAlpha = false;
                updateIndicators();
                return;
            }
            if (isEvaluated && lastNumericVal !== null) {
                isShowingDMS = !isShowingDMS;
                resultEl.value = isShowingDMS ? toDMS(lastNumericVal) : (isShowingDecimal ? lastDecimal : lastExact);
                setTimeout(() => updateResultPaging(true), 30);
                return;
            }
        }

        // 13. Ans 鍵的 ALPHA (xAns) 處理：叫出歷史紀錄視窗選擇結果值
        if (val === 'ans' && isAlpha) {
            isAlpha = false;
            updateIndicators();
            openHistoryForXAns();
            return;
        }

        // 14. 一般符號、Shift 符號與 Alpha 符號插入
        let latex = val;

        // SHIFT 映射表
        const shiftMap = {
            'integral': '\\frac{d}{dx}(#0)',
            'inv': '!',
            'logbase': '10^{#0}',
            'pow': '\\sqrt[#0]{#?}',
            'frac': '{#0}\\frac{#?}{#?}',
            'sqrt': '\\sqrt[3]{#0}',
            'sqr': '^3',
            'log': '10^{#0}',
            'ln': 'e^{#0}',
            'sin': isHyp ? '\\operatorname{arsinh}(#0)' : '\\arcsin(#0)',
            'cos': isHyp ? '\\operatorname{arcosh}(#0)' : '\\arccos(#0)',
            'tan': isHyp ? '\\operatorname{artanh}(#0)' : '\\arctan(#0)',
            'lparen': '\\%',
            'rparen': ',',
            '*': '{#0}\\text{P}{#?}',
            '/': '{#0}\\text{C}{#?}',
            '+': '\\operatorname{Pol}(#0,#?)',
            '-': '\\operatorname{Rec}(#0,#?)',
            '0': '\\operatorname{Rnd}(#0)',
            '.': '\\operatorname{Ran\\#}',
            'exp': '\\pi',
            'ans': '\\operatorname{PreAns}',
            '7': '299792458' // 光速 c (計算機 CONST)
        };

        // ALPHA 映射表
        const alphaMap = {
            'minus': 'A',
            'deg': 'B',
            'hyp': 'C',
            'sin': 'D',
            'cos': 'E',
            'tan': 'F',
            'rparen': 'X',
            'sd': 'Y',
            'mplus': 'M',
            'exp': 'e',
            '.': '\\operatorname{RanInt\\#}(1, 6)'
        };

        // 預設映射表
        const defaultMap = {
            'frac': '\\frac{#0}{#?}',
            'sqrt': '\\sqrt{#0}',
            'sqr': '^2',
            'pow': '^{#0}',
            'sin': isHyp ? '\\sinh(#0)' : '\\sin(#0)',
            'cos': isHyp ? '\\cosh(#0)' : '\\cos(#0)',
            'tan': isHyp ? '\\tanh(#0)' : '\\tan(#0)',
            'ln': '\\ln(#0)',
            'log': '\\log(#0)',
            'logbase': '\\log_{#0}(#?)',
            'inv': '^{-1}',
            'deg': '^{\\circ}',
            'ans': '\\operatorname{Ans}',
            'lparen': '(',
            'rparen': ')',
            '*': '\\times ',
            '/': '\\div ',
            '+': '+',
            '-': '-',
            'minus': '-',
            'exp': '\\times 10^{#0}',
            'integral': '\\int_{#?}^{#?} #0 \\,dx'
        };

        if (isShift && shiftMap[val]) {
            latex = shiftMap[val];
        } else if (isAlpha && alphaMap[val]) {
            latex = alphaMap[val];
        } else if (defaultMap[val]) {
            latex = defaultMap[val];
        }

        // nPr 與 nCr 兩輸入方格智慧前置運算元選取 (若游標前已輸入數值/變數，自動帶入第 1 方格)
        if (isShift && (val === '*' || val === '/')) {
            const currentSel = mf.getValue(mf.selection);
            if (!currentSel || currentSel.trim() === '') {
                const posBefore = mf.position;
                mf.executeCommand('extendToPreviousWord');
                const prevWord = mf.getValue(mf.selection);
                if (prevWord && (/^[\d.]+$/.test(prevWord.trim()) || /^(?:Ans|PreAns|xAns|[A-F]|X|Y|M|\\operatorname\{Ans\})$/i.test(prevWord.trim()))) {
                    // 保留選取以自動填入第一方格 {#0}
                } else {
                    // 非前置運算元則還原游標位置，產生兩空白方格
                    mf.position = posBefore;
                }
            }
        }

        insertMath(latex);

        // 重置按鍵修飾狀態
        if (isShift || isAlpha || isHyp) {
            isShift = false;
            isAlpha = false;
            isHyp = false;
            updateIndicators();
        }
    });
});

// 實體鍵盤對應表
const keyMap = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
    '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    '.': '.',
    '+': '+', '-': '-', '*': '*', '/': '/',
    'Enter': '=', '=': '=',
    'Escape': 'ac',
    '(': 'lparen', ')': 'rparen',
    '^': 'pow',
    's': 'sin', 'c': 'cos', 't': 'tan',
    'S': 'sin', 'C': 'cos', 'T': 'tan',
    '!': 'inv'
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const panel = getHistoryPanel();
        if (panel && panel.style.display !== 'none') {
            hideHistoryPanel();
            e.preventDefault();
            return;
        }
    }

    if (e.key === '%') {
        e.preventDefault();
        insertMath('\\%');
        return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
        const btn = document.querySelector('.btn[data-val="del"]');
        if (btn) {
            btn.classList.add('active-sim');
            setTimeout(() => btn.classList.remove('active-sim'), 100);
        }
        return; 
    }
    
    if (e.key === 'ArrowLeft') {
        const btn = document.querySelector('.d-left');
        if (btn) {
            btn.click();
            btn.classList.add('active-sim');
            setTimeout(() => btn.classList.remove('active-sim'), 100);
            e.preventDefault();
            return;
        }
    } else if (e.key === 'ArrowRight') {
        const btn = document.querySelector('.d-right');
        if (btn) {
            btn.click();
            btn.classList.add('active-sim');
            setTimeout(() => btn.classList.remove('active-sim'), 100);
            e.preventDefault();
            return;
        }
    } else if (e.key === 'ArrowUp') {
        if (canRecallUp()) {
            e.preventDefault();
            const btn = document.querySelector('.d-up');
            if (btn) {
                btn.click();
                btn.classList.add('active-sim');
                setTimeout(() => btn.classList.remove('active-sim'), 100);
            }
            return;
        }
    } else if (e.key === 'ArrowDown') {
        if (canRecallDown()) {
            e.preventDefault();
            const btn = document.querySelector('.d-down');
            if (btn) {
                btn.click();
                btn.classList.add('active-sim');
                setTimeout(() => btn.classList.remove('active-sim'), 100);
            }
            return;
        }
    }
    
    if (e.key.startsWith('Arrow')) return;

    if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        const btn = document.querySelector('.btn[data-val="="]');
        if (btn) {
            btn.click();
            btn.classList.add('active-sim');
            setTimeout(() => btn.classList.remove('active-sim'), 100);
        }
        return;
    }

    const val = keyMap[e.key];
    if (val) {
        const btn = document.querySelector('.btn[data-val="' + val + '"]');
        if (btn) {
            btn.classList.add('active-sim');
            setTimeout(() => btn.classList.remove('active-sim'), 100);
            
            if (['sin', 'cos', 'tan', 'inv'].includes(val)) {
                e.preventDefault();
                btn.click();
            }
        }
    }
});

// 方向鍵 (D-Pad) 與歷史回溯
const attachDPad = () => {
    const dUp = document.querySelector('.d-up');
    const dDown = document.querySelector('.d-down');
    const dLeft = document.querySelector('.d-left');
    const dRight = document.querySelector('.d-right');
    
    [dUp, dDown, dLeft, dRight].forEach(el => {
        if (el) {
            el.addEventListener('mousedown', e => e.preventDefault());
            el.addEventListener('pointerdown', e => e.preventDefault());
        }
    });

    if (dUp) dUp.addEventListener('click', () => {
        if (isMultiSolution) {
            if (scrollMultiSolutionUp()) return;
        }
        if (isEvaluated || historyIndex >= 0 || !mf.value || !mf.value.trim()) {
            if (handleRecallUp()) {
                return;
            }
        }
        suppressSoftKeyboard();
        mf.focus({ preventScroll: true });
        mf.executeCommand('moveToPreviousLine');
    });

    if (dDown) dDown.addEventListener('click', () => {
        if (isMultiSolution) {
            if (scrollMultiSolutionDown()) return;
        }
        if (isEvaluated || historyIndex >= 0 || !mf.value || !mf.value.trim()) {
            if (handleRecallDown()) {
                return;
            }
        }
        suppressSoftKeyboard();
        mf.focus({ preventScroll: true });
        mf.executeCommand('moveToNextLine');
    });

    if (dLeft) dLeft.addEventListener('click', () => {
        if (pageResultLeft()) {
            return;
        }
        suppressSoftKeyboard();
        mf.focus({ preventScroll: true });
        if (isEvaluated) {
            if (isMultiSolution) {
                setMultiSolutionMode(false);
            }
            isEvaluated = false;
            historyIndex = -1;
            draftExpression = '';
            updateIndicators();
            mf.executeCommand('moveToMathfieldEnd');
        } else {
            mf.executeCommand('moveToPreviousChar');
        }
    });

    if (dRight) dRight.addEventListener('click', () => {
        if (pageResultRight()) {
            return;
        }
        suppressSoftKeyboard();
        mf.focus({ preventScroll: true });
        if (isEvaluated) {
            if (isMultiSolution) {
                setMultiSolutionMode(false);
            }
            isEvaluated = false;
            historyIndex = -1;
            draftExpression = '';
            updateIndicators();
            mf.executeCommand('moveToMathfieldStart');
        } else {
            mf.executeCommand('moveToNextChar');
        }
    });
};
attachDPad();

// PWA 一鍵安裝提示條監聽
let deferredPrompt = null;
const installBanner = document.getElementById('pwa-install-banner');
const installBtn = document.getElementById('pwa-install-btn');
const installClose = document.getElementById('pwa-install-close');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBanner) {
        installBanner.style.display = 'flex';
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        if (installBanner) installBanner.style.display = 'none';
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('PWA 安裝選擇結果:', outcome);
        deferredPrompt = null;
    });
}

if (installClose) {
    installClose.addEventListener('click', () => {
        if (installBanner) installBanner.style.display = 'none';
    });
}

window.addEventListener('appinstalled', () => {
    if (installBanner) installBanner.style.display = 'none';
    deferredPrompt = null;
    console.log('PWA 已成功安裝至主畫面');
});

// 將虛擬鍵盤 (toggle virtual keyboard) 與選單 (menu) 的 tooltip 格式改為與 MATH 相同的原生 title 提示
const setupTogglesTooltip = () => {
    const applyTooltips = () => {
        if (!mf || !mf.shadowRoot) return false;
        const toggle = mf.shadowRoot.querySelector('[part*="virtual-keyboard-toggle"]');
        const menu = mf.shadowRoot.querySelector('[part*="menu-toggle"]');
        if (!toggle) return false;

        if (toggle) {
            toggle.removeAttribute('data-tooltip');
            toggle.setAttribute('title', '切換虛擬鍵盤 (Toggle Virtual Keyboard)，點擊切換');
        }

        if (menu) {
            menu.removeAttribute('data-tooltip');
            menu.setAttribute('title', '選單 (Menu)，點擊切換');
        }

        // 監聽並防止 MathLive 重新寫入 data-tooltip
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((m) => {
                if (m.type === 'attributes' && m.attributeName === 'data-tooltip') {
                    if (m.target.hasAttribute('data-tooltip')) {
                        m.target.removeAttribute('data-tooltip');
                    }
                }
            });
        });

        [toggle, menu].forEach(el => {
            if (el) {
                observer.observe(el, { attributes: true, attributeFilter: ['data-tooltip'] });
            }
        });

        return true;
    };

    if (!applyTooltips()) {
        const interval = setInterval(() => {
            if (applyTooltips()) clearInterval(interval);
        }, 100);
        setTimeout(() => clearInterval(interval), 5000);
    }
};
setupTogglesTooltip();
setupHistoryPanelEvents();

