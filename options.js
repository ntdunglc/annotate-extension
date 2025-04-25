function saveOptions(e) {
  e.preventDefault();
  const apiKey = document.getElementById('apiKey').value;
  const status = document.getElementById('status');
  if (!apiKey || apiKey.trim() === '') {
     status.textContent = 'API Key cannot be empty.';
     status.style.color = 'red';
     setTimeout(() => { status.textContent = ''; }, 2000);
     return;
  }
  chrome.storage.local.set({
    geminiApiKey: apiKey.trim()
  }, () => {
    status.textContent = 'API Key saved successfully!';
    status.style.color = 'green';
    setTimeout(() => {
      status.textContent = '';
    }, 1500);
  });
}

function restoreOptions() {
  chrome.storage.local.get({geminiApiKey: ''}, (result) => {
    document.getElementById('apiKey').value = result.geminiApiKey;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
