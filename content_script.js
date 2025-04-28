// /Users/dungnguyen/workspace/annotate-extension/content_script.js
(() => {
  // Prevent multiple runs
  if (window.hasRunAnnotatorScript) {
    console.log("Annotator content script already running.");
    return;
  }
  window.hasRunAnnotatorScript = true;
  console.log("Annotator content script loaded/re-injected."); // Log changed slightly

  let mainContentElement = null;
  let processingMessageDiv = null;
  let tooltipElement = null; // Reference to the single tooltip DIV
  let tooltipTimeout = null; // To add slight delay on hide

  // --- Helper to Find and Wrap Text ---
  // (Keep this function as is - the NodeFilter already prevents re-wrapping)
  function findAndWrapText(contextNode, searchText, shortExplanation, longExplanation, vietnameseTranslation) {
    const walker = document.createTreeWalker(contextNode, NodeFilter.SHOW_TEXT, { acceptNode: (node) => { const p = node.parentNode.tagName.toUpperCase(); if (p === 'SCRIPT' || p === 'STYLE' || node.parentNode.classList.contains('annotated-phrase')) return NodeFilter.FILTER_REJECT; return node.nodeValue.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    let node, foundCount = 0; const nodesToProcess = []; while (node = walker.nextNode()) nodesToProcess.push(node);
    for (var textNode of nodesToProcess) {
      if (!textNode.parentNode || !textNode.nodeValue) continue;
      let matchIndex = -1;
      try {
        // Use a case-insensitive search? For now, keep it case-sensitive as the LLM likely returns the exact phrase.
        matchIndex = textNode.nodeValue.indexOf(searchText);
      } catch (e) { console.warn("Error finding text:", e, textNode, searchText); continue; }

      while (matchIndex !== -1) {
        foundCount++; const matchEnd = matchIndex + searchText.length; const span = document.createElement('span'); span.className = 'annotated-phrase';
        span.dataset.shortExplanation = shortExplanation;
        span.dataset.longExplanation = longExplanation;
        span.dataset.vietnameseTranslation = vietnameseTranslation;
        span.textContent = textNode.nodeValue.substring(matchIndex, matchEnd);

        try {
          const afterTextNode = textNode.splitText(matchIndex);
          afterTextNode.nodeValue = afterTextNode.nodeValue.substring(searchText.length);
          textNode.parentNode.insertBefore(span, afterTextNode);
          span.addEventListener('mouseenter', handlePhraseMouseEnter);
          span.addEventListener('mouseleave', handlePhraseMouseLeave);
          textNode = afterTextNode;
          // Find next occurrence in the *rest* of the text node
          matchIndex = textNode.nodeValue.indexOf(searchText);
          // break; // Original code had break, let's allow multiple matches in one node
        } catch (e) { console.error("Error inserting span:", e); matchIndex = -1; /* Stop trying in this node on error */ }
      }
    } return foundCount > 0;
  }

  // --- Apply Annotations (MODIFIED: No longer clears previous) ---
  function applyAnnotations(annotations, isSelection) {
    console.log(`Applying ${annotations.length} annotations. From selection: ${isSelection}`);
    // Determine the context. If it was a selection, we might want a more specific context
    // but for now, using the previously determined mainContentElement or body is fine.
    if (!mainContentElement) {
      // Try to find a reasonable context if not already set (e.g., if only selection was processed)
      mainContentElement = document.querySelector('article, [role="main"], .post-content, .entry-content, #main-content, #content') || document.body;
      console.warn("Main content element fallback triggered in applyAnnotations, using:", mainContentElement.tagName);
    }
    const context = mainContentElement || document.body;

    if (!annotations || annotations.length === 0) {
      displayMessage("No difficult phrases found in the provided text.", "info");
      return;
    }

    injectAnnotationStyles();
    // clearPreviousAnnotations(); // <<<--- REMOVED THIS LINE

    let appliedCount = 0;
    // Sort by length descending to match longer phrases first
    annotations.sort((a, b) => b.phrase.length - a.phrase.length);

    annotations.forEach(annotation => {
      // ADDED: Check for vietnamese_translation field existence
      if (annotation.phrase && annotation.short_explanation && annotation.long_explanation && annotation.vietnamese_translation && annotation.phrase.trim().length > 0) {
        try {
          if (findAndWrapText(
            context, // Use the determined context
            annotation.phrase,
            annotation.short_explanation,
            annotation.long_explanation,
            annotation.vietnamese_translation // Pass it here
          )) {
            appliedCount++;
          }
        } catch (e) { console.error(`Error applying "${annotation.phrase}":`, e); }
      } else { console.warn("Skipping invalid or incomplete annotation:", annotation); }
    });
    console.log("Applied count for this run:", appliedCount);
    if (appliedCount > 0) {
      displayMessage(`Annotated ${appliedCount} new phrase(s). Hover over dotted text.`, "success");
    } else {
      // This message might be confusing if annotations already exist but none were found *in this specific text*
      displayMessage("Could not find the specific phrases from the analysis on this page.", "warning");
    }
  }

  // --- Clear Previous Annotations (Keep function, but don't call automatically) ---
  function clearPreviousAnnotations() {
    hideTooltip();
    // Use body as the ultimate container to find all spans, regardless of original context
    const container = document.body;
    const existingSpans = container.querySelectorAll('span.annotated-phrase');
    existingSpans.forEach(span => {
      span.removeEventListener('mouseenter', handlePhraseMouseEnter);
      span.removeEventListener('mouseleave', handlePhraseMouseLeave);
      const p = span.parentNode;
      if (p) {
        try {
          // Replace the span with its text content
          p.replaceChild(document.createTextNode(span.textContent || ''), span);
          p.normalize(); // Merges adjacent text nodes
        } catch (e) {
          console.warn("Could not cleanly remove annotation span:", e, span);
          // Fallback: just remove the span if replacement fails
          if (span.parentNode) {
            span.remove();
          }
        }
      } else {
        // If span has no parent (shouldn't happen often), just remove listeners
        span.remove();
      }
    });
    console.log("Cleared previous annotations and listeners.");
  }

  // --- Inject CSS (Keep as is) ---
  function injectAnnotationStyles() {
    const styleId = 'annotator-styles';
    if (document.getElementById(styleId)) return;

    const css = `
      .annotated-phrase {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: #d32f2f; /* Changed color slightly */
        text-decoration-thickness: 1.5px;
        cursor: help;
        background-color: transparent;
        /* Add position relative if needed for pseudo-elements later, but not now */
      }

      /* Add a subtle visual difference for selection-based annotations? Optional */
      /*
      .annotated-phrase[data-from-selection="true"] {
         text-decoration-color: #1976D2;
      }
      */

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
        font-size: 0.8em; /* Slightly smaller base font */
        line-height: 1.4;
        text-align: left;
        border-radius: 6px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        white-space: pre-wrap;
        opacity: 0;
        transition: opacity 0.1s ease-in-out;
      }

      #annotator-tooltip-element.visible {
          display: block;
          opacity: 1;
      }

      #annotator-tooltip-element .short-explanation {
           font-weight: bold; display: block; margin-bottom: 5px; font-size: 1.05em; /* Make short slightly bigger */
       }
      #annotator-tooltip-element .explanation-separator {
           display: block; height: 1px; background-color: #455a64; margin: 6px 0 8px 0; /* Adjusted margin */
       }
      #annotator-tooltip-element .long-explanation {
          display: block; margin-bottom: 5px; /* Add margin if translation follows */
      }

      /* ADDED: Styles for Vietnamese Translation */
      #annotator-tooltip-element .vietnamese-separator {
           display: block; height: 1px; background-color: #455a64; margin: 8px 0 6px 0; /* Similar separator */
       }
       #annotator-tooltip-element .vietnamese-translation {
           display: block;
           color: #b0bec5; /* Slightly dimmer color */
           /* font-style: italic; /* Optional: make it italic */
       }
       #annotator-tooltip-element .vietnamese-translation strong {
           font-weight: bold;
           color: #cfd8dc; /* Slightly brighter label color */
       }


      /* Message styles remain the same */
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
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
    // console.log("Annotator styles injected/updated."); // Less noisy log
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

  // MODIFIED: Function to show tooltip, including Vietnamese translation
  function showTooltip(targetSpan) {
    const tip = getOrCreateTooltipElement();
    clearTimeout(tooltipTimeout);

    const shortExplanation = targetSpan.dataset.shortExplanation || '';
    const longExplanation = targetSpan.dataset.longExplanation || '';
    // ADDED: Get Vietnamese translation from dataset
    const vietnameseTranslation = targetSpan.dataset.vietnameseTranslation || '';

    // MODIFIED: Check if *any* explanation exists
    if (!shortExplanation && !longExplanation && !vietnameseTranslation) return;

    let htmlContent = '';
    if (shortExplanation) htmlContent += `<span class="short-explanation">${escapeHtml(shortExplanation)}</span>`;

    if (shortExplanation && longExplanation) htmlContent += `<span class="explanation-separator"></span>`;
    if (longExplanation) htmlContent += `<span class="long-explanation">${escapeHtml(longExplanation)}</span>`;

    // ADDED: Add Vietnamese translation section if it exists
    if (vietnameseTranslation) {
      // Add a separator if there was previous English content
      if (shortExplanation || longExplanation) {
        htmlContent += `<span class="explanation-separator vietnamese-separator"></span>`; // Use a specific class if needed
      }
      // Add the translation with a label
      htmlContent += `<span class="vietnamese-translation"><strong>Tiếng Việt:</strong> ${escapeHtml(vietnameseTranslation)}</span>`;
    }

    tip.innerHTML = htmlContent; // Set the combined HTML

    tip.classList.add('visible');
    positionTooltip(targetSpan, tip);

    console.log("Showing tooltip for:", targetSpan.textContent);
  }


  function hideTooltip() {
    if (tooltipElement) {
      clearTimeout(tooltipTimeout);
      tooltipElement.classList.remove('visible');
    }
  }

  // Position Tooltip Function (Revised, remains the same logic)
  function positionTooltip(targetSpan, tip) {
    const targetRect = targetSpan.getBoundingClientRect();
    const tipElement = tip;
    // Ensure tipRect is fetched *after* content is set and it's potentially visible (though opacity=0)
    // Re-fetch it here in case content changed size drastically
    requestAnimationFrame(() => { // Wait for potential reflow after content change
      const tipRect = tipElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const buffer = 8;

      let top, left;
      // Try placing above first
      let potentialTop = targetRect.top - tipRect.height - buffer;

      if (potentialTop >= buffer) { // Fits above?
        top = potentialTop;
        } else { // Doesn't fit above, try below
          top = targetRect.bottom + buffer;
          // Doesn't fit below either? Place at bottom edge of viewport.
          if (top + tipRect.height > viewportHeight - buffer) {
            top = viewportHeight - tipRect.height - buffer;
            // If it's still too tall for viewport, place at top edge.
            if (top < buffer) top = buffer;
          }
        }

      // Center horizontally relative to the target span
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);

      // Keep within viewport horizontally
      if (left < buffer) left = buffer;
      if (left + tipRect.width > viewportWidth - buffer) {
        left = viewportWidth - tipRect.width - buffer;
      }

      tipElement.style.top = `${Math.round(top)}px`;
      tipElement.style.left = `${Math.round(left)}px`;
    });
  }


  // --- Event Handlers ---
  function handlePhraseMouseEnter(event) {
    clearTimeout(tooltipTimeout);
    showTooltip(event.target);
  }

  function handlePhraseMouseLeave() {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(hideTooltip, 150);
  }

  // --- Helper ---
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    // Basic escaping, sufficient for text content
    return unsafe
      .replace(/&/g, "&") // Escape ampersand first
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, "\"")
      .replace(/'/g, "'"); // Use HTML entity for single quote
  }


  // --- Display Messages (MODIFIED slightly for custom message) ---
  let messageTimeout;
  function displayMessage(message, type = 'info', persistent = false) {
    injectAnnotationStyles(); // Ensure styles exist
    clearTimeout(messageTimeout);
    const tempMsgDiv = document.getElementById('annotator-message');
    if (tempMsgDiv) { tempMsgDiv.remove(); }
    if (persistent) { hideProcessingMessage(false); } // Hide previous persistent if showing new one

    const messageId = persistent ? 'annotator-processing-message' : 'annotator-message';
    let msgDiv = document.getElementById(messageId);
    if (!msgDiv) {
      msgDiv = document.createElement('div');
      msgDiv.id = messageId;
      document.body.appendChild(msgDiv);
    }

    msgDiv.textContent = message; // Use the provided message
    msgDiv.className = ''; // Clear existing classes
    msgDiv.classList.add(type); // Add the type class

    void msgDiv.offsetWidth;
    msgDiv.classList.add('visible');

    if (persistent) {
      processingMessageDiv = msgDiv;
    } else {
      messageTimeout = setTimeout(() => {
        if (msgDiv) {
          msgDiv.classList.remove('visible');
          msgDiv.addEventListener('transitionend', () => { if (msgDiv) msgDiv.remove(); }, { once: true }); // Safer remove
          setTimeout(() => { if (msgDiv && !msgDiv.classList.contains('visible')) msgDiv.remove(); }, 500);
        }
      }, 3500);
    }
  }


  // --- Hide Persistent Processing Message (Keep as is) ---
  function hideProcessingMessage(clearTemporary = true) {
    if (processingMessageDiv) {
      processingMessageDiv.classList.remove('visible');
      processingMessageDiv.addEventListener('transitionend', () => { if (processingMessageDiv) processingMessageDiv.remove(); }, { once: true }); // Safer remove
      // Fallback removal
      setTimeout(() => { if (processingMessageDiv && !processingMessageDiv.classList.contains('visible')) processingMessageDiv.remove(); }, 500);
      processingMessageDiv = null;
    }
    if (clearTemporary) {
      clearTimeout(messageTimeout);
      const tempMsg = document.getElementById('annotator-message');
      if (tempMsg) tempMsg.remove();
    }
  }


  // --- Message Listener (UPDATED) ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Content Script: Message received:", request.action);

    if (request.action === "getTextOrSelection") {
      const selectedText = window.getSelection().toString().trim();
      if (selectedText) {
        console.log("Content Script: Selection found:", selectedText.length);
        // Determine context later if needed, for now just send text
        sendResponse({ selectedText: selectedText });
      } else {
        console.log("Content Script: No text selected.");
        sendResponse({ selectedText: null }); // Signal no selection
      }
      return true; // Indicate potential async response (though it's sync here)
    }
    else if (request.action === "showProcessing") {
      // Use the message from the background script if provided
      const messageText = request.message || "Processing page content with Gemini...";
      // DON'T clear annotations here anymore
      // clearPreviousAnnotations();
      displayMessage(messageText, "info", true); // Show persistent message
      sendResponse({ status: "Processing notification shown" });
      return true;
    }
    else if (request.action === "extractText") {
      try {
        if (typeof Readability === 'undefined') {
          // Send specific error if Readability wasn't injected
          sendResponse({ error: "Extraction Error: Readability script not loaded." });
          hideProcessingMessage();
          displayMessage("Error extracting content: Readability script missing.", "error");
          return true; // Indicate response sent
        }
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone, {});
        const article = reader.parse();

        if (article && article.content && article.textContent.trim().length > 50) {
          console.log("Content Script: Readability extracted content.");
          // Set mainContentElement for annotation context *before* sending response
          mainContentElement = document.querySelector('article, [role="main"], .post-content, .entry-content, #main-content, #content') || document.body;
          sendResponse({ textContent: article.textContent });
        } else {
          console.warn("Content Script: Readability failed, falling back to body.innerText.");
          mainContentElement = document.body; // Fallback context
          const bodyText = document.body.innerText || "";
          if (bodyText.trim().length > 100) {
            sendResponse({ textContent: bodyText });
          } else {
            throw new Error("Could not extract sufficient readable content.");
          }
        }
      } catch (error) {
        console.error("Content Script: Extraction Error:", error);
        sendResponse({ error: `Extraction Error: ${error.message || String(error)}` });
        hideProcessingMessage();
        displayMessage(`Error extracting content: ${error.message || 'Unknown extraction error'}`, "error");
      }
      return true; // Indicate async response
    }
    else if (request.action === "applyAnnotations") {
      hideProcessingMessage(); // Hide the "Processing..." message
      const annotations = Array.isArray(request.annotations) ? request.annotations : [];
      // Pass the isSelection flag
      applyAnnotations(annotations, request.isSelection || false);
      sendResponse({ status: "Annotations applied" });
      return true;
    }
    else if (request.action === "showError") {
      hideProcessingMessage();
      console.error("Content Script: Error received:", request.error);
      displayMessage(`Error: ${request.error || 'An unknown error occurred.'}`, 'error');
      sendResponse({ status: "Error displayed" });
      return true;
    }
    // Optional: Add action to explicitly clear annotations if desired later
    // else if (request.action === "clearAllAnnotations") {
    //    clearPreviousAnnotations();
    //    displayMessage("Annotations cleared.", "info");
    //    sendResponse({ status: "Annotations cleared"});
    //    return true;
    // }

    console.warn(`Content Script: Unknown action received: ${request.action}`);
    // Return false or nothing for unhandled synchronous messages
  });

  // --- Initial Setup ---
  injectAnnotationStyles(); // Ensure styles are present on load
  console.log("Annotator content script initialization complete.");

})(); // IIFE
