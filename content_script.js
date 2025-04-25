// /Users/dungnguyen/workspace/annotate-extension/content_script.js
(() => {
  // Prevent multiple runs
  if (window.hasRunAnnotatorScript) return;
  window.hasRunAnnotatorScript = true;
  console.log("Annotator content script loaded.");

  let mainContentElement = null;
  let processingMessageDiv = null;

  // --- Helper to Find and Wrap Text ---
  // Stores both explanations
  function findAndWrapText(contextNode, searchText, shortExplanation, longExplanation) {
    const walker = document.createTreeWalker(contextNode, NodeFilter.SHOW_TEXT, { acceptNode: (node) => { const p = node.parentNode.tagName.toUpperCase(); if (p === 'SCRIPT' || p === 'STYLE' || node.parentNode.classList.contains('annotated-phrase')) return NodeFilter.FILTER_REJECT; return node.nodeValue.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    let node, foundCount = 0; const nodesToProcess = []; while (node = walker.nextNode()) nodesToProcess.push(node);
    for (const textNode of nodesToProcess) {
      if (!textNode.parentNode) continue; let matchIndex = textNode.nodeValue.indexOf(searchText);
      while (matchIndex !== -1) {
        foundCount++; const matchEnd = matchIndex + searchText.length; const span = document.createElement('span'); span.className = 'annotated-phrase'; span.dataset.shortExplanation = shortExplanation; span.dataset.longExplanation = longExplanation; span.textContent = textNode.nodeValue.substring(matchIndex, matchEnd);
        const afterTextNode = textNode.splitText(matchIndex); afterTextNode.nodeValue = afterTextNode.nodeValue.substring(searchText.length); textNode.parentNode.insertBefore(span, afterTextNode);
        break; // Simple handling
      }
    } return foundCount > 0;
  }

  // --- Apply Annotations ---
  function applyAnnotations(annotations) {
    // Note: hideProcessingMessage() is called before this function in the message listener
    console.log("Applying annotations:", annotations.length);
    if (!mainContentElement) { mainContentElement = document.body; console.warn("Main content element not identified."); }
    if (!annotations || annotations.length === 0) { displayMessage("No difficult phrases found.", "info"); return; }
    clearPreviousAnnotations(); let appliedCount = 0;
    annotations.sort((a, b) => b.phrase.length - a.phrase.length);
    annotations.forEach(annotation => { if (annotation.phrase && annotation.short_explanation && annotation.long_explanation && annotation.phrase.trim().length > 0) { try { if (findAndWrapText(mainContentElement, annotation.phrase, annotation.short_explanation, annotation.long_explanation)) appliedCount++; } catch (e) { console.error(`Error applying "${annotation.phrase}":`, e); } } else { console.warn("Skipping invalid annotation:", annotation); } });
    console.log("Applied count:", appliedCount);
    if (appliedCount > 0) { injectAnnotationStyles(); displayMessage(`Annotated ${appliedCount} phrase(s).`, "success"); } else { displayMessage("Could not find phrases on page.", "warning"); }
  }

  // --- Clear Previous Annotations ---
  function clearPreviousAnnotations() { const existingSpans = (mainContentElement || document.body).querySelectorAll('span.annotated-phrase'); existingSpans.forEach(span => { const p = span.parentNode; p.replaceChild(document.createTextNode(span.textContent), span); p.normalize(); }); }

  // --- Inject CSS (CORRECTED STRING ASSIGNMENT) ---
  function injectAnnotationStyles() {
    const styleId = 'annotator-styles';
    if (document.getElementById(styleId)) return;

    // Use TEMPLATE LITERAL (backticks ) for the CSS string
    const css = `
      .annotated-phrase {
        text-decoration: underline;
        text-decoration-style: wavy;
        text-decoration-color: #d32f2f; /* Bold red */
        text-decoration-thickness: 1.5px;
        cursor: help;
        position: relative;
        background-color: transparent;
      }

      /* Tooltip container (Bigger + Combined Explanations) */
      .annotated-phrase::after {
        /* Combine short and long explanations. Use SINGLE backslash \A for line breaks */
        content: attr(data-short-explanation) "\\A\\A---\\A" attr(data-long-explanation); /* Two line breaks before ---, one after */
        white-space: pre-wrap; /* Crucial: Allows wrapping and respects \A */

        position: absolute;
        bottom: calc(100% + 10px); /* More space + arrow */
        left: 50%;
        transform: translateX(-50%);
        width: auto;
        min-width: 600px;
        max-width: 650px;
        background-color: #263238; /* Dark blue-gray */
        color: #eceff1; /* Light text */
        font-family: sans-serif;
        font-size: 1.0em; /* Increased Font size */
        line-height: 1.5; /* More line spacing */
        text-align: left;
        text-decoration: none;
        padding: 12px 15px; /* Increased Padding */
        border-radius: 6px;
        z-index: 100000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.25s ease-in-out;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      }

      /* Tooltip arrow (Keep the same style as before) */
      .annotated-phrase::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 4px; /* Position arrow correctly */
          border-width: 6px;
          border-style: solid;
          border-color: #263238 transparent transparent transparent; /* Match tooltip bg */
          z-index: 10001; /* Above tooltip body slightly */
          pointer-events: none;
           opacity: 0;
          transition: opacity 0.25s ease-in-out;
       }

      .annotated-phrase:hover::before,
      .annotated-phrase:hover::after {
         opacity: 1;
      }

      /* Notification messages (Shared Styles) */
      #annotator-message, /* For temporary messages */
      #annotator-processing-message {
         position: fixed;
         top: 20px;
         right: 20px;
         padding: 12px 18px;
         border-radius: 5px;
         color: white;
         font-family: sans-serif;
         font-size: 14px;
         z-index: 10001;
         opacity: 0;
         transition: opacity 0.4s ease-in-out;
         box-shadow: 0 2px 8px rgba(0,0,0,0.25);
         pointer-events: none; /* Allow clicks through notification */
      }

      /* Make visible */
      #annotator-message.visible,
      #annotator-processing-message.visible {
           opacity: 1;
      }

      /* Temporary Message Types */
      #annotator-message.success { background-color: #4CAF50; }
      #annotator-message.error { background-color: #f44336; }
      #annotator-message.warning { background-color: #ff9800; }
      #annotator-message.info { background-color: #2196F3; }

      /* Persistent Processing Message Type */
      #annotator-processing-message { background-color: #607d8b; } /* Blue Grey */
    `; // END OF TEMPLATE LITERAL
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Display Messages (Handles both temporary and persistent) ---
  let messageTimeout;
  function displayMessage(message, type = 'info', persistent = false) {
    // Ensure styles are injected before showing any message
    injectAnnotationStyles();

    // Clear any existing *temporary* message timeout and remove the temporary div immediately
    clearTimeout(messageTimeout);
    const tempMsgDiv = document.getElementById('annotator-message');
    if (tempMsgDiv) {
      tempMsgDiv.remove();
    }

    // If this is a persistent message, hide any existing persistent message first
    if (persistent) {
      hideProcessingMessage(false); // Hide without removing temporary messages again
    }

    const messageId = persistent ? 'annotator-processing-message' : 'annotator-message';

    // Get or create the appropriate message div
    let msgDiv = document.getElementById(messageId);
    if (!msgDiv) { msgDiv = document.createElement('div'); msgDiv.id = messageId; document.body.appendChild(msgDiv); }

    msgDiv.textContent = message; msgDiv.className = type; // Reset classes first
    requestAnimationFrame(() => { requestAnimationFrame(() => { msgDiv.classList.add('visible'); }); });
    if (persistent) { processingMessageDiv = msgDiv; }
    else { messageTimeout = setTimeout(() => { if (msgDiv) { msgDiv.classList.remove('visible'); msgDiv.addEventListener('transitionend', () => msgDiv.remove(), { once: true }); } }, 3500); }
  }

  // --- Hide Persistent Processing Message ---
  function hideProcessingMessage(clearTemporary = true) {
    if (processingMessageDiv) {
      processingMessageDiv.classList.remove('visible');
      // Remove from DOM after fade out
      processingMessageDiv.addEventListener('transitionend', () => processingMessageDiv && processingMessageDiv.remove(), { once: true });
      processingMessageDiv = null;
    }
    // Option to also clear any lingering temporary message (used when showing final status)
    if (clearTemporary) {
      clearTimeout(messageTimeout);
      const tempMsg = document.getElementById('annotator-message');
      if (tempMsg) tempMsg.remove();
    }
  }

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showProcessing") { displayMessage("Processing page content with Gemini...", "info", true); sendResponse({ status: "Processing notification shown" }); return true; }
    else if (request.action === "extractText") {
      try {
        if (typeof Readability === 'undefined') throw new Error("Readability library missing.");
        const article = new Readability(document.cloneNode(true), { keepClasses: false, debug: false }).parse();
        if (article && article.content && article.textContent.trim().length > 50) { mainContentElement = document.querySelector('article, [role="main"], .post-content, .entry-content, #main-content, #content') || document.body; sendResponse({ textContent: article.textContent }); }
        else { mainContentElement = document.body; const bodyText = document.body.innerText || ""; if (bodyText.trim().length > 100) { sendResponse({ textContent: bodyText }); } else { throw new Error("Could not extract readable content."); } }
      } catch (error) { console.error("Extraction Error:", error); sendResponse({ error: `Extraction Error: ${error.message}` }); hideProcessingMessage(); displayMessage(`Error: ${error.message}`, "error"); } return true;
    }
    else if (request.action === "applyAnnotations") {
      // Hide processing message *before* applying annotations and showing final status
      hideProcessingMessage();
      applyAnnotations(request.annotations); // This function now also calls displayMessage
      sendResponse({ status: "Annotations applied" }); return true;
    }
    else if (request.action === "showError") {
      hideProcessingMessage(); // Hide processing message first
      console.error("Error from background:", request.error);
      displayMessage(`Error: ${request.error}`, 'error'); // Show temporary error
      sendResponse({ status: "Error displayed" }); return true;
    }
    // Return false or undefined for unhandled actions
  });

})(); // IIFE