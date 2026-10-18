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
};

let history = loadHistory();
let historyIndex = -1;
let draftExpression = '';

// 判斷是否可往上回溯歷史 (更舊紀錄)
const canRecallUp = () => {
    if (history.length === 0) return false;
    if (historyIndex === -1) return true; // 當前在草稿/空白畫面，可往上叫出最新一筆
    return historyIndex > 0; // 在歷史紀錄中，上方還有更舊紀錄
};

// 判斷是否可往下瀏覽歷史 (較新紀錄或草稿)
const canRecallDown = () => {
    if (history.length === 0 || historyIndex === -1) return false;
    return (historyIndex < history.length - 1) || Boolean(draftExpression && draftExpression.trim());
};

// 載入指定索引的歷史紀錄
const recallCalculation = (index) => {
    if (index < 0 || index >= history.length) return;
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

// 變數記憶體 (Casio 9大變數)
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

// 綁定虛擬鍵盤切換圖示 (點擊 toggle virtual keyboard 按鈕時召喚/收合鍵盤，平日點擊其他按鈕則不跳出)
const setupVirtualKeyboardToggle = () => {
    if (!mf || !mf.shadowRoot) return;
    const toggle = mf.shadowRoot.querySelector('[part="virtual-keyboard-toggle"]');
    if (toggle && !toggle._hasCustomToggle) {
        toggle._hasCustomToggle = true;
        const toggleHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (window.mathVirtualKeyboard) {
                if (window.mathVirtualKeyboard.visible) {
                    window.mathVirtualKeyboard.hide();
                } else {
                    window.mathVirtualKeyboard.show();
                }
            }
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
                        color: inherit !important;
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
                    .ML__content {
                        align-self: flex-end !important;
                        padding-bottom: 0 !important;
                        margin-bottom: 0 !important;
                        overflow: visible !important;
                        will-change: transform;
                    }
                    ` : ''}
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

    if (indLeft) indLeft.style.color = (resultTotalPages > 1 && resultPage > 0) ? '#111' : 'transparent';
    if (indRight) indRight.style.color = (resultTotalPages > 1 && resultPage < resultTotalPages - 1) ? '#111' : 'transparent';
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
                        mf.executeCommand('moveToMathFieldEnd');
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


// 計算解過長分頁狀態
let resultPage = 0;
let resultTotalPages = 1;
let resultOverflowW = 0;

// 更新計算解分頁狀態
const updateResultPaging = (resetToPageZero = true) => {
    if (!resultEl) return;
    const sr = resultEl.shadowRoot;
    const content = sr ? sr.querySelector('.ML__content') : null;
    
    if (!content || !isEvaluated || !resultEl.value || resultEl.value === '0') {
        resultPage = 0;
        resultTotalPages = 1;
        resultOverflowW = 0;
        if (content) {
            content.style.transform = '';
            content.style.transition = '';
        }
        updateIndicators();
        return;
    }

    const contentW = content.getBoundingClientRect().width;
    const viewW = resultEl.clientWidth || 276;
    resultOverflowW = Math.max(0, contentW - viewW);

    if (resultOverflowW <= 3) {
        resultPage = 0;
        resultTotalPages = 1;
        content.style.transform = '';
        content.style.transition = '';
        updateIndicators();
        return;
    }

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

    content.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
    content.style.transform = `translateX(${translateX}px)`;

    updateIndicators();
};

const pageResultLeft = () => {
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
    if (isEvaluated && resultTotalPages > 1) {
        if (resultPage < resultTotalPages - 1) {
            applyResultPage(resultPage + 1);
            return true;
        }
        return false; // 已在最右頁，讓後續按鍵處理可切換為進入算式編輯
    }
    return false;
};

const attachResultTouchSwipe = () => {
    const vp = document.getElementById('result-viewport') || resultEl;
    if (!vp) return;
    let touchStartX = 0;
    let touchStartY = 0;
    vp.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }
    }, { passive: true });
    vp.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length === 1) {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) {
                    pageResultRight();
                } else {
                    pageResultLeft();
                }
            }
        }
    }, { passive: true });
};
attachResultTouchSwipe();
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
    isEvaluated = false;
    historyIndex = -1;
    draftExpression = '';
    isShowingDMS = false;
    updateIndicators();
    updateResultPaging(true);
});

const insertMath = (latex) => {
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
        syncAngleMode();

        let rawLatex = mf.value;

        // 1. 替換 Ans 與 PreAns (包含解開被意外包裹在 \text{...} 內的 Ans/運算式，並消除任何前綴如 \operatorname, \mathrm, \text)
        const ansSubVal = (ansExact && !ansExact.includes('ERROR') && !ansExact.includes('=')) ? ansExact : ansValue;
        const preAnsSubVal = (preAnsExact && !preAnsExact.includes('ERROR') && !preAnsExact.includes('=')) ? preAnsExact : preAnsValue;

        const replaceAnsToken = (str, tokenName, subVal) => {
            let res = str;
            const strVal = String(subVal);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            
            // 1.1 若包裹在 \text{...} 且包含其他運算子，先解開
            res = res.replace(/\\text\{([^{}]*?)\}/g, (match, inner) => {
                if (new RegExp('\\b' + tokenName + '\\b').test(inner) && /[\/\+\-\*]|\\div|\\times/.test(inner)) {
                    return inner;
                }
                return match;
            });

            // 1.2 反覆剝除任何可能巢狀包裹在變數外層的格式前綴 (\operatorname, \mathrm, \text, \mathbf, \mathit 等)
            // 例如 MathLive 常見的 \operatorname{\mathrm{Ans}} 或 {\operatorname{\mathrm{Ans}}}
            const reWrapper = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s*\\{\\s*' + tokenName + '\\s*\\}', 'gi');
            const reNoBraces = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s+' + tokenName + '\\b', 'gi');
            let prev;
            do {
                prev = res;
                res = res.replace(reWrapper, tokenName);
                res = res.replace(reNoBraces, tokenName);
            } while (res !== prev);

            // 1.3 變數已徹底純淨化，替換為數值 (若純數值則不額外加括號，負數或算式才加 \left( \right))
            const rePlain = new RegExp('\\b' + tokenName + '\\b', 'gi');
            res = res.replace(rePlain, wrappedVal);
            return res;
        };

        let mathStr = replaceAnsToken(rawLatex, 'PreAns', preAnsSubVal);
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

        // 6. 百分比符號替換
        mathStr = mathStr.replace(/%/g, '\\%');

        // 7. 解方程式 (SOLVE 功能，含等號 =)
        if (mathStr.includes('=')) {
            let eqExpr = ce.parse(mathStr);
            let solutions = null;
            try {
                solutions = eqExpr.solve('X');
                if (!solutions || solutions.length === 0) {
                    solutions = eqExpr.solve('x');
                }
            } catch(e) {}

            if (solutions && solutions.length > 0) {
                const solLatex = solutions.map(s => s.latex || String(s)).join(',\\ ');
                lastExact = 'X = ' + solLatex;
                lastDecimal = lastExact;
                let firstVal = Number(solutions[0].N ? solutions[0].N().numericValue : solutions[0]);
                if (!isNaN(firstVal)) {
                    lastNumericVal = firstVal;
                    memoryVars.X = firstVal;
                    preAnsValue = ansValue;
                    ansValue = firstVal;
                    preAnsExact = ansExact;
                    ansExact = String(firstVal);
                }
                resultEl.value = lastExact;
                isEvaluated = true;
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
                mathStr = mathStr.replace(reWrapper, v);
                mathStr = mathStr.replace(reNoBraces, v);
            } while (mathStr !== prev);

            const reg = new RegExp('\\b' + v + '\\b', 'g');
            const strVal = String(memoryVars[v]);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            mathStr = mathStr.replace(reg, wrappedVal);
        });
        if (!mathStr.includes('dx') && !mathStr.includes('\\frac{d}{dx}')) {
            const reWrapper = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s*\\{\\s*X\\s*\\}', 'gi');
            const reNoBraces = new RegExp('\\\\(?:operatorname\\*?|mathrm|text|mathbf|mathit)\\s+X\\b', 'gi');
            let prev;
            do {
                prev = mathStr;
                mathStr = mathStr.replace(reWrapper, 'X');
                mathStr = mathStr.replace(reNoBraces, 'X');
            } while (mathStr !== prev);

            const strVal = String(memoryVars.X);
            const wrappedVal = /^[\d.]+$/.test(strVal) ? strVal : '\\left(' + strVal + '\\right)';
            mathStr = mathStr.replace(/\bX\b/g, wrappedVal);
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
                else if (!isNaN(Number(res))) numVal = Number(res);
            }
        } catch(e) {}

        if (!latexRes || latexRes === 'Error') {
            if (numVal !== null) {
                latexRes = String(Math.round(numVal * 10000000000) / 10000000000);
            }
        }

        if (numVal !== null && Number.isFinite(numVal)) {
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
        if (val === 'mode') {
            if (isShift) {
                // SHIFT + MODE (SETUP 功能)：切換永久預設輸出格式 S (MathO) 或 D (LineIO/小數)
                toggleMathMode();
                isShift = false;
                return;
            }
            cycleAngleMode();
            return;
        }

        // 4. 重置與清除
        if (val === 'ac' || val === 'on') {
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
            updateIndicators();
            updateResultPaging(true);
            suppressSoftKeyboard();
            mf.focus({ preventScroll: true });
            return;
        }

        if (val === 'del') {
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
            Object.keys(memoryVars).forEach(k => memoryVars[k] = 0);
            ansValue = 0;
            preAnsValue = 0;
            ansExact = '0';
            preAnsExact = '0';
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

        // 13. 一般符號、Shift 符號與 Alpha 符號插入
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
            '7': '299792458' // 光速 c (Casio CONST)
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
                if (prevWord && (/^[\d.]+$/.test(prevWord.trim()) || /^(?:Ans|PreAns|[A-F]|X|Y|M|\\operatorname\{Ans\})$/i.test(prevWord.trim()))) {
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
            isEvaluated = false;
            historyIndex = -1;
            draftExpression = '';
            updateIndicators();
            mf.executeCommand('moveToMathFieldEnd');
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
            isEvaluated = false;
            historyIndex = -1;
            draftExpression = '';
            updateIndicators();
            mf.executeCommand('moveToMathFieldStart');
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

// 讓虛擬鍵盤與選單圖示的 tooltip 顯示 1 秒後自動消失，避免遮擋 LED 畫面
const setupTooltipAutoDismiss = () => {
    const attachToToggles = () => {
        if (!mf || !mf.shadowRoot) return false;
        const toggle = mf.shadowRoot.querySelector('[part*="virtual-keyboard-toggle"]');
        const menu = mf.shadowRoot.querySelector('[part*="menu-toggle"]');
        if (!toggle) return false;

        [toggle, menu].forEach(el => {
            if (!el || el._hasTooltipDismiss) return;
            el._hasTooltipDismiss = true;
            const origTooltip = el.getAttribute('data-tooltip') || '';
            let timer = null;

            const showAndScheduleDismiss = () => {
                el.setAttribute('data-tooltip', origTooltip);
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    el.removeAttribute('data-tooltip');
                }, 1000); // ⭐️ 顯示 1 秒後自動消失
            };

            const reset = () => {
                if (timer) clearTimeout(timer);
                el.setAttribute('data-tooltip', origTooltip);
            };

            el.addEventListener('pointerenter', showAndScheduleDismiss);
            el.addEventListener('pointerdown', showAndScheduleDismiss);
            el.addEventListener('pointerleave', reset);
        });
        return true;
    };

    if (!attachToToggles()) {
        const interval = setInterval(() => {
            if (attachToToggles()) clearInterval(interval);
        }, 100);
        setTimeout(() => clearInterval(interval), 5000);
    }
};
setupTooltipAutoDismiss();

