// Function to get the stored API key
async function getApiKey() {
  const result = await chrome.storage.local.get(['geminiApiKey']);
  return result.geminiApiKey;
}

// Function to call the Gemini API
async function callGeminiApi(apiKey, textContent) {
  // Define model once at the top
  const model = "gemini-2.0-flash-lite";
  console.warn(`Using specified model: ${model}. Ensure this model exists and is accessible via your API key.`);

  if (!apiKey) {
    console.error("Gemini API Key not set. Please set it in the extension options.");
    return { error: "API Key not configured." };
  }
  // Prompt using backticks, balanced audience focus, with Vietnamese Translation (UPDATED)
  const prompt = `Analyze the text below. Your goal is to be comprehensive yet discerning. Identify **all** phrases, terms (including technical jargon, acronyms, less common idioms or phrasal verbs, specific named entities like organizations or events if not widely known, and potentially ambiguous vocabulary) that **might be difficult or unfamiliar** to a **broad general audience**. This audience includes people with varying backgrounds and levels of familiarity with English, but assume a reasonable level of general knowledge.

**Err on the side of inclusion, but focus on terms likely to impede understanding for non-specialists**: if a term *could* reasonably be unknown or less familiar to *some* members of a general audience (beyond the most common vocabulary and expressions), please include it.

For each identified phrase, provide:
1.  The original phrase (\`phrase\`).
2.  A concise explanation suitable for a brief tooltip (\`short_explanation\`), written in clear, accessible English.
3.  A more detailed explanation exploring the concept (\`long_explanation\`), aiming for clarity and providing context or a simple example if helpful, written in clear, accessible English.
4.  A concise Vietnamese translation of the original phrase (\`vietnamese_translation\`).

Respond ONLY with a single, valid JSON array containing objects. Each object must have exactly FOUR string keys: "phrase", "short_explanation", "long_explanation", and "vietnamese_translation".
Do not include any text before or after the JSON array. Do not use markdown formatting like backticks around the JSON block itself.
If no potentially unfamiliar phrases are found, return an empty JSON array: [].

Example Format:
[{ "phrase": "fiscal quarter", "short_explanation": "A three-month period on a company's financial calendar.", "long_explanation": "A fiscal quarter is one of four three-month periods that make up a company's financial year. It's used for reporting financial results and performance. Unlike calendar quarters (Jan-Mar, etc.), a company's fiscal quarter can start in any month.", "vietnamese_translation": "quý tài chính" }, { "phrase": "level playing field", "short_explanation": "A situation of fair competition.", "long_explanation": "The term 'level playing field' refers to fairness in competition, where no single competitor has an undue advantage or disadvantage. In trade, this often relates to removing subsidies or tariffs that favor domestic industries unfairly.", "vietnamese_translation": "sân chơi bình đẳng" }, { "phrase": "synergy", "short_explanation": "Combined effect greater than the sum of parts.", "long_explanation": "Synergy describes a situation where interacting elements (like departments in a company or different substances) produce a combined effect that is greater than the sum of their separate effects. For example, a merger might aim for synergy, hoping the combined company will be more profitable than the two were individually.", "vietnamese_translation": "sức mạnh tổng hợp" } ]

Text to analyze:
---
${textContent}
---
JSON Array:`;

  // Use v1beta endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`Sending prompt to Gemini model: ${model}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
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
      if (response.status === 400 && errorText.includes("API key not valid")) { errorData.error.message = "Invalid API Key. Check options."; }
      else if (response.status === 404 || (response.status === 400 && errorText.includes("not found"))) { errorData.error.message = `Model '${model}' not found or inaccessible.`; }
      console.error("API Error:", response.status, errorData);
      return { error: `API Error (${response.status}): ${errorData.error?.message || 'Unknown API error'}` };
    }

    const data = await response.json();
    let annotationsJson = null;
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      let rawJsonText = data.candidates[0].content.parts[0].text;
        try {
          annotationsJson = JSON.parse(rawJsonText);
          if (!Array.isArray(annotationsJson)) throw new Error("Not a JSON array.");
          annotationsJson.forEach((item, index) => {
            if (!item || typeof item !== 'object' || !item.phrase || !item.short_explanation || !item.long_explanation) throw new Error(`Invalid object structure index ${index}.`);
            if (typeof item.phrase !== 'string' || typeof item.short_explanation !== 'string' || typeof item.long_explanation !== 'string') throw new Error(`Invalid data types index ${index}.`);
            });
          console.log("Parsed annotations:", annotationsJson.length);
            return { annotations: annotationsJson };
        } catch (error) {
          console.error("JSON parse failed:", error, "Raw:", rawJsonText);
          const cleaned = rawJsonText.replace(/^```json\s*|\s*```$/g, '').trim();
          if (cleaned !== rawJsonText) { // Try cleaning markdown
            try {
              annotationsJson = JSON.parse(cleaned);
              if (!Array.isArray(annotationsJson)) throw new Error("Not a JSON array.");
              annotationsJson.forEach((item, index) => { /* validation */ if (!item || typeof item !== 'object' || !item.phrase || !item.short_explanation || !item.long_explanation) throw new Error(`Invalid object index ${index}.`); if (typeof item.phrase !== 'string' || typeof item.short_explanation !== 'string' || typeof item.long_explanation !== 'string') throw new Error(`Invalid types index ${index}.`); });
              console.log("Parsed after cleaning markdown:", annotationsJson.length);
              return { annotations: annotationsJson };
            } catch (fallbackError) { return { error: `Failed parse (tried cleaning): ${fallbackError.message}` }; }
          }
          return { error: `Failed parse: ${error.message}` };
        }
    } else {
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") return { error: `Gemini stopped: ${finishReason}` };
      console.warn("Unexpected API response format:", data);
      return { error: "Could not extract text from API response." };
    }
  } catch (error) {
    console.error("Network/fetch error:", error);
    return { error: `Network error: ${error.message}` };
  }
}

