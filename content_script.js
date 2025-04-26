// /Users/dungnguyen/workspace/annotate-extension/content_script.js
(() => {
  // Prevent multiple runs
  if (window.hasRunAnnotatorScript) return;
  window.hasRunAnnotatorScript = true;
  console.log("Annotator content script loaded.");

  let mainContentElement = null;
  let processingMessageDiv = null;
  let tooltipElement = null; // Reference to the single tooltip DIV
  let tooltipTimeout = null; // To add slight delay on hide

  // --- Helper to Find and Wrap Text (Keep Original Logic + Listeners) ---
  function findAndWrapText(contextNode, searchText, shortExplanation, longExplanation) {
    const walker = document.createTreeWalker(contextNode, NodeFilter.SHOW_TEXT, { acceptNode: (node) => { const p = node.parentNode.tagName.toUpperCase(); if (p === 'SCRIPT' || p === 'STYLE' || node.parentNode.classList.contains('annotated-phrase')) return NodeFilter.FILTER_REJECT; return node.nodeValue.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    let node, foundCount = 0; const nodesToProcess = []; while (node = walker.nextNode()) nodesToProcess.push(node);
    for (var textNode of nodesToProcess) {
      if (!textNode.parentNode || !textNode.nodeValue) continue;
      let matchIndex = -1;
      try {
        matchIndex = textNode.nodeValue.indexOf(searchText);
      } catch (e) { console.warn("Error finding text:", e, textNode, searchText); continue; }

      while (matchIndex !== -1) {
        foundCount++; const matchEnd = matchIndex + searchText.length; const span = document.createElement('span'); span.className = 'annotated-phrase';
        span.dataset.shortExplanation = shortExplanation;
        span.dataset.longExplanation = longExplanation;
        span.textContent = textNode.nodeValue.substring(matchIndex, matchEnd);

        try {
          const afterTextNode = textNode.splitText(matchIndex);
          afterTextNode.nodeValue = afterTextNode.nodeValue.substring(searchText.length);
          textNode.parentNode.insertBefore(span, afterTextNode);
          span.addEventListener('mouseenter', handlePhraseMouseEnter);
          span.addEventListener('mouseleave', handlePhraseMouseLeave);
          textNode = afterTextNode;
          break;
        } catch (e) { console.error("Error inserting span:", e); break; }
      }
    } return foundCount > 0;
  }

  // --- Apply Annotations (Keep Original) ---
  function applyAnnotations(annotations) {
    console.log("Applying annotations:", annotations.length);
    if (!mainContentElement) { mainContentElement = document.body; console.warn("Main content element not identified, using document.body."); }
    if (!annotations || annotations.length === 0) { displayMessage("No difficult phrases found.", "info"); return; }

    injectAnnotationStyles();
    clearPreviousAnnotations();

    let appliedCount = 0;
    annotations.sort((a, b) => b.phrase.length - a.phrase.length);

    annotations.forEach(annotation => {
      if (annotation.phrase && annotation.short_explanation && annotation.long_explanation && annotation.phrase.trim().length > 0) {
        try {
          if (findAndWrapText(mainContentElement || document.body, annotation.phrase, annotation.short_explanation, annotation.long_explanation)) {
            appliedCount++;
          }
        } catch (e) { console.error(`Error applying "${annotation.phrase}":`, e); }
      } else { console.warn("Skipping invalid annotation:", annotation); }
    });
    console.log("Applied count:", appliedCount);
    if (appliedCount > 0) { displayMessage(`Annotated ${appliedCount} phrase(s). Hover over dotted text.`, "success"); }
    else { displayMessage("Could not find the specific phrases on this page.", "warning"); }
  }

  // --- Clear Previous Annotations (Keep Original) ---
  function clearPreviousAnnotations() {
    hideTooltip();
    const container = mainContentElement || document.body;
    const existingSpans = container.querySelectorAll('span.annotated-phrase');
    existingSpans.forEach(span => {
      span.removeEventListener('mouseenter', handlePhraseMouseEnter);
      span.removeEventListener('mouseleave', handlePhraseMouseLeave);
      const p = span.parentNode;
      if (p) { p.replaceChild(document.createTextNode(span.textContent || ''), span); p.normalize(); }
    });
    console.log("Cleared previous annotations and listeners.");
  }

  // --- Inject CSS (Corrected String Escaping if needed, using Template Literal) ---
  function injectAnnotationStyles() {
    const styleId = 'annotator-styles';
    if (document.getElementById(styleId)) return;

    // Use TEMPLATE LITERAL (backticks `) - this handles quotes correctly.
    const css = `
      .annotated-phrase {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: #d32f2f;
        text-decoration-thickness: 1.5px;
        cursor: help;
        background-color: transparent;
      }

      #annotator-tooltip-element {
        position: fixed;
        display: none;
        width: auto;
        min-width: 250px;
        max-width: 450px;
        padding: 10px 12px;
        background-color: #263238;
        color: #eceff1;
        font-family: sans-serif;
        font-size: 0.8em;
        line-height: 1.4;
        text-align: left;
        border-radius: 6px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        white-space: pre-wrap;
        /* Add transition for opacity */
        opacity: 0;
        transition: opacity 0.1s ease-in-out;
      }

      #annotator-tooltip-element.visible { /* Class to control visibility */
          display: block;
          opacity: 1;
      }

      #annotator-tooltip-element .short-explanation {
           font-weight: bold; display: block; margin-bottom: 5px;
       }
      #annotator-tooltip-element .explanation-separator {
           display: block; height: 1px; background-color: #455a64; margin: 5px 0 8px 0;
       }
      #annotator-tooltip-element .long-explanation { display: block; }

      #annotator-message, #annotator-processing-message {
         position: fixed; top: 20px; right: 20px; padding: 12px 18px;
         border-radius: 5px; color: white; font-family: sans-serif;
         font-size: 14px; z-index: 2147483646; opacity: 0;
         transition: opacity 0.4s ease-in-out; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
         pointer-events: none;
      }
      #annotator-message.visible, #annotator-processing-message.visible { opacity: 1; }
      #annotator-message.success { background-color: #4CAF50; }
      #annotator-message.error { background-color: #f44336; }
      #annotator-message.warning { background-color: #ff9800; }
      #annotator-message.info { background-color: #2196F3; }
      #annotator-processing-message { background-color: #607d8b; }
    `; // END OF TEMPLATE LITERAL

    const style = document.createElement('style');
    style.id = styleId;
    // Use textContent which is generally safer and more performant than innerHTML for style tags
    style.textContent = css;
    document.head.appendChild(style);
    console.log("Annotator styles injected/updated.");
  }

  // --- Tooltip Handling Functions ---

  function getOrCreateTooltipElement() {
    tooltipElement = document.getElementById('annotator-tooltip-element');
    if (!tooltipElement) {
      tooltipElement = document.createElement('div');
      tooltipElement.id = 'annotator-tooltip-element';
      document.body.appendChild(tooltipElement);
      console.log("Tooltip element created.");
    }
    return tooltipElement;
  }

  function showTooltip(targetSpan) {
    const tip = getOrCreateTooltipElement();
    clearTimeout(tooltipTimeout);

    const shortExplanation = targetSpan.dataset.shortExplanation || '';
    const longExplanation = targetSpan.dataset.longExplanation || '';

    if (!shortExplanation && !longExplanation) return;

    let htmlContent = '';
    if (shortExplanation) htmlContent += `<span class="short-explanation">${escapeHtml(shortExplanation)}</span>`;
    if (shortExplanation && longExplanation) htmlContent += `<span class="explanation-separator"></span>`;
    if (longExplanation) htmlContent += `<span class="long-explanation">${escapeHtml(longExplanation)}</span>`;
    tip.innerHTML = htmlContent;

    // Make visible using class *before* calculating position
    tip.classList.add('visible');

    // Calculate and apply position
    positionTooltip(targetSpan, tip);

    // Opacity transition is handled by CSS (.visible class)
    console.log("Showing tooltip for:", targetSpan.textContent);
  }

  function hideTooltip() {
    if (tooltipElement) {
      clearTimeout(tooltipTimeout); // Clear any pending hide actions
      // Remove the visible class to trigger fade-out transition
      tooltipElement.classList.remove('visible');
      // We don't need display:none immediately because opacity 0 hides it,
      // and pointer-events: none prevents interaction.
      // Keeping display:block allows potential future transitions on properties like transform.
      console.log("Hiding tooltip");
    }
  }

  // *** REVISED positionTooltip Function ***
  function positionTooltip(targetSpan, tip) {
    const targetRect = targetSpan.getBoundingClientRect(); // Coords relative to viewport
    const tipElement = tip; // Use the direct element reference

    // Ensure tooltip is rendered (display: block) to get accurate dimensions
    // This is now handled by adding '.visible' class *before* calling positionTooltip

    const tipRect = tipElement.getBoundingClientRect(); // Get tooltip dimensions

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buffer = 8; // Space between target and tooltip

    let top, left;

    // --- Position Strategy: Try above first, then below ---

    // Calculate potential top position (above target)
    // Use targetRect.top directly (viewport relative)
    let potentialTop = targetRect.top - tipRect.height - buffer;

    // Check if potential top position is within viewport
    if (potentialTop >= buffer) { // Check if it fits above (with buffer)
      top = potentialTop;
    } else {
      // Try placing it below the target span instead
      // Use targetRect.bottom directly (viewport relative)
      top = targetRect.bottom + buffer;

      // Check if placing below goes off the bottom edge
      if (top + tipRect.height > viewportHeight - buffer) {
        // It doesn't fit below either. Place it as low as possible inside viewport.
        top = viewportHeight - tipRect.height - buffer;
        // Final safety check: make sure it's not negative after adjustment
        if (top < buffer) {
          top = buffer;
        }
      }
    }

    // Calculate potential left position (centered above/below target)
    // Use targetRect.left directly (viewport relative)
    left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);

    // Check left boundary
    if (left < buffer) {
      left = buffer; // Pin to left edge (with buffer)
    }

    // Check right boundary
    if (left + tipRect.width > viewportWidth - buffer) {
      left = viewportWidth - tipRect.width - buffer; // Pin to right edge (with buffer)
    }

    // Apply the final calculated position (relative to viewport)
    tipElement.style.top = `${Math.round(top)}px`;
    tipElement.style.left = `${Math.round(left)}px`;
  }


  // --- Event Handlers ---
  function handlePhraseMouseEnter(event) {
    // Ensure any previous hide timer is cleared before showing
    clearTimeout(tooltipTimeout);
    showTooltip(event.target);
  }

  function handlePhraseMouseLeave() {
    // Delay hiding to allow moving cursor onto tooltip (though pointer-events:none makes it moot)
    // or just slightly off the phrase without immediate flicker.
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(hideTooltip, 150); // Adjust delay as needed
  }

  // --- Helper ---
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, "\"")
      .replace(/'/g, "'");
  }


  // --- Display Messages (Keep Original) ---
  let messageTimeout;
  function displayMessage(message, type = 'info', persistent = false) {
    injectAnnotationStyles();
    clearTimeout(messageTimeout);
    const tempMsgDiv = document.getElementById('annotator-message');
    if (tempMsgDiv) { tempMsgDiv.remove(); }
    if (persistent) { hideProcessingMessage(false); }
    const messageId = persistent ? 'annotator-processing-message' : 'annotator-message';
    let msgDiv = document.getElementById(messageId);
    if (!msgDiv) { msgDiv = document.createElement('div'); msgDiv.id = messageId; document.body.appendChild(msgDiv); }
    msgDiv.textContent = message; msgDiv.className = '';
    msgDiv.classList.add(type);
    requestAnimationFrame(() => { requestAnimationFrame(() => { msgDiv.classList.add('visible'); }); });
    if (persistent) { processingMessageDiv = msgDiv; }
    else { messageTimeout = setTimeout(() => { if (msgDiv) { msgDiv.classList.remove('visible'); msgDiv.addEventListener('transitionend', () => msgDiv.remove(), { once: true }); } }, 3500); }
  }

  // --- Hide Persistent Processing Message (Keep Original) ---
  function hideProcessingMessage(clearTemporary = true) {
    if (processingMessageDiv) {
      processingMessageDiv.classList.remove('visible');
      processingMessageDiv.addEventListener('transitionend', () => processingMessageDiv && processingMessageDiv.remove(), { once: true });
      setTimeout(() => { if (processingMessageDiv && !processingMessageDiv.classList.contains('visible')) processingMessageDiv.remove(); }, 500);
      processingMessageDiv = null;
    }
    if (clearTemporary) {
      clearTimeout(messageTimeout);
      const tempMsg = document.getElementById('annotator-message');
      if (tempMsg) tempMsg.remove();
    }
  }

  // --- Message Listener (Keep Original) ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received:", request.action);
    if (request.action === "showProcessing") {
      clearPreviousAnnotations();
      displayMessage("Processing page content with Gemini...", "info", true);
      sendResponse({ status: "Processing notification shown" });
      return true;
    }
    else if (request.action === "extractText") {
      try {
        if (typeof Readability === 'undefined') throw new Error("Readability library missing.");
        const article = new Readability(document.cloneNode(true), { keepClasses: false, debug: false }).parse();
        if (article && article.content && article.textContent.trim().length > 50) {
          mainContentElement = document.querySelector('article, [role="main"], .post-content, .entry-content, #main-content, #content') || document.body;
          sendResponse({ textContent: article.textContent });
        } else {
          mainContentElement = document.body;
          const bodyText = document.body.innerText || "";
          if (bodyText.trim().length > 100) { sendResponse({ textContent: bodyText }); }
          else { throw new Error("Could not extract readable content."); }
        }
      } catch (error) {
        console.error("Extraction Error:", error);
        sendResponse({ error: `Extraction Error: ${error.message || String(error)}` });
        hideProcessingMessage(); displayMessage(`Error: ${error.message || String(error)}`, "error");
      } return true;
    }
    else if (request.action === "applyAnnotations") {
      hideProcessingMessage();
      const annotations = Array.isArray(request.annotations) ? request.annotations : [];
      applyAnnotations(annotations);
      sendResponse({ status: "Annotations applied" }); return true;
    }
    else if (request.action === "showError") {
      hideProcessingMessage(); console.error("Error from background:", request.error);
      displayMessage(`Error: ${request.error || 'Unknown error'}`, 'error');
      sendResponse({ status: "Error displayed" }); return true;
    }
  });

  // --- Initial Setup ---
  injectAnnotationStyles();
  console.log("Annotator script initialization complete.");

})(); // IIFE