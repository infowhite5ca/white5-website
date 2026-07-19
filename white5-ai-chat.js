(() => {
  if (window.__white5AiChatLoaded) return;
  window.__white5AiChatLoaded = true;

  const STORAGE_KEY = "white5-ai-chat-v1";
  const MAX_HISTORY = 12;
  const root = document.createElement("div");
  root.id = "white5-ai-chat-root";
  root.innerHTML = `
    <button class="white5-ai-launcher" type="button" aria-expanded="false" aria-controls="white5-ai-panel">
      <span class="white5-ai-launcher-icon" aria-hidden="true">AI</span>
      <span>Chat with White5</span>
    </button>
    <section class="white5-ai-panel" id="white5-ai-panel" aria-label="White5 AI chat" aria-hidden="true">
      <header class="white5-ai-header">
        <div class="white5-ai-brand">
          <div class="white5-ai-avatar" aria-hidden="true">W5</div>
          <div>
            <div class="white5-ai-title">White5 AI Assistant</div>
            <div class="white5-ai-subtitle"><span class="white5-ai-dot"></span>Available now</div>
          </div>
        </div>
        <button class="white5-ai-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="white5-ai-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="white5-ai-quick" aria-label="Suggested questions">
        <button type="button" data-message="I need a quote. What details do you need?">Get a quote</button>
        <button type="button" data-message="Tell me about window cleaning.">Window cleaning</button>
        <button type="button" data-message="Tell me about gutter and eavestrough cleaning.">Eavestroughs</button>
        <button type="button" data-message="I need help with a deck or fence project.">Deck & fence</button>
      </div>
      <div class="white5-ai-compose">
        <form class="white5-ai-form">
          <textarea class="white5-ai-input" rows="1" maxlength="1400" placeholder="Ask about services or a quote…" aria-label="Your message"></textarea>
          <button class="white5-ai-send" type="submit" aria-label="Send message">➜</button>
        </form>
        <div class="white5-ai-actions">
          <a href="/services.html#estimate">Get Quote</a>
          <a href="tel:14034793905">Call 403-479-3905</a>
        </div>
        <div class="white5-ai-note">AI assistant. Estimates and availability require confirmation. Do not share sensitive information.</div>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  const launcher = root.querySelector(".white5-ai-launcher");
  const panel = root.querySelector(".white5-ai-panel");
  const closeButton = root.querySelector(".white5-ai-close");
  const messagesElement = root.querySelector(".white5-ai-messages");
  const form = root.querySelector(".white5-ai-form");
  const input = root.querySelector(".white5-ai-input");
  const sendButton = root.querySelector(".white5-ai-send");
  const quickButtons = [...root.querySelectorAll(".white5-ai-quick button")];

  let history = loadHistory();
  let busy = false;

  function loadHistory() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .slice(-MAX_HISTORY);
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {
      // Chat still works when browser storage is blocked.
    }
  }

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      setTimeout(() => input.focus(), 50);
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function createMessage(role, text = "", options = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = `white5-ai-message is-${role}`;
    const bubble = document.createElement("div");
    bubble.className = "white5-ai-bubble" + (options.error ? " is-error" : "");
    if (options.typing) {
      bubble.innerHTML = '<span class="white5-ai-typing" aria-label="White5 AI is typing"><span></span><span></span><span></span></span>';
    } else {
      bubble.textContent = text;
    }
    wrapper.appendChild(bubble);
    messagesElement.appendChild(wrapper);
    scrollToBottom();
    return bubble;
  }

  function renderInitialMessages() {
    if (history.length) {
      history.forEach((message) => createMessage(message.role, message.content));
      return;
    }

    createMessage(
      "assistant",
      "Hi! I’m White5’s AI assistant. I can help with window cleaning, eavestrough cleaning, deck and fence work, service areas, and quote preparation. What can I help you with?",
    );
  }

  function setBusy(value) {
    busy = value;
    input.disabled = value;
    sendButton.disabled = value;
    quickButtons.forEach((button) => { button.disabled = value; });
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }

  function extractCompletedText(response) {
    const output = Array.isArray(response?.output) ? response.output : [];
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      }
    }
    return "";
  }

  async function streamReply(messages, bubble) {
    const response = await fetch("/api/ai-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        messages,
        page: {
          path: `${location.pathname}${location.hash}`,
          title: document.title,
        },
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "White5 AI is temporarily unavailable.");
    }

    if (!response.body) throw new Error("White5 AI is temporarily unavailable.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let started = false;

    function handleBlock(block) {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const eventName = eventLine ? eventLine.slice(6).trim() : "";
      const dataLines = lines.filter((line) => line.startsWith("data:"));
      if (!dataLines.length) return;
      const dataText = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
      if (!dataText || dataText === "[DONE]") return;

      let payload;
      try {
        payload = JSON.parse(dataText);
      } catch {
        return;
      }

      if (eventName === "response.output_text.delta" && typeof payload.delta === "string") {
        if (!started) {
          bubble.textContent = "";
          started = true;
        }
        reply += payload.delta;
        bubble.textContent = reply;
        scrollToBottom();
        return;
      }

      if (eventName === "response.completed" && !reply) {
        reply = extractCompletedText(payload.response);
        if (reply) bubble.textContent = reply;
      }

      if (eventName === "error" || eventName === "response.failed") {
        throw new Error("White5 AI could not complete that response.");
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleBlock(block);
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) handleBlock(buffer.trim());

    return reply.trim();
  }

  async function sendMessage(text) {
    const message = String(text || "").trim().slice(0, 1400);
    if (!message || busy) return;

    setOpen(true);
    createMessage("user", message);
    history.push({ role: "user", content: message });
    history = history.slice(-MAX_HISTORY);
    saveHistory();

    input.value = "";
    resizeInput();
    setBusy(true);
    const assistantBubble = createMessage("assistant", "", { typing: true });

    try {
      const reply = await streamReply(history, assistantBubble);
      const finalReply = reply || "Please use the quote form or call 403-479-3905 so White5 can help directly.";
      assistantBubble.textContent = finalReply;
      history.push({ role: "assistant", content: finalReply });
      history = history.slice(-MAX_HISTORY);
      saveHistory();
    } catch (error) {
      assistantBubble.classList.add("is-error");
      assistantBubble.textContent = error instanceof Error
        ? error.message
        : "White5 AI is temporarily unavailable. Please use the quote form or call 403-479-3905.";
    } finally {
      setBusy(false);
      input.focus();
      scrollToBottom();
    }
  }

  launcher.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));
  closeButton.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  quickButtons.forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.message));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });

  renderInitialMessages();
})();
