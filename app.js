/* ============================================
   손글씨 추출기 — App Logic
   Image upload, selection, background removal,
   preview, and PNG download.
   ============================================ */

(function () {
  'use strict';

  // ── DOM Elements ──
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const sourceCanvas = document.getElementById('sourceCanvas');
  const previewCanvas = document.getElementById('previewCanvas');
  const sourceWrapper = document.getElementById('sourceWrapper');
  const sourceTransformLayer = document.getElementById('sourceTransformLayer');
  const previewWrapper = document.getElementById('previewWrapper');
  const sourcePanel = document.querySelector('.source-panel');
  const selectionBox = document.getElementById('selectionBox');
  const uploadPlaceholder = document.getElementById('uploadPlaceholder');
  const previewPlaceholder = document.getElementById('previewPlaceholder');
  const sourceHint = document.getElementById('sourceHint');
  const previewHint = document.getElementById('previewHint');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const softnessSlider = document.getElementById('softnessSlider');
  const brightnessSlider = document.getElementById('brightnessSlider');
  const contrastSlider = document.getElementById('contrastSlider');
  const thresholdValue = document.getElementById('thresholdValue');
  const softnessValue = document.getElementById('softnessValue');
  const brightnessValue = document.getElementById('brightnessValue');
  const contrastValue = document.getElementById('contrastValue');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetSlidersBtn = document.getElementById('resetSlidersBtn');
  const dropOverlay = document.getElementById('dropOverlay');
  const pdfNav = document.getElementById('pdfNav');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageInfo = document.getElementById('pageInfo');

  const sourceCtx = sourceCanvas.getContext('2d');
  const previewCtx = previewCanvas.getContext('2d');

  // ── State ──
  let originalImage = null;   // Original Image object
  let displayScale = 1;       // How much the image is scaled down for display
  let displayOffsetX = 0;     // Image offset within canvas
  let displayOffsetY = 0;
  let isSelecting = false;
  let selStart = null;        // { x, y } canvas coords
  let selEnd = null;
  let currentSelection = null; // { x, y, w, h } in original image coords

  // Source pan & zoom state
  let srcZoom = 1;
  let srcPanX = 0;
  let srcPanY = 0;
  let srcDragging = false;
  let srcDragStart = null;
  let isSpaceDown = false;

  // Preview pan & zoom state
  let pvZoom = 1;
  let pvPanX = 0;
  let pvPanY = 0;
  let pvDragging = false;
  let pvDragStart = null;
  let pvBaseW = 0;  // fitted width before zoom
  let pvBaseH = 0;  // fitted height before zoom

  // PDF state
  let pdfDoc = null;
  let pdfCurrentPage = 1;
  let pdfTotalPages = 0;

  // ── Init ──
  function init() {
    // Upload
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // Drag & Drop (whole page)
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);

    // Paste (Ctrl+V)
    document.addEventListener('paste', onPaste);

    // Selection (mouse)
    sourceWrapper.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);

    // Selection (touch)
    sourceWrapper.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    // Sliders — both 'input' (drag) and 'change' (release) for cross-browser
    const allSliders = [thresholdSlider, softnessSlider, brightnessSlider, contrastSlider];
    allSliders.forEach(function (s) {
      s.addEventListener('input', onSliderChange);
      s.addEventListener('change', onSliderChange);
    });

    // Download & Reset
    downloadBtn.addEventListener('click', downloadPNG);
    resetSlidersBtn.addEventListener('click', resetSliders);

    // PDF page navigation
    prevPageBtn.addEventListener('click', onPrevPage);
    nextPageBtn.addEventListener('click', onNextPage);

    // PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    // Source pan (drag) & zoom (wheel)
    sourceWrapper.addEventListener('wheel', onSourceWheel, { passive: false });
    sourceWrapper.addEventListener('dblclick', onSourceDblClick);

    // Preview pan (drag) & zoom (wheel)
    previewWrapper.addEventListener('mousedown', onPreviewMouseDown);
    document.addEventListener('mousemove', onPreviewMouseMove);
    document.addEventListener('mouseup', onPreviewMouseUp);
    previewWrapper.addEventListener('wheel', onPreviewWheel, { passive: false });
    previewWrapper.addEventListener('dblclick', onPreviewDblClick);

    // Resize
    window.addEventListener('resize', onResize);

    // Keyboard
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  // ═══════════════════════════════════════════
  // FILE LOADING (Image & PDF)
  // ═══════════════════════════════════════════

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    loadFile(file);
    fileInput.value = '';
  }

  function loadFile(file) {
    if (file.type === 'application/pdf') {
      loadPdfFile(file);
    } else if (file.type.startsWith('image/')) {
      hidePdfNav();
      pdfDoc = null;
      loadImageFile(file);
    } else {
      showToast('지원하지 않는 파일 형식입니다 (이미지 또는 PDF만 가능)');
    }
  }

  function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setOriginalImage(img);
        showToast('이미지가 로드되었습니다');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function setOriginalImage(img) {
    originalImage = img;
    clearSelection();
    clearPreview();
    resetSourceTransform();
    drawSourceImage();
    uploadPlaceholder.classList.add('hidden');
    sourceWrapper.classList.remove('no-image');
    sourceHint.textContent = '드래그로 영역 선택';
  }

  // ═══════════════════════════════════════════
  // PDF LOADING
  // ═══════════════════════════════════════════

  async function loadPdfFile(file) {
    if (typeof pdfjsLib === 'undefined') {
      showToast('PDF.js 라이브러리를 로드할 수 없습니다');
      return;
    }

    try {
      showToast('PDF 로드 중...');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDoc = pdf;
      pdfCurrentPage = 1;
      pdfTotalPages = pdf.numPages;

      // 페이지 네비게이션 표시 (2페이지 이상일 때)
      if (pdfTotalPages > 1) {
        showPdfNav();
      } else {
        hidePdfNav();
      }

      await renderPdfPage(pdfCurrentPage);
      showToast(`PDF 로드 완료 (${pdfTotalPages}페이지)`);
    } catch (err) {
      console.error('PDF load error:', err);
      showToast('PDF 로드 실패');
    }
  }

  async function renderPdfPage(pageNum) {
    if (!pdfDoc) return;

    // 렌더링 중 이전 선택 영역 및 미리보기 초기화
    clearSelection();
    clearPreview();
    sourceHint.textContent = '페이지 로딩 중...';

    try {
      const page = await pdfDoc.getPage(pageNum);
      const scale = 3; // 고해상도 렌더링
      const viewport = page.getViewport({ scale: scale });

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      const tempCtx = tempCanvas.getContext('2d');

      await page.render({
        canvasContext: tempCtx,
        viewport: viewport,
      }).promise;

      // 캔버스 → Image 객체로 변환
      const img = new Image();
      img.onload = () => {
        setOriginalImage(img);
        updatePdfNavState();
      };
      img.src = tempCanvas.toDataURL('image/png');
    } catch (err) {
      console.error('PDF render error:', err);
      showToast('PDF 페이지 렌더링 실패');
    }
  }

  function onPrevPage() {
    if (!pdfDoc || pdfCurrentPage <= 1) return;
    pdfCurrentPage--;
    renderPdfPage(pdfCurrentPage);
  }

  function onNextPage() {
    if (!pdfDoc || pdfCurrentPage >= pdfTotalPages) return;
    pdfCurrentPage++;
    renderPdfPage(pdfCurrentPage);
  }

  function showPdfNav() {
    pdfNav.classList.add('visible');
    updatePdfNavState();
  }

  function hidePdfNav() {
    pdfNav.classList.remove('visible');
  }

  function updatePdfNavState() {
    pageInfo.textContent = `${pdfCurrentPage} / ${pdfTotalPages}`;
    prevPageBtn.disabled = (pdfCurrentPage <= 1);
    nextPageBtn.disabled = (pdfCurrentPage >= pdfTotalPages);
  }

  function drawSourceImage() {
    if (!originalImage) return;

    const wrapperRect = sourceWrapper.getBoundingClientRect();
    const cw = wrapperRect.width;
    const ch = wrapperRect.height;

    sourceCanvas.width = cw;
    sourceCanvas.height = ch;

    const iw = originalImage.width;
    const ih = originalImage.height;

    // Fit image inside canvas
    displayScale = Math.min(cw / iw, ch / ih, 1); // don't upscale
    const dw = iw * displayScale;
    const dh = ih * displayScale;
    displayOffsetX = (cw - dw) / 2;
    displayOffsetY = (ch - dh) / 2;

    sourceCtx.clearRect(0, 0, cw, ch);
    sourceCtx.drawImage(originalImage, displayOffsetX, displayOffsetY, dw, dh);

    // Redraw selection if exists
    if (currentSelection) {
      redrawSelectionBox();
    }
  }

  // ═══════════════════════════════════════════
  // DRAG & DROP
  // ═══════════════════════════════════════════

  let dragCounter = 0;

  function onDragEnter(e) {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dropOverlay.classList.add('active');
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('active');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      loadFile(files[0]);
    }
  }

  // ═══════════════════════════════════════════
  // PASTE (Ctrl+V)
  // ═══════════════════════════════════════════

  function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) loadFile(file);
        return;
      }
    }
  }

  // ═══════════════════════════════════════════
  // SELECTION (Mouse & Touch)
  // ═══════════════════════════════════════════

  function getCanvasCoords(e) {
    const rect = sourceWrapper.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - srcPanX) / srcZoom,
      y: (e.clientY - rect.top - srcPanY) / srcZoom,
    };
  }

  function onPointerDown(e) {
    if (!originalImage) return;

    // Pan mode: Space + Left click OR Middle click
    if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
      e.preventDefault();
      srcDragging = true;
      srcDragStart = { x: e.clientX - srcPanX, y: e.clientY - srcPanY };
      sourcePanel.classList.add('pan-mode');
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();
    isSelecting = true;
    selStart = getCanvasCoords(e);
    selEnd = { ...selStart };
    selectionBox.style.display = 'none';
  }

  function onPointerMove(e) {
    if (srcDragging) {
      e.preventDefault();
      srcPanX = e.clientX - srcDragStart.x;
      srcPanY = e.clientY - srcDragStart.y;
      applySourceTransform();
      return;
    }

    if (!isSelecting) return;
    e.preventDefault();
    selEnd = getCanvasCoords(e);
    updateSelectionBox();
  }

  function onPointerUp(e) {
    if (srcDragging) {
      srcDragging = false;
      if (!isSpaceDown) {
        sourcePanel.classList.remove('pan-mode');
      }
      return;
    }

    if (!isSelecting) return;
    isSelecting = false;
    selEnd = getCanvasCoords(e);
    finalizeSelection();
  }

  // Touch
  function onTouchStart(e) {
    if (!originalImage || e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    isSelecting = true;
    selStart = getCanvasCoords(touch);
    selEnd = { ...selStart };
    selectionBox.style.display = 'none';
  }

  function onTouchMove(e) {
    if (!isSelecting || e.touches.length !== 1) return;
    e.preventDefault();
    selEnd = getCanvasCoords(e.touches[0]);
    updateSelectionBox();
  }

  function onTouchEnd(e) {
    if (!isSelecting) return;
    isSelecting = false;
    finalizeSelection();
  }

  function updateSelectionBox() {
    const x = Math.min(selStart.x, selEnd.x);
    const y = Math.min(selStart.y, selEnd.y);
    const w = Math.abs(selEnd.x - selStart.x);
    const h = Math.abs(selEnd.y - selStart.y);

    selectionBox.style.display = 'block';
    selectionBox.style.left = x + 'px';
    selectionBox.style.top = y + 'px';
    selectionBox.style.width = w + 'px';
    selectionBox.style.height = h + 'px';
  }

  function redrawSelectionBox() {
    if (!currentSelection) return;
    const { x, y, w, h } = currentSelection;
    const sx = displayOffsetX + x * displayScale;
    const sy = displayOffsetY + y * displayScale;
    const sw = w * displayScale;
    const sh = h * displayScale;

    selectionBox.style.display = 'block';
    selectionBox.style.left = sx + 'px';
    selectionBox.style.top = sy + 'px';
    selectionBox.style.width = sw + 'px';
    selectionBox.style.height = sh + 'px';
  }

  function canvasToImageCoords(cx, cy) {
    return {
      x: (cx - displayOffsetX) / displayScale,
      y: (cy - displayOffsetY) / displayScale,
    };
  }

  function finalizeSelection() {
    if (!selStart || !selEnd) return;

    const minX = Math.min(selStart.x, selEnd.x);
    const minY = Math.min(selStart.y, selEnd.y);
    const maxX = Math.max(selStart.x, selEnd.x);
    const maxY = Math.max(selStart.y, selEnd.y);

    // Too small? Ignore
    if (maxX - minX < 5 || maxY - minY < 5) {
      clearSelection();
      return;
    }

    // Convert to image coordinates
    const topLeft = canvasToImageCoords(minX, minY);
    const bottomRight = canvasToImageCoords(maxX, maxY);

    // Clamp to image bounds
    const iw = originalImage.width;
    const ih = originalImage.height;
    const sx = Math.max(0, Math.round(topLeft.x));
    const sy = Math.max(0, Math.round(topLeft.y));
    const sw = Math.min(iw - sx, Math.round(bottomRight.x - topLeft.x));
    const sh = Math.min(ih - sy, Math.round(bottomRight.y - topLeft.y));

    if (sw <= 0 || sh <= 0) {
      clearSelection();
      return;
    }

    currentSelection = { x: sx, y: sy, w: sw, h: sh };
    resetPreviewTransform();
    sourceHint.textContent = `${sw} × ${sh}px 선택됨`;
    processSelection();
  }

  function clearSelection() {
    currentSelection = null;
    selectionBox.style.display = 'none';
    selStart = null;
    selEnd = null;
    if (originalImage) {
      sourceHint.textContent = '드래그로 영역 선택';
    }
  }

  // ═══════════════════════════════════════════
  // BACKGROUND REMOVAL
  // ═══════════════════════════════════════════

  function processSelection() {
    if (!currentSelection || !originalImage) return;

    try {
      const { x, y, w, h } = currentSelection;
      // 감도: 0~100% → 내부 threshold 250~100 (높을수록 공격적 제거)
      const sliderVal = parseInt(thresholdSlider.value);
      const threshold = 250 - (sliderVal * 1.5);
      // 부드러움: 0~100% → 내부 0~80px
      const softness = Math.round(parseInt(softnessSlider.value) * 0.8);

      // 선택 영역만큼만 캠버스 생성 (성능 최적화)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.drawImage(originalImage, x, y, w, h, 0, 0, w, h);

      const imageData = tempCtx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const len = data.length;

      // Brightness & Contrast values
      const bright = parseInt(brightnessSlider.value);
      const cont = parseInt(contrastSlider.value);
      // Contrast factor: maps -100~+100 to a multiplier
      const contFactor = (259 * (cont + 255)) / (255 * (259 - cont));

      // Process each pixel
      for (let i = 0; i < len; i += 4) {
        const avgBrightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

        if (avgBrightness > threshold) {
          // Bright pixel → transparent (background)
          data[i + 3] = 0;
        } else if (softness > 0 && avgBrightness > threshold - softness) {
          // Transition zone → gradual transparency
          data[i + 3] = Math.round(255 * (threshold - avgBrightness) / softness);
        }
        // else: keep original alpha (255) → ink stays

        // Apply brightness & contrast to non-transparent pixels (ink)
        if (data[i + 3] > 0 && (bright !== 0 || cont !== 0)) {
          for (let c = 0; c < 3; c++) {
            let val = data[i + c];
            // Contrast: adjust around midpoint 128
            val = contFactor * (val - 128) + 128;
            // Brightness: shift
            val = val + bright;
            // Clamp 0-255
            data[i + c] = Math.max(0, Math.min(255, Math.round(val)));
          }
        }
      }

      // Draw result on preview canvas
      previewCanvas.width = w;
      previewCanvas.height = h;
      previewCtx.clearRect(0, 0, w, h);
      previewCtx.putImageData(imageData, 0, 0);

      // Fit preview canvas visually
      fitPreviewCanvas(w, h);

      // UI updates
      previewPlaceholder.classList.add('hidden');
      downloadBtn.disabled = false;
      updatePreviewHint();
    } catch (err) {
      console.error('processSelection error:', err);
    }
  }

  function fitPreviewCanvas(w, h) {
    const wrapperRect = previewWrapper.getBoundingClientRect();
    const scaleX = wrapperRect.width / w;
    const scaleY = wrapperRect.height / h;
    const fitScale = Math.min(scaleX, scaleY, 1);

    pvBaseW = w * fitScale;
    pvBaseH = h * fitScale;
    applyPreviewTransform();
  }

  function applyPreviewTransform() {
    previewCanvas.style.width = (pvBaseW * pvZoom) + 'px';
    previewCanvas.style.height = (pvBaseH * pvZoom) + 'px';
    previewCanvas.style.transform = `translate(${pvPanX}px, ${pvPanY}px)`;
    previewCanvas.style.transformOrigin = 'center center';
  }

  function resetPreviewTransform() {
    pvZoom = 1;
    pvPanX = 0;
    pvPanY = 0;
    pvDragging = false;
  }

  function updatePreviewHint() {
    if (!currentSelection) { previewHint.textContent = ''; return; }
    const pct = Math.round(pvZoom * 100);
    previewHint.textContent = `${currentSelection.w} × ${currentSelection.h}px · ${pct}%`;
  }

  // ═══════════════════════════════════════════
  // SOURCE PAN & ZOOM
  // ═══════════════════════════════════════════

  function applySourceTransform() {
    sourceTransformLayer.style.transform = `translate(${srcPanX}px, ${srcPanY}px) scale(${srcZoom})`;
  }

  function resetSourceTransform() {
    srcZoom = 1;
    srcPanX = 0;
    srcPanY = 0;
    srcDragging = false;
    applySourceTransform();
  }

  function onSourceWheel(e) {
    if (!originalImage) return;
    e.preventDefault();

    const rect = sourceWrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const oldZoom = srcZoom;
    const newZoom = Math.max(0.1, Math.min(10, srcZoom + delta));
    srcZoom = Math.round(newZoom * 100) / 100;

    // 마우스 커서 위치를 기준으로 확대/축소
    const zoomRatio = srcZoom / oldZoom;
    srcPanX = mouseX - (mouseX - srcPanX) * zoomRatio;
    srcPanY = mouseY - (mouseY - srcPanY) * zoomRatio;

    applySourceTransform();
  }

  function onSourceDblClick(e) {
    if (!originalImage) return;
    e.preventDefault();
    resetSourceTransform();
    showToast('원본 위치/크기 초기화');
  }

  // ═══════════════════════════════════════════
  // PREVIEW PAN & ZOOM
  // ═══════════════════════════════════════════

  function onPreviewMouseDown(e) {
    if (!currentSelection || e.button !== 0) return;
    // Don't start drag on placeholder
    if (e.target.closest('.placeholder')) return;
    e.preventDefault();
    pvDragging = true;
    pvDragStart = { x: e.clientX - pvPanX, y: e.clientY - pvPanY };
    previewWrapper.style.cursor = 'grabbing';
  }

  function onPreviewMouseMove(e) {
    if (!pvDragging) return;
    e.preventDefault();
    pvPanX = e.clientX - pvDragStart.x;
    pvPanY = e.clientY - pvDragStart.y;
    applyPreviewTransform();
  }

  function onPreviewMouseUp() {
    if (!pvDragging) return;
    pvDragging = false;
    previewWrapper.style.cursor = '';
  }

  function onPreviewWheel(e) {
    if (!currentSelection) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(10, pvZoom + delta));
    pvZoom = Math.round(newZoom * 100) / 100;
    applyPreviewTransform();
    updatePreviewHint();
  }

  function onPreviewDblClick(e) {
    if (!currentSelection) return;
    e.preventDefault();
    resetPreviewTransform();
    applyPreviewTransform();
    updatePreviewHint();
    showToast('미리보기 위치/크기 초기화');
  }

  // ═══════════════════════════════════════════
  // SLIDERS
  // ═══════════════════════════════════════════

  let sliderDebounce = null;

  function onSliderChange() {
    thresholdValue.textContent = thresholdSlider.value + '%';
    softnessValue.textContent = softnessSlider.value + '%';
    brightnessValue.textContent = brightnessSlider.value;
    contrastValue.textContent = contrastSlider.value;

    // Debounce: 슬라이더 드래그 중 과도한 호출 방지
    clearTimeout(sliderDebounce);
    sliderDebounce = setTimeout(function () {
      processSelection();
    }, 30);
  }

  // 슬라이더 기본값
  const SLIDER_DEFAULTS = {
    threshold: 73,
    softness: 38,
    brightness: 0,
    contrast: 0,
  };

  function resetSliders() {
    thresholdSlider.value = SLIDER_DEFAULTS.threshold;
    softnessSlider.value = SLIDER_DEFAULTS.softness;
    brightnessSlider.value = SLIDER_DEFAULTS.brightness;
    contrastSlider.value = SLIDER_DEFAULTS.contrast;
    onSliderChange();
    showToast('슬라이더가 초기화되었습니다');
  }

  // ═══════════════════════════════════════════
  // DOWNLOAD
  // ═══════════════════════════════════════════

  function downloadPNG() {
    if (!currentSelection) return;

    const scale = parseInt(document.getElementById('exportScale').value) || 1;
    let targetCanvas = previewCanvas;

    // 배율이 1보다 크면 오프스크린 캔버스를 만들어 부드럽게 확대
    if (scale > 1) {
      targetCanvas = document.createElement('canvas');
      targetCanvas.width = previewCanvas.width * scale;
      targetCanvas.height = previewCanvas.height * scale;
      const ctx = targetCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(previewCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    }

    targetCanvas.toBlob(async (blob) => {
      if (!blob) return;
      
      // 300 DPI 메타데이터 강제 주입
      const dpiBlob = await setDPI300(blob);
      
      const url = URL.createObjectURL(dpiBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generateFilename(scale);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('PNG 파일이 다운로드되었습니다 ✓');
    }, 'image/png');
  }

  // PNG 파일 바이너리에 300 DPI (pHYs) 청크를 삽입하는 함수
  function setDPI300(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const view = new Uint8Array(e.target.result);
        
        // PNG 시그니처 체크
        if (view[0] !== 0x89 || view[1] !== 0x50) {
          return resolve(blob);
        }

        // 300 DPI (11811 pixels/meter) pHYs 청크 데이터 및 미리 계산된 CRC
        const physChunk = new Uint8Array([
          0x00, 0x00, 0x00, 0x09, // Length (9 bytes)
          0x70, 0x48, 0x59, 0x73, // Type (pHYs)
          0x00, 0x00, 0x2E, 0x23, // X-axis (11811)
          0x00, 0x00, 0x2E, 0x23, // Y-axis (11811)
          0x01,                   // Unit (1 = meter)
          0x78, 0xA5, 0x3F, 0x76  // CRC32
        ]);

        // IHDR 청크 바로 뒤(오프셋 33)에 pHYs 청크 삽입
        const newBuffer = new Uint8Array(view.length + physChunk.length);
        newBuffer.set(view.slice(0, 33), 0);
        newBuffer.set(physChunk, 33);
        newBuffer.set(view.slice(33), 33 + physChunk.length);
        
        resolve(new Blob([newBuffer], { type: 'image/png' }));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  function generateFilename(scale) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const suffix = scale > 1 ? `_${scale}x` : '';
    return `handwriting_${ts}${suffix}.png`;
  }

  // ═══════════════════════════════════════════
  // RESIZE
  // ═══════════════════════════════════════════

  let resizeTimer = null;

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawSourceImage();
      if (currentSelection) {
        fitPreviewCanvas(currentSelection.w, currentSelection.h);
      }
    }, 100);
  }

  // ═══════════════════════════════════════════
  // KEYBOARD
  // ═══════════════════════════════════════════

  function onKeyDown(e) {
    // Space → Pan mode
    if (e.code === 'Space' && !isSpaceDown) {
      if (document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        isSpaceDown = true;
        sourcePanel.classList.add('pan-mode');
      }
    }
    // Escape → clear selection
    if (e.key === 'Escape') {
      clearSelection();
      clearPreview();
    }
    // Ctrl+S → download
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      if (!downloadBtn.disabled) {
        e.preventDefault();
        downloadPNG();
      }
    }
  }

  function onKeyUp(e) {
    // Space → End Pan mode
    if (e.code === 'Space') {
      isSpaceDown = false;
      if (!srcDragging) {
        sourcePanel.classList.remove('pan-mode');
      }
    }
  }

  // ═══════════════════════════════════════════
  // PREVIEW
  // ═══════════════════════════════════════════

  function clearPreview() {
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    previewCanvas.style.width = '';
    previewCanvas.style.height = '';
    previewCanvas.style.transform = '';
    resetPreviewTransform();
    previewPlaceholder.classList.remove('hidden');
    previewHint.textContent = '';
    downloadBtn.disabled = true;
  }

  // ═══════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════

  let toastEl = null;
  let toastTimeout = null;

  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }

    toastEl.textContent = message;
    toastEl.classList.add('show');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2500);
  }

  // ── Start ──
  init();

})();