// --- Action Button Click Listener (UPDATED) ---
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Action clicked, Tab ID:", tab.id);
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.log("API Key missing, opening options.");
    chrome.runtime.openOptionsPage();
    return;
  }

  // Inject scripts first
  try {
    console.log("Injecting Readability.js...");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['Readability.js'] });
    console.log("Injecting content_script.js...");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
    console.log("Scripts injected.");

    // *Immediately* show persistent processing notification in the content script
    console.log("Sending 'showProcessing' message...");
    chrome.tabs.sendMessage(tab.id, { action: "showProcessing" }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Could not send 'showProcessing' message:", chrome.runtime.lastError.message);
        // Proceed anyway, but log the warning
      } else {
        console.log("Processing notification sent.");
      }

      // Now request text extraction
      console.log("Sending 'extractText' message...");
      chrome.tabs.sendMessage(tab.id, { action: "extractText" }, (extractResponse) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending 'extractText':", chrome.runtime.lastError.message);
            chrome.tabs.sendMessage(tab.id, { action: "showError", error: `Comms Error: ${chrome.runtime.lastError.message}` });
          } else if (extractResponse && extractResponse.error) {
            console.error("Extraction error:", extractResponse.error);
            chrome.tabs.sendMessage(tab.id, { action: "showError", error: `Extraction Error: ${extractResponse.error}` });
          } else if (extractResponse && extractResponse.textContent) {
            console.log("Received text content length:", extractResponse.textContent.length);
            callGeminiApi(apiKey, extractResponse.textContent).then(result => {
              if (result.error) {
                console.error("Gemini API call failed:", result.error);
                chrome.tabs.sendMessage(tab.id, { action: "showError", error: `Gemini Error: ${result.error}` });
              } else if (result.annotations) {
                console.log("Sending annotations:", result.annotations.length);
                chrome.tabs.sendMessage(tab.id, { action: "applyAnnotations", annotations: result.annotations });
              } else {
                console.warn("Gemini API OK but no annotations or unexpected structure.");
                chrome.tabs.sendMessage(tab.id, { action: "showError", error: "Gemini returned success but no annotations." });
              }
            });
          } else {
            console.warn("No text content received.");
            chrome.tabs.sendMessage(tab.id, { action: "showError", error: "Could not extract readable content." });
          }
      }); // End extractText sendMessage
    }); // End showProcessing sendMessage

  } catch (err) {
    console.error("Failed to inject scripts:", err);
  // Cannot reliably send a message to the content script if injection failed.
  }
});

console.log("Background script loaded.");