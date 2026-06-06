// /Users/dungnguyen/workspace/annotate-extension/background.js

// Function to get the stored API key
async function getApiKey() {
  const result = await chrome.storage.local.get(['geminiApiKey']);
  return result.geminiApiKey;
}

// Function to call the Gemini API
async function callGeminiApi(apiKey, textContent) {
  // Define model once at the top - use a model that supports schema well
  const model = "gemini-3.1-flash-lite";
  console.warn(`Using specified model: ${model}. Ensure this model exists and is accessible via your API key.`);

  if (!apiKey) {
    console.error("Gemini API Key not set. Please set it in the extension options.");
    return { error: "API Key not configured." };
  }

  // Define the desired schema for the response
  const desiredSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        phrase: { type: "STRING" },
        short_explanation: { type: "STRING" },
        long_explanation: { type: "STRING" },
        vietnamese_translation: { type: "STRING" },
      },
      required: ["phrase", "short_explanation", "long_explanation", "vietnamese_translation"]
    }
  };

  // Prompt can be slightly simplified as schema handles structure.
  // Focus on the task and desired content within the schema.
  const prompt = `Analyze the text below. Your goal is to be comprehensive yet discerning. Identify **all** phrases, terms (including technical jargon, acronyms, less common idioms or phrasal verbs, specific named entities like organizations or events if not widely known, and potentially ambiguous vocabulary) that **might be difficult or unfamiliar** to a **broad general audience**. This audience includes people with varying backgrounds and levels of familiarity with English, but assume a reasonable level of general knowledge.

**Err on the side of inclusion, but focus on terms likely to impede understanding for non-specialists**: if a term *could* reasonably be unknown or less familiar to *some* members of a general audience (beyond the most common vocabulary and expressions), please include it.

For each identified phrase, provide:
1.  The original phrase.
2.  A concise explanation suitable for a brief tooltip, in clear, accessible English.
3.  A more detailed explanation exploring the concept, in clear, accessible English.
4.  A concise Vietnamese translation of the original phrase.

Follow the provided JSON schema for your response structure. If no potentially unfamiliar phrases are found, return an empty JSON array.

Text to analyze:
---
${textContent}
---
`; // Removed explicit JSON formatting instructions and example from prompt

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`Sending prompt to Gemini model: ${model} with schema...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: desiredSchema, // ADDED SCHEMA
          // Consider adjusting temperature for more deterministic output with schema
          // temperature: 0.2,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
      }),
    });

    if (!response.ok) {
      let errorData;
      let errorText = await response.text();
      try { errorData = JSON.parse(errorText); }
      catch (e) { errorData = { error: { message: `Non-JSON API error (${response.status}): ${errorText}` } }; }

      if (response.status === 400 && errorText.includes("API key not valid")) {
        errorData.error.message = "Invalid API Key. Check options.";
      } else if (response.status === 404 || (response.status === 400 && errorText.includes("not found"))) {
        errorData.error.message = `Model '${model}' not found or inaccessible.`;
      } else if (response.status === 400 && errorData.error && errorData.error.message &&
        (errorData.error.message.toLowerCase().includes("schema") ||
          errorData.error.message.toLowerCase().includes("response_schema"))) {
        errorData.error.message = `Schema validation error or incompatible schema: ${errorData.error.message}`;
      }
      console.error("API Error:", response.status, errorData);
      return { error: `API Error (${response.status}): ${errorData.error?.message || 'Unknown API error'}` };
    }

    const data = await response.json();
    let annotationsJson = null;

    // When responseSchema is used, the API should directly return the JSON
    // in the structure you defined, within data.candidates[0].content.parts[0].text
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      let rawJsonText = data.candidates[0].content.parts[0].text;
        try {
          annotationsJson = JSON.parse(rawJsonText); // The text itself should be the JSON array

          // Basic validation (API should have validated against schema, but good for sanity check)
          if (!Array.isArray(annotationsJson)) {
            // Check if it's an object with an array inside (sometimes happens with very specific schema issues)
            if (typeof annotationsJson === 'object' && annotationsJson !== null && Array.isArray(Object.values(annotationsJson)[0])) {
              console.warn("Response was an object containing an array, taking the first array value.");
              annotationsJson = Object.values(annotationsJson)[0];
            } else {
              throw new Error("Response is not a JSON array as per schema.");
            }
          }

          annotationsJson.forEach((item, index) => {
            if (!item || typeof item !== 'object' ||
              !item.phrase || typeof item.phrase !== 'string' ||
              !item.short_explanation || typeof item.short_explanation !== 'string' ||
              !item.long_explanation || typeof item.long_explanation !== 'string' ||
              !item.vietnamese_translation || typeof item.vietnamese_translation !== 'string') {
              throw new Error(`Invalid object structure or type in array at index ${index}.`);
            }
          });
          console.log("Parsed annotations (schema enforced):", annotationsJson.length);
            return { annotations: annotationsJson };
        } catch (error) {
          console.error("JSON parse/validation failed (even with schema):", error, "Raw:", rawJsonText);
          // Markdown cleaning is less likely needed with schema, but as a final fallback.
          const cleaned = rawJsonText.replace(/^```json\s*|\s*```$/g, '').trim();
          if (cleaned !== rawJsonText) {
            try {
              annotationsJson = JSON.parse(cleaned);
              if (!Array.isArray(annotationsJson)) throw new Error("Cleaned response is not a JSON array.");
              // Re-run basic validation
              annotationsJson.forEach((item, index) => {
                if (!item || typeof item !== 'object' || !item.phrase || !item.short_explanation || !item.long_explanation || !item.vietnamese_translation) throw new Error(`Invalid object structure index ${index}.`);
                if (typeof item.phrase !== 'string' || typeof item.short_explanation !== 'string' || typeof item.long_explanation !== 'string' || typeof item.vietnamese_translation !== 'string') throw new Error(`Invalid data types index ${index}.`);
              });
              console.log("Parsed after cleaning markdown (schema enforced):", annotationsJson.length);
              return { annotations: annotationsJson };
            } catch (fallbackError) {
              return { error: `Failed to parse (even after cleaning, with schema): ${fallbackError.message}` };
            }
          }
          return { error: `Failed to parse JSON response (with schema): ${error.message}` };
        }
    } else {
      const finishReason = data?.candidates?.[0]?.finishReason;
      const finishDetails = data?.candidates?.[0]?.finishDetails;
      if (finishReason === "OTHER" || finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "MAX_TOKENS") {
        console.error(`Gemini stopped: ${finishReason}`, finishDetails || data);
        let message = `Gemini stopped: ${finishReason}.`;
        if (finishReason === "OTHER" && data.promptFeedback && data.promptFeedback.blockReason) {
          message += ` Prompt blocked: ${data.promptFeedback.blockReason}. ${data.promptFeedback.blockReasonMessage || ''}`;
        } else if (data.candidates?.[0]?.safetyRatings?.some(r => r.blocked)) {
          message += ` Content blocked due to safety settings.`;
        }
        return { error: message };
      }
      console.warn("Unexpected API response format (no text part, even with schema):", JSON.stringify(data, null, 2));
      return { error: "Could not extract valid JSON text from API response using schema." };
    }
  } catch (error) {
    console.error("Network/fetch error:", error);
    return { error: `Network error: ${error.message}` };
  }
}

// --- Helper function to show the processing message (avoids code duplication) ---
function displayProcessingMessage(tabId, message) {
  console.log("Sending 'showProcessing' message:", message);
  chrome.tabs.sendMessage(tabId, { action: "showProcessing", message: message }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Could not send 'showProcessing' message:", chrome.runtime.lastError.message);
    } else {
      console.log("Processing notification sent to content script.");
    }
  });
}

// --- Reusable Annotation Functions ---
async function annotateSelection(tabId, selectedText) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.log("API Key missing, opening options.");
    chrome.runtime.openOptionsPage();
    return;
  }

  displayProcessingMessage(tabId, "Processing selected text with Gemini...");

  try {
    const result = await callGeminiApi(apiKey, selectedText);
    if (result.error) {
      console.error("Gemini API call failed for selection:", result.error);
      chrome.tabs.sendMessage(tabId, { action: "showError", error: `Gemini Error: ${result.error}` });
    } else if (result.annotations) {
      console.log("Sending annotations for selection:", result.annotations.length);
      chrome.tabs.sendMessage(tabId, { action: "applyAnnotations", annotations: result.annotations, isSelection: true });
    } else {
      console.warn("Gemini API OK (selection) but no annotations or unexpected structure.");
      chrome.tabs.sendMessage(tabId, { action: "showError", error: "Gemini returned success but no annotations for selection." });
    }
  } catch (err) {
    console.error("Error in annotateSelection:", err);
    chrome.tabs.sendMessage(tabId, { action: "showError", error: `Internal Error: ${err.message}` });
  }
}

async function annotatePage(tabId) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.log("API Key missing, opening options.");
    chrome.runtime.openOptionsPage();
    return;
  }

  displayProcessingMessage(tabId, "Processing page content with Gemini...");

  try {
    console.log("Injecting Readability.js...");
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['Readability.js'] });
    console.log("Readability injected. Sending 'extractText' message...");
    
    chrome.tabs.sendMessage(tabId, { action: "extractText" }, async (extractResponse) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending 'extractText':", chrome.runtime.lastError.message);
        chrome.tabs.sendMessage(tabId, { action: "showError", error: `Comms Error (ExtractText): ${chrome.runtime.lastError.message}` });
        return;
      }

      if (extractResponse && extractResponse.error) {
        console.error("Extraction error:", extractResponse.error);
        chrome.tabs.sendMessage(tabId, { action: "showError", error: `Extraction Error: ${extractResponse.error}` });
        return;
      }

      if (extractResponse && extractResponse.textContent) {
        console.log("Received text content length:", extractResponse.textContent.length);
        const result = await callGeminiApi(apiKey, extractResponse.textContent);
        if (result.error) {
          console.error("Gemini API call failed:", result.error);
          chrome.tabs.sendMessage(tabId, { action: "showError", error: `Gemini Error: ${result.error}` });
        } else if (result.annotations) {
          console.log("Sending annotations:", result.annotations.length);
          chrome.tabs.sendMessage(tabId, { action: "applyAnnotations", annotations: result.annotations, isSelection: false });
        } else {
          console.warn("Gemini API OK but no annotations or unexpected structure.");
          chrome.tabs.sendMessage(tabId, { action: "showError", error: "Gemini returned success but no annotations." });
        }
      } else {
        console.warn("No text content received after Readability.");
        chrome.tabs.sendMessage(tabId, { action: "showError", error: "Could not extract readable content from the page." });
      }
    });
  } catch (err) {
    console.error("Failed to inject Readability.js:", err);
    chrome.tabs.sendMessage(tabId, { action: "showError", error: `Script Injection Error (Readability): ${err.message}` });
  }
}

async function clearAnnotations(tabId) {
  try {
    console.log("Injecting content_script.js for clearing...");
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content_script.js'] });
    console.log("Sending 'clearAllAnnotations' message...");
    chrome.tabs.sendMessage(tabId, { action: "clearAllAnnotations" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Could not send 'clearAllAnnotations' message:", chrome.runtime.lastError.message);
      } else {
        console.log("Cleared annotations request processed.");
      }
    });
  } catch (err) {
    console.error("Failed to inject or clear annotations:", err);
  }
}

// --- Action Button Click Listener ---
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Action clicked, Tab ID:", tab.id);
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.log("API Key missing, opening options.");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    console.log("Injecting content_script.js...");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
    console.log("Content script injected.");

    console.log("Sending 'getTextOrSelection' message...");
    chrome.tabs.sendMessage(tab.id, { action: "getTextOrSelection" }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error checking selection:", chrome.runtime.lastError.message);
        chrome.tabs.sendMessage(tab.id, { action: "showError", error: `Comms Error (Selection Check): ${chrome.runtime.lastError.message}` });
        return;
      }

      if (response && typeof response.selectedText === 'string' && response.selectedText.length > 0) {
        console.log("Received selected text length:", response.selectedText.length);
        await annotateSelection(tab.id, response.selectedText);
      } else {
        console.log("No text selected, proceeding with full page extraction.");
        await annotatePage(tab.id);
      }
    });
  } catch (err) {
    console.error("Failed to inject content_script.js:", err);
  }
});

// --- Context Menu Registration ---
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated, registering context menus.");

  // Create context menu to annotate selected text (only visible on text selection)
  chrome.contextMenus.create({
    id: "annotate-selection",
    title: "Annotate Selection",
    contexts: ["selection"]
  });

  // Create context menu to annotate full page (only visible on action icon right-click)
  chrome.contextMenus.create({
    id: "annotate-page",
    title: "Annotate Page",
    contexts: ["action"]
  });

  // Create context menu to clear annotations (only visible on action icon right-click)
  chrome.contextMenus.create({
    id: "clear-annotations",
    title: "Clear Annotations",
    contexts: ["action"]
  });

  // Create context menu to open options page (only visible on action icon right-click)
  chrome.contextMenus.create({
    id: "open-options",
    title: "Options",
    contexts: ["action"]
  });
});

// --- Context Menu Click Listener ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log("Context menu clicked:", info.menuItemId, "Tab ID:", tab?.id);
  if (!tab || !tab.id) return;

  switch (info.menuItemId) {
    case "annotate-selection":
      if (info.selectionText) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
          await annotateSelection(tab.id, info.selectionText);
        } catch (err) {
          console.error("Failed to execute annotate selection:", err);
        }
      }
      break;

    case "annotate-page":
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
        await annotatePage(tab.id);
      } catch (err) {
        console.error("Failed to execute annotate page:", err);
      }
      break;

    case "clear-annotations":
      await clearAnnotations(tab.id);
      break;

    case "open-options":
      chrome.runtime.openOptionsPage();
      break;
  }
});

console.log("Background script loaded. Using schema for Gemini API calls.");