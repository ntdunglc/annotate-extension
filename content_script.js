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

  // --- Helper to Find and Wrap Text ---
  // MODIFIED: Added vietnameseTranslation parameter
  function findAndWrapText(contextNode, searchText, shortExplanation, longExplanation, vietnameseTranslation) {
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
        // ADDED: Store Vietnamese translation in dataset
        span.dataset.vietnameseTranslation = vietnameseTranslation;
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

  // --- Apply Annotations ---
  function applyAnnotations(annotations) {
    console.log("Applying annotations:", annotations.length);
    if (!mainContentElement) { mainContentElement = document.body; console.warn("Main content element not identified, using document.body."); }
    if (!annotations || annotations.length === 0) { displayMessage("No difficult phrases found.", "info"); return; }

    injectAnnotationStyles();
    clearPreviousAnnotations();

    let appliedCount = 0;
    annotations.sort((a, b) => b.phrase.length - a.phrase.length);

    annotations.forEach(annotation => {
      // MODIFIED: Check for vietnamese_translation as well (assuming it's required)
      if (annotation.phrase && annotation.short_explanation && annotation.long_explanation && annotation.vietnamese_translation && annotation.phrase.trim().length > 0) {
        try {
          // MODIFIED: Pass vietnamese_translation to findAndWrapText
          if (findAndWrapText(
            mainContentElement || document.body,
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

  // --- Inject CSS ---
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
    const tipRect = tipElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buffer = 8;

    let top, left;
    let potentialTop = targetRect.top - tipRect.height - buffer;

    if (potentialTop >= buffer) {
      top = potentialTop;
    } else {
      top = targetRect.bottom + buffer;
      if (top + tipRect.height > viewportHeight - buffer) {
        top = viewportHeight - tipRect.height - buffer;
        if (top < buffer) top = buffer;
      }
    }

    left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);

    if (left < buffer) left = buffer;
    if (left + tipRect.width > viewportWidth - buffer) {
      left = viewportWidth - tipRect.width - buffer;
    }

    tipElement.style.top = `${Math.round(top)}px`;
    tipElement.style.left = `${Math.round(left)}px`;
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


  // --- Display Messages (Keep Original Logic) ---
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

    msgDiv.textContent = message;
    msgDiv.className = ''; // Clear existing classes
    msgDiv.classList.add(type); // Add the type class

    // Force reflow before adding 'visible' for transition to work
    void msgDiv.offsetWidth;

    msgDiv.classList.add('visible');

    if (persistent) {
      processingMessageDiv = msgDiv; // Store reference if persistent
    } else {
      messageTimeout = setTimeout(() => {
        if (msgDiv) {
          msgDiv.classList.remove('visible');
          // Remove element after transition finishes
          msgDiv.addEventListener('transitionend', () => msgDiv.remove(), { once: true });
          // Fallback removal in case transitionend doesn't fire
          setTimeout(() => { if (msgDiv && !msgDiv.classList.contains('visible')) msgDiv.remove(); }, 500);
        }
      }, 3500); // Message display duration
    }
  }


  // --- Hide Persistent Processing Message (Keep Original Logic) ---
  function hideProcessingMessage(clearTemporary = true) {
    if (processingMessageDiv) {
      processingMessageDiv.classList.remove('visible');
      processingMessageDiv.addEventListener('transitionend', () => processingMessageDiv && processingMessageDiv.remove(), { once: true });
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


  // --- Message Listener (Keep Original Logic) ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received:", request.action);
    if (request.action === "showProcessing") {
      clearPreviousAnnotations(); // Clear old annotations before processing
      displayMessage("Processing page content with Gemini...", "info", true); // Show persistent message
      sendResponse({ status: "Processing notification shown" });
      return true; // Indicates async response
    }
    else if (request.action === "extractText") {
      // Use try-catch block for robust error handling during extraction
      try {
        // Check if Readability library is loaded
        if (typeof Readability === 'undefined') {
          throw new Error("Readability library is not available.");
        }

        // Clone the document to avoid altering the live page during parsing
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone, {
          // Options for Readability (optional, adjust as needed)
          // keepClasses: false, // Keep or remove CSS classes
          // debug: false, // Set to true for debugging logs
        });
        const article = reader.parse();

        // Check if Readability successfully parsed content and it's substantial
        if (article && article.content && article.textContent.trim().length > 50) {
          console.log("Readability extracted content successfully.");
          // Attempt to find a more specific main content element for annotation context
          mainContentElement = document.querySelector('article, [role="main"], .post-content, .entry-content, #main-content, #content') || document.body;
          sendResponse({ textContent: article.textContent });
        } else {
          // Fallback to using innerText of the body if Readability fails or yields little text
          console.warn("Readability did not extract substantial content, falling back to body.innerText.");
          mainContentElement = document.body; // Use body as context
          const bodyText = document.body.innerText || ""; // Use innerText as it reflects rendered text
          if (bodyText.trim().length > 100) { // Check if body text is substantial
            sendResponse({ textContent: bodyText });
          } else {
            // If even body text is minimal, report an error
            throw new Error("Could not extract sufficient readable content from the page.");
          }
        }
      } catch (error) {
        // Handle errors during extraction
        console.error("Extraction Error:", error);
        sendResponse({ error: `Extraction Error: ${error.message || String(error)}` });
        // Display error message to the user
        hideProcessingMessage(); // Hide processing message if it was shown
        displayMessage(`Error extracting content: ${error.message || 'Unknown extraction error'}`, "error");
      }
      return true; // Indicate async response
    }
    else if (request.action === "applyAnnotations") {
      hideProcessingMessage(); // Hide the "Processing..." message
      // Ensure annotations is an array, default to empty if not
      const annotations = Array.isArray(request.annotations) ? request.annotations : [];
      applyAnnotations(annotations);
      sendResponse({ status: "Annotations applied" });
      return true; // Indicate async response (though applyAnnotations is sync here)
    }
    else if (request.action === "showError") {
      hideProcessingMessage(); // Hide processing message
      console.error("Error received from background/popup:", request.error);
      displayMessage(`Error: ${request.error || 'An unknown error occurred.'}`, 'error');
      sendResponse({ status: "Error displayed" });
      return true; // Indicate async response
    }
    // Optional: Handle unknown actions
    // else {
    //  console.warn("Unknown action received:", request.action);
    //  sendResponse({ status: "Unknown action ignored" });
    // }
    // Return false for synchronous messages if no async operation started
    // return false;
  });

  // --- Initial Setup ---
  injectAnnotationStyles(); // Ensure styles are present on load
  console.log("Annotator script initialization complete.");

})(); // IIFE